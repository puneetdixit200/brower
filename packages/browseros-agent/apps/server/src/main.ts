/**
 * @license
 * Copyright 2025 BrowserOS
 * SPDX-License-Identifier: AGPL-3.0-or-later
 */

import fs from 'node:fs'
import path from 'node:path'
import { CdpBackend } from '@browseros/browser-core/backends/cdp'
import { Browser } from '@browseros/browser-core/browser'
import { EXIT_CODES } from '@browseros/shared/constants/exit-codes'
import { createHttpServer } from './api/server'
import type { ServerConfig } from './config'
import { INLINED_ENV } from './env'
import {
  cleanOldSessions,
  ensureBrowserosDir,
  getBrowserosDir,
  getDbPath,
  removeServerConfigSync,
  writeServerConfig,
} from './lib/browseros-dir'
import { initializeDb } from './lib/db'
import { identity } from './lib/identity'
import { loadOrCreateInstallationId } from './lib/installation-id'
import { logger } from './lib/logger'
import { loadOrCreateMcpAccessToken } from './lib/mcp-access-token'
import { selfHealMcpLinks } from './lib/mcp-manager'
import { metrics } from './lib/metrics'
import { isPortInUseError } from './lib/port-binding'
import {
  initializeTelemetryConsent,
  isTelemetryEnabled,
} from './lib/privacy/telemetry-consent'
import { enableTelemetrySentry, Sentry } from './lib/sentry'
import { VERSION } from './version'

export class Application {
  private config: ServerConfig
  private mcpAccessToken = ''

  constructor(config: ServerConfig) {
    this.config = config
  }

  async start(): Promise<void> {
    logger.info(`Starting BrowserOS Server v${VERSION}`)
    logger.debug('Directory config', {
      executionDir: path.resolve(this.config.executionDir),
      resourcesDir: path.resolve(this.config.resourcesDir),
    })

    await this.initCoreServices()

    if (!this.config.cdpPort) {
      logger.error('CDP port is required in the sidecar config')
      process.exit(EXIT_CODES.GENERAL_ERROR)
    }

    const cdp = new CdpBackend({ port: this.config.cdpPort })
    try {
      logger.debug(`Connecting to CDP on port ${this.config.cdpPort}`)
      await cdp.connect()
      logger.info(`Connected to CDP on port ${this.config.cdpPort}`)
    } catch (error) {
      return this.handleStartupError('CDP', this.config.cdpPort, error)
    }

    const browser = new Browser(cdp)
    const browserSession = browser.session

    try {
      await createHttpServer({
        port: this.config.serverPort,
        // This service controls the browser through CDP and must never be
        // reachable from other machines on the network.
        host: '127.0.0.1',
        version: VERSION,
        browser,
        browserSession,
        browserosId: identity.getBrowserOSId(),
        executionDir: this.config.executionDir,
        resourcesDir: this.config.resourcesDir,
        aiSdkDevtoolsEnabled: this.config.aiSdkDevtoolsEnabled,
        mcpAccessToken: this.mcpAccessToken,
        onShutdown: () => this.stop('shutdown-endpoint'),
      })
    } catch (error) {
      this.handleStartupError('HTTP server', this.config.serverPort, error)
    }

    try {
      await writeServerConfig({
        server_port: this.config.serverPort,
        cdp_port: this.config.cdpPort ?? undefined,
        url: `http://127.0.0.1:${this.config.serverPort}`,
        server_version: VERSION,
        browseros_version: this.config.instanceBrowserosVersion,
        chromium_version: this.config.instanceChromiumVersion,
        browseros_id: identity.getBrowserOSId(),
      })
    } catch (error) {
      logger.warn('Failed to write server config for auto-discovery', {
        error: error instanceof Error ? error.message : String(error),
      })
    }

    // Boot self-heal removes obsolete links and repairs current ones. The
    // explicit proxy URL fixes port drift; without it, keep the URL recorded
    // in the manifest while refreshing the authentication header.
    const publicMcpUrl = process.env.BROWSEROS_MCP_PUBLIC_URL
    selfHealMcpLinks({
      currentUrl: publicMcpUrl,
      accessToken: this.mcpAccessToken,
    }).catch((err) => {
      logger.warn('MCP manager self-heal failed; agent configs may be stale', {
        error: err instanceof Error ? err.message : String(err),
      })
    })
    if (!publicMcpUrl) {
      logger.debug(
        'MCP manager is preserving the manifest URL because BROWSEROS_MCP_PUBLIC_URL is not set',
      )
    }

    logger.info(
      `HTTP server listening on http://127.0.0.1:${this.config.serverPort}`,
    )
    logger.info(
      `Health endpoint: http://127.0.0.1:${this.config.serverPort}/system/health`,
    )

    this.logStartupSummary()

    metrics.log('http_server.started', { version: VERSION })
  }

  stop(reason?: string): void {
    logger.info('Shutting down server...', { reason })
    removeServerConfigSync()

    // Immediate exit keeps the port free; signal exits stay non-zero so Chromium restarts us.
    const code =
      reason === 'SIGTERM' || reason === 'SIGINT'
        ? EXIT_CODES.SIGNAL_KILL
        : EXIT_CODES.SUCCESS
    process.exit(code)
  }

  private async initCoreServices(): Promise<void> {
    this.configureLogDirectory()
    await ensureBrowserosDir()
    // The actual state directory can be resolved only after configuration; load
    // consent before initializing either telemetry SDK.
    const telemetryConsent = await initializeTelemetryConsent(getBrowserosDir())
    this.mcpAccessToken = await loadOrCreateMcpAccessToken()
    await cleanOldSessions()

    initializeDb({
      dbPath: getDbPath(),
      resourcesDir: this.config.resourcesDir,
    })

    let installationId: string | undefined
    try {
      installationId = await loadOrCreateInstallationId(getBrowserosDir())
    } catch (error) {
      // Preserve malformed state instead of silently rotating identity. The
      // server remains usable with an ephemeral functional ID, while metrics
      // and Sentry correlation stay disabled until the file is repaired.
      logger.error('Installation identity unavailable', {
        error: error instanceof Error ? error.message : String(error),
      })
    }

    identity.initialize({
      installId: installationId,
    })

    const browserosId = identity.getBrowserOSId()
    logger.info('BrowserOS ID initialized', {
      browserosId: browserosId.slice(0, 12),
      durable: !!installationId,
    })

    metrics.initialize(
      {
        install_id: installationId,
        browseros_version: this.config.instanceBrowserosVersion,
        chromium_version: this.config.instanceChromiumVersion,
        server_version: VERSION,
      },
      telemetryConsent.revision,
    )

    if (telemetryConsent.enabled) {
      enableTelemetrySentry(telemetryConsent.revision)
    }

    if (!isTelemetryEnabled()) {
      logger.info('Telemetry disabled: user consent is off')
    } else if (!metrics.isEnabled()) {
      logger.warn('Metrics disabled: missing POSTHOG_API_KEY')
    } else if (!installationId) {
      logger.warn(
        'Metrics will skip events: installation identity unavailable.',
      )
    }

    if (!INLINED_ENV.SENTRY_DSN) {
      logger.debug('Sentry disabled: missing SENTRY_DSN')
    }
  }

  private configureLogDirectory(): void {
    const logDir = this.config.executionDir
    const resolvedDir = path.isAbsolute(logDir)
      ? logDir
      : path.resolve(process.cwd(), logDir)

    try {
      fs.mkdirSync(resolvedDir, { recursive: true })
      logger.setLogFile(resolvedDir)
    } catch (error) {
      console.warn(
        `Failed to configure log directory ${resolvedDir}: ${
          error instanceof Error ? error.message : String(error)
        }`,
      )
    }
  }

  private handleStartupError(
    serverName: string,
    port: number,
    error: unknown,
  ): never {
    const errorMsg = error instanceof Error ? error.message : String(error)
    logger.error(`Failed to start ${serverName}`, { port, error: errorMsg })
    console.error(
      `[FATAL] Failed to start ${serverName} on port ${port}: ${errorMsg}`,
    )

    if (isPortInUseError(error)) {
      console.error(
        `[FATAL] Port ${port} is already in use. Chromium should try a different port.`,
      )
      process.exit(EXIT_CODES.PORT_CONFLICT)
    }

    Sentry.captureException(error)
    process.exit(EXIT_CODES.GENERAL_ERROR)
  }

  private logStartupSummary(): void {
    logger.info('')
    logger.info('Services running:')
    logger.info(`  HTTP Server: http://127.0.0.1:${this.config.serverPort}`)
    logger.info('')
  }
}
