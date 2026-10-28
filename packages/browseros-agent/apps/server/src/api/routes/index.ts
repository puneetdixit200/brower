import { createDiagnosticsRoute } from './diagnostics'
/**
 * @license
 * Copyright 2025 BrowserOS
 * SPDX-License-Identifier: AGPL-3.0-or-later
 */

import { Hono } from 'hono'
import { cors } from 'hono/cors'
import { AcpAgentRuntime } from '../../lib/agents/acp/acp-agent-runtime'
import type { OAuthTokenManager } from '../../lib/clients/oauth/token-manager'
import { updateMetricsConsent } from '../../lib/metrics'
import {
  reloadTelemetryConsent,
  setTelemetryConsent,
} from '../../lib/privacy/telemetry-consent'
import { disableTelemetrySentry, enableTelemetrySentry } from '../../lib/sentry'
import { requireTrustedOrigin } from '../middleware/require-trusted-origin'
import { ConversationRuns } from '../services/conversation-runs'
import type { KlavisService } from '../services/klavis'
import { BrowserMcpModule } from '../services/mcp/browser-mcp-module'
import type { Env, HttpServerConfig } from '../types'
import { defaultCorsConfig } from '../utils/cors'
import { requireTrustedAppOrigin } from '../utils/request-auth'
import { createAcpxProbeRoutes } from './acpx-probe'
import { createAgentRoutes } from './agents'
import { createChatRoutes } from './chat'
import { createConversationRoutes } from './conversations'
import { createHealthRoute } from './health'
import { createKlavisRoutes } from './klavis'
import { createMcpRoutes } from './mcp'
import { createMcpManagerRoutes } from './mcp-manager'
import { createMemoryRoutes } from './memory'
import { createOAuthRoutes } from './oauth'
import { createPrivacyHandlers, type PrivacyRouteDependencies } from './privacy'
import { createProviderRoutes } from './provider'
import { createProvidersRoutes } from './providers'
import { createRefinePromptRoutes } from './refine-prompt'
import { createScheduledJobRunRoutes } from './scheduled-job-runs'
import { createScheduledJobRoutes } from './scheduled-jobs'
import { createSiteRecipeRoutes } from './site-recipes'
import { createShutdownRoute } from './shutdown'
import { createStatusRoute } from './status'

interface CreateApiRoutesDeps {
  agentRoutes?: Hono<Env>
  config: HttpServerConfig
  klavis: KlavisService
  onShutdown: () => void
  privacy?: PrivacyRouteDependencies
  tokenManager: OAuthTokenManager | null
}

/** Composes the BrowserOS HTTP API from the existing route factories. */
export function createApiRoutes(deps: CreateApiRoutesDeps) {
  const { agentRoutes, config, klavis, onShutdown, tokenManager } = deps
  const { browser, browserosId, browserSession, port, resourcesDir, version } =
    config
  const { activity } = config
  const acpRuntime = new AcpAgentRuntime({ serverPort: port, resourcesDir })
  const conversationRuns = new ConversationRuns({ activity })
  // One deep module owns every browser-tool lease and execution effect;
  // both /chat and /mcp must share it for loopback calls to recover context.
  const browserMcp = new BrowserMcpModule({
    version,
    browserSession,
    conversationRuns,
    klavis,
    activity,
  })
  const resolvedAgentRoutes =
    agentRoutes ??
    createAgentRoutes({
      onDelete: (agentId) =>
        acpRuntime.closeAllForAgent(agentId, {
          discardPersistentState: true,
        }),
      onUpdate: (agentId) =>
        acpRuntime.closeAllForAgent(agentId, {
          discardPersistentState: true,
        }),
    })
  const privacyHandlers = createPrivacyHandlers(
    deps.privacy ?? {
      readConsent: reloadTelemetryConsent,
      setConsent: setTelemetryConsent,
      applyConsent: async ({ enabled, revision }) => {
        await disableTelemetrySentry()
        if (enabled) {
          const current = await reloadTelemetryConsent()
          if (current.enabled && current.revision === revision) {
            enableTelemetrySentry(revision)
          }
        }
        await updateMetricsConsent(enabled, revision)
      },
    },
  )

  const app = new Hono<Env>()
  app.use('/*', cors(defaultCorsConfig))
  app.use('/*', requireTrustedOrigin())
  app.use('/privacy/*', async (c, next) => {
    if (c.req.method === 'POST' && c.req.path === '/privacy/telemetry/state') {
      return privacyHandlers.read(c, next)
    }
    if (c.req.method === 'PUT' && c.req.path === '/privacy/telemetry') {
      return privacyHandlers.write(c, next)
    }
    return next()
  })

  // Register path guards before mounting routes; Hono middleware is
  // evaluated in registration order.
  app.use('/acpx/probe/*', requireTrustedAppOrigin())
  app.use('/agents/*', requireTrustedAppOrigin())
  app.use('/conversations/*', requireTrustedAppOrigin())
  app.use('/mcp-manager/*', requireTrustedAppOrigin())
  app.use(
    '/mcp-manager/access',
    requireTrustedAppOrigin({ requireOrigin: true }),
  )
  app.use('/oauth/*', requireTrustedAppOrigin({ requireOrigin: true }))
  app.use('/providers/*', requireTrustedAppOrigin())
  app.use('/test-provider/*', requireTrustedAppOrigin())
  app.use('/refine-prompt/*', requireTrustedAppOrigin())
  app.use('/klavis/*', requireTrustedAppOrigin())
  app.use('/scheduled-jobs/*', requireTrustedAppOrigin())
  app.use('/scheduled-job-runs/*', requireTrustedAppOrigin())
  app.use('/memory', requireTrustedAppOrigin())
  app.use('/memory/*', requireTrustedAppOrigin())
  app.use('/site-recipes/*', requireTrustedAppOrigin())

  return (
    app
      .route('/system/health', createHealthRoute({ browser }))
      .route('/system/diagnostics', createDiagnosticsRoute(version))
      .route('/system/shutdown', createShutdownRoute({ onShutdown }))
      // Compatibility aliases for shipped browsers that still probe root paths
      // while the server binary can update independently during OTA.
      .route('/health', createHealthRoute({ browser }))
      .route('/shutdown', createShutdownRoute({ onShutdown }))
      .route('/status', createStatusRoute({ browser, activity }))
      .route('/oauth', oauthRoutes(tokenManager))
      .route(
        '/mcp',
        createMcpRoutes({
          browserMcp,
          mcpAccessToken: config.mcpAccessToken ?? '',
        }),
      )
      .route(
        '/mcp-manager',
        createMcpManagerRoutes({
          getMcpUrl: () => `http://127.0.0.1:${port}/mcp`,
          mcpAccessToken: config.mcpAccessToken ?? '',
          klavis,
        }),
      )
      .route(
        '/chat',
        createChatRoutes({
          browser,
          browserMcp,
          browserosId,
          klavis,
          aiSdkDevtoolsEnabled: config.aiSdkDevtoolsEnabled,
          serverPort: port,
          resourcesDir,
          activity,
          acpRuntime,
          conversationRuns,
        }),
      )
      .route('/klavis', createKlavisRoutes({ klavis }))
      .route('/acpx/probe', createAcpxProbeRoutes({ resourcesDir }))
      .route('/agents', resolvedAgentRoutes)
      .route('/conversations', createConversationRoutes())
      .route('/providers', createProvidersRoutes())
      .route('/test-provider', createProviderRoutes({ browserosId }))
      .route('/refine-prompt', createRefinePromptRoutes({ browserosId }))
      .route('/scheduled-jobs', createScheduledJobRoutes())
      .route('/scheduled-job-runs', createScheduledJobRunRoutes())
      .route('/memory', createMemoryRoutes())
      .route('/site-recipes', createSiteRecipeRoutes())
  )
}

function oauthRoutes(tokenManager: OAuthTokenManager | null) {
  const app = new Hono<Env>()
  if (tokenManager) return app.route('/', createOAuthRoutes({ tokenManager }))

  return app.all('/*', (c) => c.json({ error: 'OAuth not available' }, 503))
}
