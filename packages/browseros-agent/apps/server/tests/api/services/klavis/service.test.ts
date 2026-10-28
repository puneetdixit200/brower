/**
 * @license
 * Copyright 2025 BrowserOS
 */

import { describe, expect, it, mock } from 'bun:test'
import { asSchema } from 'ai'
import type { KlavisClient } from '../../../../src/api/services/klavis/client'
import { KlavisService } from '../../../../src/api/services/klavis/service'
import type {
  KlavisSessionHandle,
  StrataCreateResponse,
  UserIntegration,
} from '../../../../src/api/services/klavis/types'

class StubKlavisClient {
  integrations: UserIntegration[] = []
  createStrataCalls: string[][] = []

  async createStrata(
    userId: string,
    servers: string[],
  ): Promise<StrataCreateResponse> {
    this.createStrataCalls.push(servers)
    return {
      strataServerUrl: `https://strata.test/${userId}`,
      strataId: 'strata-123',
      addedServers: servers,
      oauthUrls: Object.fromEntries(
        servers.map((server) => [server, `https://oauth.test/${server}`]),
      ),
      apiKeyUrls: {},
    }
  }

  async getUserIntegrations(): Promise<UserIntegration[]> {
    return this.integrations
  }

  submitApiKey = mock(async () => {})
  deleteServersFromStrata = mock(async () => {})
}

const asClient = (stub: StubKlavisClient): KlavisClient =>
  stub as unknown as KlavisClient

function createHandle(
  overrides: Partial<KlavisSessionHandle> = {},
): KlavisSessionHandle {
  return {
    browserosId: 'browseros-1',
    tools: [
      {
        name: 'gmail_search',
        description: 'Search Gmail',
        inputSchema: { type: 'object' },
      } as never,
    ],
    callTool: mock(async () => ({
      content: [
        { type: 'text', text: 'Found 2 threads' },
        {
          type: 'image',
          data: 'ZmFrZS1pbWFnZQ==',
          mimeType: 'image/png',
        },
      ],
    })),
    close: mock(async () => {}),
    ...overrides,
  }
}

const nextTick = () => new Promise((resolve) => setTimeout(resolve, 0))

describe('KlavisService', () => {
  it('exposes connector discovery before the proxy is ready', async () => {
    const client = new StubKlavisClient()
    client.integrations = [{ name: 'Slack', isAuthenticated: true }]
    const service = new KlavisService({
      browserosId: 'browseros-1',
      client: asClient(client),
      connect: async () => await new Promise(() => {}),
    })

    service.start()

    const toolSet = service.buildAiSdkToolSet({
      selectedServerNames: ['Slack'],
    })
    expect(toolSet.connector_mcp_servers).toBeDefined()
    expect(toolSet.gmail_search).toBeUndefined()

    const inventory = await toolSet.connector_mcp_servers.execute?.({})
    expect(inventory).toMatchObject({
      selected: ['Slack'],
      connected: [{ name: 'Slack', isAuthenticated: true }],
      proxy: { state: 'connecting' },
    })
  })

  it('maps MCP content results into model content parts when ready', async () => {
    const handle = createHandle()
    const service = new KlavisService({
      browserosId: 'browseros-1',
      client: asClient(new StubKlavisClient()),
      connect: async () => handle,
    })

    service.start()
    await nextTick()

    const toolSet = service.buildAiSdkToolSet()
    const searchTool = toolSet.gmail_search

    expect(searchTool).toBeDefined()

    const output = await searchTool.execute?.({})
    const modelOutput = await searchTool.toModelOutput?.({
      toolCallId: 'call-1',
      input: {},
      output,
    })

    expect(modelOutput).toEqual({
      type: 'content',
      value: [{ type: 'text', text: 'Found 2 threads' }],
    })
  })

  it('redacts named secrets in remote JSON and MCP text output', async () => {
    const handle = createHandle({
      tools: [
        {
          name: 'gmail_search',
          description: 'Search Gmail',
          inputSchema: { type: 'object' },
        } as never,
      ],
      callTool: mock(async () => ({
        content: [
          {
            type: 'text',
            text: [
              'access_token: abc123 Authorization: Bearer xyz789 keep this',
              'Authorization: Basic dXNlcjpwYXNzd29yZA==',
              'Authorization: Digest username="alice", response="digest-secret"',
            ].join('\n'),
          },
          {
            type: 'text',
            text: JSON.stringify({
              title: 'Quarterly update',
              apiKey: 'key-value',
              Authorization: 'Bearer json-secret',
              details: { refresh_token: 'refresh-value' },
            }),
          },
          {
            type: 'text',
            text: JSON.stringify({
              passwordValue: 'serialized-password-sentinel',
              passwordValueText: 'serialized-password-text-sentinel',
              nested: {
                accessTokenValue: 'serialized-token-sentinel',
                accessTokenValueEncoded: 'serialized-encoded-token-sentinel',
              },
              token_count: 2,
              secret_count: 3,
            }),
          },
        ],
      })),
    })
    const service = new KlavisService({
      browserosId: 'browseros-1',
      client: asClient(new StubKlavisClient()),
      connect: async () => handle,
    })

    service.start()
    await nextTick()

    const tool = service.buildAiSdkToolSet().gmail_search
    const output = await tool.execute?.({})
    const modelOutput = await tool.toModelOutput?.({
      toolCallId: 'call-secret',
      input: {},
      output,
    })

    expect(modelOutput).toEqual({
      type: 'content',
      value: [
        {
          type: 'text',
          text: [
            'access_token: [REDACTED] Authorization: [REDACTED]',
            'Authorization: [REDACTED]',
            'Authorization: [REDACTED]',
          ].join('\n'),
        },
        {
          type: 'text',
          text: '{"title":"Quarterly update","apiKey":"[REDACTED]","Authorization":"[REDACTED]","details":{"refresh_token":"[REDACTED]"}}',
        },
        {
          type: 'text',
          text: '{"passwordValue":"[REDACTED]","passwordValueText":"[REDACTED]","nested":{"accessTokenValue":"[REDACTED]","accessTokenValueEncoded":"[REDACTED]"},"token_count":2,"secret_count":3}',
        },
      ],
    })
  })

  it('redacts complete cookie header values and multiline PEM private keys', async () => {
    const handle = createHandle({
      tools: [
        {
          name: 'gmail_search',
          description: 'Search Gmail',
          inputSchema: { type: 'object' },
        } as never,
      ],
      callTool: mock(async () => ({
        content: [
          {
            type: 'text',
            text: [
              'Cookie: session_id=session-secret; sid=another-secret; remember_me=third-secret',
              'Set-Cookie: refresh_session=refresh-secret; Path=/; HttpOnly; SameSite=Lax',
              'status: connected',
            ].join('\n'),
          },
          {
            type: 'text',
            text: [
              '-----BEGIN PRIVATE KEY-----',
              'MIIEvQIBADANBgkqhkiG9w0BAQEFAASCBKcwggSj',
              '-----END PRIVATE KEY-----',
              'public result remains visible',
            ].join('\n'),
          },
          {
            type: 'text',
            text: JSON.stringify({
              Cookie: 'session_id=abc; sid=def',
              status: 'connected',
            }),
          },
          {
            type: 'text',
            text: JSON.stringify({
              password: 'secret phrase with spaces',
              privateKey: 'multi word private key value',
              Cookie: 'session_id=another-secret; sid=second-secret',
              status: 'connected',
            }),
          },
        ],
      })),
    })
    const service = new KlavisService({
      browserosId: 'browseros-1',
      client: asClient(new StubKlavisClient()),
      connect: async () => handle,
    })

    service.start()
    await nextTick()

    const tool = service.buildAiSdkToolSet().gmail_search
    const output = await tool.execute?.({})
    const modelOutput = await tool.toModelOutput?.({
      toolCallId: 'call-cookie-pem-secret',
      input: {},
      output,
    })

    expect(modelOutput).toEqual({
      type: 'content',
      value: [
        {
          type: 'text',
          text: [
            'Cookie: [REDACTED]',
            'Set-Cookie: [REDACTED]',
            'status: connected',
          ].join('\n'),
        },
        {
          type: 'text',
          text: '[REDACTED PRIVATE KEY]\npublic result remains visible',
        },
        {
          type: 'text',
          text: '{"Cookie":"[REDACTED]","status":"connected"}',
        },
        {
          type: 'text',
          text: '{"password":"[REDACTED]","privateKey":"[REDACTED]","Cookie":"[REDACTED]","status":"connected"}',
        },
      ],
    })
  })

  it('redacts secret-keyed fields in JSON outputs while preserving useful values', async () => {
    const handle = createHandle({
      tools: [
        {
          name: 'gmail_search',
          description: 'Search Gmail',
          inputSchema: { type: 'object' },
        } as never,
      ],
      callTool: mock(
        async () =>
          ({
            account: 'work',
            clientSecret: 'secret-value',
            nested: {
              password: 'password-value',
              passwordValue: 'object-password-sentinel',
              passwordValueText: 'object-password-text-sentinel',
              accessTokenValue: 'object-access-token-sentinel',
              token: 'token-value',
              count: 3,
              token_count: 2,
              cookie_count: 4,
              secret_count: 5,
            },
            api_key: 'snake-api-key',
            apiKey: 'camel-api-key',
            privateKey: 'private-key-value',
          }) as never,
      ),
    })
    const service = new KlavisService({
      browserosId: 'browseros-1',
      client: asClient(new StubKlavisClient()),
      connect: async () => handle,
    })

    service.start()
    await nextTick()

    const tool = service.buildAiSdkToolSet().gmail_search
    const output = await tool.execute?.({})
    const modelOutput = await tool.toModelOutput?.({
      toolCallId: 'call-json-secret',
      input: {},
      output,
    })

    expect(modelOutput).toEqual({
      type: 'json',
      value: {
        account: 'work',
        clientSecret: '[REDACTED]',
        nested: {
          password: '[REDACTED]',
          passwordValue: '[REDACTED]',
          passwordValueText: '[REDACTED]',
          accessTokenValue: '[REDACTED]',
          token: '[REDACTED]',
          count: 3,
          token_count: 2,
          cookie_count: 4,
          secret_count: 5,
        },
        api_key: '[REDACTED]',
        apiKey: '[REDACTED]',
        privateKey: '[REDACTED]',
      },
    })
  })

  it('keeps parameterized connector tool schemas intact for the model', async () => {
    const parameterizedSchema = {
      type: 'object',
      properties: {
        category_names: {
          type: 'array',
          items: { type: 'string' },
          description: 'Categories to expand.',
        },
      },
      required: ['category_names'],
      additionalProperties: false,
    }
    const handle = createHandle({
      tools: [
        {
          name: 'get_category_actions',
          description: 'Expand categories',
          inputSchema: parameterizedSchema,
        } as never,
      ],
    })
    const service = new KlavisService({
      browserosId: 'browseros-1',
      client: asClient(new StubKlavisClient()),
      connect: async () => handle,
    })

    service.start()
    await nextTick()

    const tool = service.buildAiSdkToolSet().get_category_actions
    expect(tool).toBeDefined()

    // Regression: the remote JSON schema must reach the model unchanged. Routing
    // it through Zod (zod-from-json-schema -> zod-to-json-schema under zod v3)
    // dropped every property, so the model could never supply category_names.
    const advertised = asSchema(tool.inputSchema).jsonSchema as {
      properties?: Record<string, unknown>
      required?: string[]
    }
    expect(advertised.properties?.category_names).toBeDefined()
    expect(advertised.required).toContain('category_names')
  })

  it('maps null MCP results into JSON model output', async () => {
    const handle = createHandle({
      tools: [
        {
          name: 'notion_lookup',
          description: 'Lookup Notion',
          inputSchema: { type: 'object' },
        } as never,
      ],
      callTool: mock(async () => null as never),
    })
    const service = new KlavisService({
      browserosId: 'browseros-1',
      client: asClient(new StubKlavisClient()),
      connect: async () => handle,
    })

    service.start()
    await nextTick()

    const toolSet = service.buildAiSdkToolSet()
    const lookupTool = toolSet.notion_lookup
    const output = await lookupTool.execute?.({})
    const modelOutput = await lookupTool.toModelOutput?.({
      toolCallId: 'call-2',
      input: {},
      output,
    })

    expect(modelOutput).toEqual({
      type: 'json',
      value: null,
    })
  })

  it('returns an auth URL for an unconnected requested connector', async () => {
    const client = new StubKlavisClient()
    const service = new KlavisService({
      browserosId: 'browseros-1',
      client: asClient(client),
      retryDelaysMs: [],
      connect: async () => {
        throw new Error('offline')
      },
    })

    service.start()
    await nextTick()

    const toolSet = service.buildAiSdkToolSet()
    const payload = await toolSet.connector_mcp_servers.execute?.({
      server_name: 'Slack',
    })

    expect(payload).toMatchObject({
      connected: false,
      server_name: 'Slack',
      authUrl: 'https://oauth.test/Slack',
      proxy: { state: 'unavailable', error: 'offline' },
    })
    expect(client.createStrataCalls).toEqual([['Slack']])
  })

  it('retries in the background until a connection succeeds', async () => {
    const handle = createHandle({ tools: [] })
    let attempts = 0
    const service = new KlavisService({
      browserosId: 'browseros-1',
      client: asClient(new StubKlavisClient()),
      retryDelaysMs: [1],
      connect: async () => {
        attempts++
        if (attempts === 1) {
          throw new Error('boom')
        }
        return handle
      },
    })

    service.start()
    await new Promise((resolve) => setTimeout(resolve, 20))

    expect(attempts).toBe(2)
    expect(service.getProxyStatus()).toEqual({ state: 'ready', toolCount: 0 })
    await service.stop()
  })

  it('closes a late handle when stopped during an in-flight connect', async () => {
    let releaseConnect: (() => void) | undefined
    const connectStarted = new Promise<void>((resolve) => {
      releaseConnect = resolve
    })
    const handle = createHandle({ tools: [] })
    const service = new KlavisService({
      browserosId: 'browseros-2',
      client: asClient(new StubKlavisClient()),
      connect: async () => {
        await connectStarted
        return handle
      },
    })

    service.start()
    await service.stop()
    releaseConnect?.()
    await nextTick()

    expect(handle.close).toHaveBeenCalledTimes(1)
    expect(service.getProxyStatus()).toEqual({ state: 'stopped' })
  })

  it('cancels a scheduled retry when stopped', async () => {
    let resolveFirstAttempt: (() => void) | undefined
    const firstAttemptDone = new Promise<void>((resolve) => {
      resolveFirstAttempt = resolve
    })
    let attempts = 0
    const service = new KlavisService({
      browserosId: 'browseros-3',
      client: asClient(new StubKlavisClient()),
      retryDelaysMs: [20],
      connect: async () => {
        attempts++
        if (attempts === 1) {
          resolveFirstAttempt?.()
          throw new Error('boom')
        }
        return createHandle({ tools: [] })
      },
    })

    service.start()
    await firstAttemptDone
    await service.stop()
    await new Promise((resolve) => setTimeout(resolve, 40))

    expect(attempts).toBe(1)
    expect(service.getProxyStatus()).toEqual({ state: 'stopped' })
  })
})
