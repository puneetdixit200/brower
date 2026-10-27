import { describe, expect, test } from 'bun:test'
import { createHash, generateKeyPairSync } from 'node:crypto'
import {
  chromeExtensionId,
  getAsterCompatibilityExtensionIds,
  getAsterManifestIdentity,
  getAsterProductWebMatches,
} from './aster-manifest-identity'

function expectedChromeId(key: string): string {
  const hash = createHash('sha256').update(Buffer.from(key, 'base64')).digest()
  return [...hash.subarray(0, 16)]
    .map((byte) => String.fromCharCode(97 + (byte >> 4), 97 + (byte & 15)))
    .join('')
}

const publicKey = generateKeyPairSync('rsa', { modulusLength: 1024 }).publicKey
const generatedPublicKey = publicKey
  .export({ format: 'der', type: 'spki' })
  .toString('base64')
const browserOsPublicKey =
  'MIIBIjANBgkqhkiG9w0BAQEFAAOCAQ8AMIIBCgKCAQEAvBDAaDRvv61NpBeLR8etBRw82lv9VJO3sz/mA26gDzWKtVuzW4DXCl8Zfj5oWmoXLTfv3aiTigUXo/LHOoGpSucEVroMmAc7cgu2KuQ1fZPpMvYa0npD/m4h89360q8Oz0oKKaZGS905IJ04M2IkF4CuU3YEHFJBWb+cUyK9H8YVugelYbPD0IVs63T1SkGbh/t/Tfb2DpkinduSO8+x26sKydm30SRt+iZ2+7Nolcdum3LExInUiX2Pgb65Jb+mVw8NqyTVJyCEp8uq0cSHomWFQirSJ80tsDhISp4btwaRKHrXqovQx9XHQv4hCd+3LuB830eUEVMUNuCO+OyPxQIDAQAB'

describe('getAsterManifestIdentity', () => {
  test('uses the stable Aster development key without updater or reporter wiring', () => {
    const identity = getAsterManifestIdentity({})
    const key = identity.key ?? ''
    expect(key).not.toBe('')
    expect(chromeExtensionId(key)).toBe('oifdmombnijnaiocijiacjhajbnpdlhb')
    expect(identity.update_url).toBeUndefined()
    expect(identity.externally_connectable).toEqual({ ids: [] })
  })

  test('accepts a generated public key and Aster-owned values', () => {
    expect(chromeExtensionId(generatedPublicKey)).toBe(
      expectedChromeId(generatedPublicKey),
    )
    expect(
      getAsterManifestIdentity({
        ASTER_EXTENSION_PUBLIC_KEY: generatedPublicKey,
        ASTER_EXTENSION_UPDATE_URL:
          'https://updates.aster.example/manifest.xml',
        ASTER_REPORTER_EXTENSION_ID: 'a'.repeat(32),
      }),
    ).toEqual({
      key: generatedPublicKey,
      update_url: 'https://updates.aster.example/manifest.xml',
      externally_connectable: { ids: ['a'.repeat(32)] },
    })
  })

  test('rejects malformed and BrowserOS keys', () => {
    expect(() =>
      getAsterManifestIdentity({
        ASTER_EXTENSION_PUBLIC_KEY: 'not-a-public-key',
        ASTER_EXTENSION_UPDATE_URL:
          'https://updates.aster.example/manifest.xml',
      }),
    ).toThrow('valid base64 DER SPKI')
    expect(() =>
      getAsterManifestIdentity({
        ASTER_EXTENSION_PUBLIC_KEY: browserOsPublicKey,
        ASTER_EXTENSION_UPDATE_URL:
          'https://updates.aster.example/manifest.xml',
      }),
    ).toThrow('BrowserOS extension ID')
  })

  test('requires key and update URL together and rejects BrowserOS update hosts', () => {
    expect(() =>
      getAsterManifestIdentity({
        ASTER_EXTENSION_PUBLIC_KEY: generatedPublicKey,
      }),
    ).toThrow('must be set together')
    expect(() =>
      getAsterManifestIdentity({
        ASTER_EXTENSION_PUBLIC_KEY: generatedPublicKey,
        ASTER_EXTENSION_UPDATE_URL: 'https://cdn.browseros.com/updates.xml',
      }),
    ).toThrow('must not use a BrowserOS host')
    expect(() =>
      getAsterManifestIdentity({
        ASTER_EXTENSION_PUBLIC_KEY: generatedPublicKey,
        ASTER_EXTENSION_UPDATE_URL:
          'https://updates.aster.example@browseros.com./updates.xml',
      }),
    ).toThrow('omit credentials')
  })

  test('rejects invalid reporter IDs', () => {
    expect(() =>
      getAsterManifestIdentity({ ASTER_REPORTER_EXTENSION_ID: 'browseros' }),
    ).toThrow('32-character Chrome extension ID')
    for (const id of [
      'bflpfmnmnokmjhmgnolecpppdbdophmk',
      'adlpneommgkgeanpaekgoaolcpncohkf',
      'djhdjhlnljbjgejbndockeedocneiaei',
    ]) {
      expect(() =>
        getAsterManifestIdentity({ ASTER_REPORTER_EXTENSION_ID: id }),
      ).toThrow('non-BrowserOS')
    }
  })

  test('omits compatibility peers by default and validates explicit peers', () => {
    expect(getAsterCompatibilityExtensionIds({})).toEqual([])
    expect(() =>
      getAsterCompatibilityExtensionIds({
        ASTER_COMPAT_EXTENSION_ID: 'b'.repeat(32),
      }),
    ).toThrow('requires ASTER_PRODUCT_WEB_URL')
    expect(
      getAsterCompatibilityExtensionIds({
        ASTER_COMPAT_EXTENSION_ID: 'b'.repeat(32),
        ASTER_PRODUCT_WEB_URL: 'https://aster.example',
      }),
    ).toEqual(['b'.repeat(32)])
    for (const id of [
      'bflpfmnmnokmjhmgnolecpppdbdophmk',
      'adlpneommgkgeanpaekgoaolcpncohkf',
      'djhdjhlnljbjgejbndockeedocneiaei',
    ]) {
      expect(() =>
        getAsterCompatibilityExtensionIds({
          ASTER_COMPAT_EXTENSION_ID: id,
          ASTER_PRODUCT_WEB_URL: 'https://aster.example',
        }),
      ).toThrow('non-BrowserOS')
    }
  })

  test('omits product web access by default and accepts only Aster HTTPS origins', () => {
    expect(getAsterProductWebMatches({})).toEqual([])
    expect(
      getAsterProductWebMatches({
        ASTER_PRODUCT_WEB_URL: 'https://aster.example',
      }),
    ).toEqual(['https://aster.example/*', 'https://*.aster.example/*'])
    expect(
      getAsterProductWebMatches({
        ASTER_PRODUCT_WEB_URL: 'https://aster.example.',
      }),
    ).toEqual(['https://aster.example/*', 'https://*.aster.example/*'])
    for (const host of [
      'browseros.com',
      'browseros.com.',
      'docs.browseros.com.',
    ]) {
      expect(() =>
        getAsterProductWebMatches({
          ASTER_PRODUCT_WEB_URL: `https://${host}`,
        }),
      ).toThrow('must not use a BrowserOS host')
    }
    for (const host of [
      'localhost',
      '127.0.0.1',
      '[::1]',
      'service.localhost',
    ]) {
      expect(() =>
        getAsterProductWebMatches({ ASTER_PRODUCT_WEB_URL: `https://${host}` }),
      ).toThrow('localhost, or IP host')
    }
    expect(() =>
      getAsterProductWebMatches({
        ASTER_PRODUCT_WEB_URL: 'http://aster.example',
      }),
    ).toThrow('HTTPS site origin')
    expect(() =>
      getAsterProductWebMatches({
        ASTER_PRODUCT_WEB_URL: 'https://aster.example/path',
      }),
    ).toThrow('HTTPS site origin')
  })
})
