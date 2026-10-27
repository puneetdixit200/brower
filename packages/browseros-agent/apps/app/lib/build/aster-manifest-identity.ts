import { createHash, createPublicKey } from 'node:crypto'
import { isIP } from 'node:net'

type AsterManifestIdentityEnv = {
  [key: string]: string | undefined
  ASTER_EXTENSION_PUBLIC_KEY?: string
  ASTER_EXTENSION_UPDATE_URL?: string
  ASTER_REPORTER_EXTENSION_ID?: string
  ASTER_COMPAT_EXTENSION_ID?: string
  ASTER_PRODUCT_WEB_URL?: string
}

const BROWSEROS_EXTENSION_IDS = new Set([
  'bflpfmnmnokmjhmgnolecpppdbdophmk', // primary extension
  'adlpneommgkgeanpaekgoaolcpncohkf', // bug reporter
  'djhdjhlnljbjgejbndockeedocneiaei', // legacy agent
])
const ASTER_DEV_EXTENSION_PUBLIC_KEY =
  'MIIBIjANBgkqhkiG9w0BAQEFAAOCAQ8AMIIBCgKCAQEA2gIwa9N2/RqO1TGyeOHS0uS9xDkYnnFIuDym99e8uFA6lc1t6JLeWTmi6GxpKqFejoTA1/4Wiuh1A3v/3FOqCCjDzaEFmhb0H2Z7FdvfEOpBtmMBmQDfTcPk1gdxn1cviHjTwOStoSSnQAy/NhJ6J5uvUjK74C/8FoGQ5HzPzrNWMdsKxsGK/8knXwif5gK1zAppGzdh0wmfbqD2xPKTD89XE6so+vIP1bvGSUIWVfxqZisa7zfW3wLKw+AX4IA6SOTx/vhI0HxQeZkjlLPyF3PEVA4uMdItbpsVRPySgQz2zkqwPnRcG+QCTiQxTeXqlnXsHxHi3G00wJDqCIZoLwIDAQAB'

export function chromeExtensionId(publicKey: string): string {
  const key = createPublicKey({
    key: Buffer.from(publicKey, 'base64'),
    format: 'der',
    type: 'spki',
  })
  const hash = createHash('sha256')
    .update(key.export({ format: 'der', type: 'spki' }))
    .digest()
  return [...hash.subarray(0, 16)]
    .map((byte) => String.fromCharCode(97 + (byte >> 4), 97 + (byte & 15)))
    .join('')
}

/** Uses a stable Aster dev key by default; updater and reporter fields are opt-in. */
export function getAsterManifestIdentity(env: AsterManifestIdentityEnv) {
  const configuredKey = env.ASTER_EXTENSION_PUBLIC_KEY?.trim()
  const updateUrl = env.ASTER_EXTENSION_UPDATE_URL?.trim()
  const reporterId = env.ASTER_REPORTER_EXTENSION_ID?.trim()

  if (Boolean(configuredKey) !== Boolean(updateUrl)) {
    throw new Error(
      'ASTER_EXTENSION_PUBLIC_KEY and ASTER_EXTENSION_UPDATE_URL must be set together',
    )
  }

  const key = configuredKey || ASTER_DEV_EXTENSION_PUBLIC_KEY
  if (key) {
    try {
      if (!/^[A-Za-z0-9+/]+={0,2}$/.test(key)) throw new Error('invalid base64')
      if (BROWSEROS_EXTENSION_IDS.has(chromeExtensionId(key))) {
        throw new Error(
          'ASTER_EXTENSION_PUBLIC_KEY resolves to the BrowserOS extension ID',
        )
      }
    } catch (error) {
      if (
        error instanceof Error &&
        error.message.includes('BrowserOS extension ID')
      )
        throw error
      throw new Error(
        'ASTER_EXTENSION_PUBLIC_KEY must be a valid base64 DER SPKI public key',
      )
    }
  }

  if (updateUrl) {
    let parsedUrl: URL
    try {
      parsedUrl = new URL(updateUrl)
    } catch {
      throw new Error(
        'ASTER_EXTENSION_UPDATE_URL must be an absolute HTTPS URL',
      )
    }
    if (
      parsedUrl.protocol !== 'https:' ||
      parsedUrl.username ||
      parsedUrl.password ||
      isBrowserOsHost(parsedUrl.hostname)
    ) {
      throw new Error(
        'ASTER_EXTENSION_UPDATE_URL must use HTTPS, omit credentials, and must not use a BrowserOS host',
      )
    }
  }

  if (reporterId && !/^[a-p]{32}$/.test(reporterId)) {
    throw new Error(
      'ASTER_REPORTER_EXTENSION_ID must be a 32-character Chrome extension ID',
    )
  }
  if (reporterId && BROWSEROS_EXTENSION_IDS.has(reporterId)) {
    throw new Error(
      'ASTER_REPORTER_EXTENSION_ID must be a non-BrowserOS Chrome extension ID',
    )
  }
  return {
    ...(key ? { key } : {}),
    ...(configuredKey && updateUrl ? { update_url: updateUrl } : {}),
    // Omitting this field lets every extension connect in Chrome.
    externally_connectable: { ids: reporterId ? [reporterId] : [] },
  }
}

export function getAsterCompatibilityExtensionIds(
  env: AsterManifestIdentityEnv,
): string[] {
  const compatId = env.ASTER_COMPAT_EXTENSION_ID?.trim()
  if (!compatId) return []
  if (!env.ASTER_PRODUCT_WEB_URL?.trim()) {
    throw new Error('ASTER_COMPAT_EXTENSION_ID requires ASTER_PRODUCT_WEB_URL')
  }
  if (!/^[a-p]{32}$/.test(compatId) || BROWSEROS_EXTENSION_IDS.has(compatId)) {
    throw new Error(
      'ASTER_COMPAT_EXTENSION_ID must be a non-BrowserOS Chrome extension ID',
    )
  }
  return [compatId]
}

export function getAsterProductWebMatches(
  env: AsterManifestIdentityEnv,
): string[] {
  const productWebUrl = env.ASTER_PRODUCT_WEB_URL?.trim()
  if (!productWebUrl) return []

  let parsedUrl: URL
  try {
    parsedUrl = new URL(productWebUrl)
  } catch {
    throw new Error('ASTER_PRODUCT_WEB_URL must be an HTTPS site origin')
  }

  if (
    parsedUrl.protocol !== 'https:' ||
    parsedUrl.username ||
    parsedUrl.password ||
    parsedUrl.port ||
    (parsedUrl.pathname !== '/' && parsedUrl.pathname !== '') ||
    parsedUrl.search ||
    parsedUrl.hash
  ) {
    throw new Error('ASTER_PRODUCT_WEB_URL must be an HTTPS site origin')
  }
  if (isBrowserOsHost(parsedUrl.hostname)) {
    throw new Error('ASTER_PRODUCT_WEB_URL must not use a BrowserOS host')
  }
  const hostname = parsedUrl.hostname.replace(/^\[|\]$/g, '').replace(/\.$/, '')
  if (
    hostname === 'localhost' ||
    hostname.endsWith('.localhost') ||
    isIP(hostname) !== 0
  ) {
    throw new Error(
      'ASTER_PRODUCT_WEB_URL must not use a BrowserOS, localhost, or IP host',
    )
  }
  return [`https://${hostname}/*`, `https://*.${hostname}/*`]
}

function isBrowserOsHost(hostname: string): boolean {
  const normalizedHostname = hostname.toLowerCase().replace(/\.$/, '')
  return (
    normalizedHostname === 'browseros.com' ||
    normalizedHostname.endsWith('.browseros.com')
  )
}
