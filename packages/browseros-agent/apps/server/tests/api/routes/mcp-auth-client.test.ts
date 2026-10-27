import { afterEach, describe, expect, it } from 'bun:test'
import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js'
import { Hono } from 'hono'
import { createMcpRoutes } from '../../../src/api/routes/mcp'
import { BrowserMcpModule } from '../../../src/api/services/mcp/browser-mcp-module'

const ACCESS_TOKEN = 'test-mcp-client-token-01234567890123456789'
let server: ReturnType<typeof Bun.serve> | undefined
let clients: Client[] = []
let transports: StreamableHTTPClientTransport[] = []

afterEach(async () => {
  await Promise.all(
    transports.map((transport) => transport.close().catch(() => {})),
  )
  await Promise.all(clients.map((client) => client.close().catch(() => {})))
  server?.stop(true)
  clients = []
  transports = []
  server = undefined
})

describe('authenticated MCP SDK client', () => {
  it('rejects missing credentials and serves tools/list to a bearer-authenticated client', async () => {
    const app: Hono = new Hono().route(
      '/mcp',
      createMcpRoutes({
        mcpAccessToken: ACCESS_TOKEN,
        browserMcp: new BrowserMcpModule({
          version: '0.0.0-test',
          browserSession: {} as never,
          conversationRuns: { activeRun: () => undefined },
        }),
      }),
    )
    server = Bun.serve({
      hostname: '127.0.0.1',
      port: 0,
      fetch: app.fetch as (request: Request) => Response | Promise<Response>,
    })
    const endpoint = new URL(`http://127.0.0.1:${server.port}/mcp`)

    const unauthorizedResponse = await fetch(endpoint, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Accept: 'application/json, text/event-stream',
      },
      body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/list' }),
    })
    expect(unauthorizedResponse.status).toBe(401)

    const client = new Client({ name: 'aster-auth-test', version: '1.0.0' })
    const transport = new StreamableHTTPClientTransport(endpoint, {
      requestInit: { headers: { Authorization: `Bearer ${ACCESS_TOKEN}` } },
    })
    clients.push(client)
    transports.push(transport)

    await client.connect(transport)
    const { tools } = await client.listTools()

    expect(tools.map((tool) => tool.name)).toContain('tabs')
  })
})
