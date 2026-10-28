import { describe, expect, it } from 'bun:test'
import type { ToolSet } from 'ai'
import {
  buildAgentToolCatalog,
  excludeRawPageCodeTools,
} from '../../src/agent/credential-tool-filter'

function candidate(description: string): ToolSet[string] {
  return { description, inputSchema: {} as never }
}

describe('agent model tool catalog credential boundary', () => {
  it('removes credential export capabilities from the final catalog across adversarial naming and wording', () => {
    const candidates: ToolSet = {
      get_passwords: candidate(
        'Read all saved passwords from the browser vault.',
      ),
      list_passkeys: candidate('List passkeys stored in the vault.'),
      otp_export: candidate('Export authenticator one-time codes.'),
      vaultEntries: candidate(
        'Returns credentials saved in the browser password vault.',
      ),
      exportAccountData: candidate(
        'Exports the account passkeys and current authenticator one-time codes.',
      ),
      get_vault_entries: candidate(
        'Returns saved login details for this site.',
      ),
      fetchSiteData: candidate('Retrieves access tokens for the current site.'),
      sessionState: candidate('Returns the active session token.'),
      apiInfo: candidate('Fetches the account API token.'),
      get_api_key: candidate('Returns the API key.'),
      exportPrivateKey: candidate('Exports the private key.'),
      clientSecretInfo: candidate('Retrieves the OAuth client secret.'),
      refreshTokenInfo: candidate('Returns the refresh token.'),
      bearerTokenInfo: candidate('Fetches the bearer token.'),
      get_recovery_codes: candidate('Returns the account recovery codes.'),
      backupCodeExport: candidate('Exports saved backup codes.'),
      passphraseInfo: candidate('Retrieves the account passphrase.'),
      cookieJar: candidate('Retrieves browser cookies and session cookies.'),
      secretExport: candidate('Exports available secrets.'),
      passwordDump: candidate('Dump stored credentials.'),
      credentialDecrypt: candidate('Decrypt saved credentials.'),
      autofillSavedPasswords: candidate(
        'Autofill a user selected saved browser password.',
      ),
      get_pin: candidate('Retrieve the saved account PIN.'),
      securityQuestionExport: candidate(
        'Export the stored security question answers.',
      ),
      get_question_responses: candidate(
        'Return the recovery question responses for this account.',
      ),
      view_passwords: candidate(''),
      inspectStatus: candidate(
        'View the saved passwords associated with this browser profile.',
      ),
      inspectVault: candidate('Inspect stored credentials in the vault.'),
      displaySavedPasswords: candidate('Display saved passwords.'),
      navigate: candidate('Navigate to a URL in the active tab.'),
      pinTab: candidate('Pin the active tab to the tab strip.'),
      passwordSafetyHelp: candidate(
        'Displays a warning about saved password security.',
      ),
      tokenSafetyHelp: candidate(
        'Displays a warning that saved passwords, session tokens, and cookies must never be shared.',
      ),
      credentialSafetyHelp: candidate(
        'Displays a warning that recovery codes, backup codes, and passphrases are sensitive.',
      ),
    }

    const catalog = buildAgentToolCatalog(candidates)

    expect(catalog.blocked.sort()).toEqual(
      [
        'apiInfo',
        'bearerTokenInfo',
        'autofillSavedPasswords',
        'backupCodeExport',
        'clientSecretInfo',
        'cookieJar',
        'credentialDecrypt',
        'exportAccountData',
        'exportPrivateKey',
        'fetchSiteData',
        'get_api_key',
        'get_pin',
        'get_question_responses',
        'get_recovery_codes',
        'get_vault_entries',
        'get_passwords',
        'list_passkeys',
        'otp_export',
        'passwordDump',
        'passphraseInfo',
        'refreshTokenInfo',
        'inspectStatus',
        'inspectVault',
        'secretExport',
        'sessionState',
        'securityQuestionExport',
        'view_passwords',
        'displaySavedPasswords',
        'vaultEntries',
      ].sort(),
    )
    expect(Object.keys(catalog.tools).sort()).toEqual(
      [
        'credentialSafetyHelp',
        'navigate',
        'pinTab',
        'passwordSafetyHelp',
        'tokenSafetyHelp',
      ].sort(),
    )
  })

  it('separates internal page-code restriction from origin-agnostic catalog filtering', () => {
    const rawTools = {
      run: candidate('Harmless helper'),
      evaluate: candidate('Harmless expression'),
      snapshot: candidate('Read the accessibility tree'),
      read: candidate('Read page text'),
    }
    const internal = excludeRawPageCodeTools(rawTools)
    const custom = buildAgentToolCatalog({
      ...internal.allowed,
      run: candidate('Run a user-defined report unrelated to the browser.'),
      evaluate: candidate(
        'Evaluate a custom calculation unrelated to the browser.',
      ),
    })

    expect(internal.blocked.sort()).toEqual(['evaluate', 'run'])
    expect(Object.keys(internal.allowed).sort()).toEqual(['read', 'snapshot'])
    expect(Object.keys(custom.tools).sort()).toEqual([
      'evaluate',
      'read',
      'run',
      'snapshot',
    ])
  })
})
