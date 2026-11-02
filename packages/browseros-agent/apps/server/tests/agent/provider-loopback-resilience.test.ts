/**
 * Exercises the configured production provider adapter against a controllable
 * loopback OpenAI-compatible endpoint. No external model or credentials are
 * involved; failures traverse the same AI SDK stream path used by ChatService.
 */
import { afterEach, describe, expect, it } from 'bun:test'
import { parseChatErrorEnvelope } from '@browseros/shared/schemas/chat-error'
import { LLM_PROVIDERS } from '@browseros/shared/schemas/llm'
import { createAgentUIStreamResponse, ToolLoopAgent } from 'ai'
import { toChatErrorText } from '../../src/agent/chat-error'
import { createLanguageModel } from '../../src/agent/provider-factory'

const servers: ReturnType<typeof Bun.serve>[] = []

function startProvider(
  handler: (request: Request) => Response | Promise<Response>,
) {
  const server = Bun.serve({
    hostname: '127.0.0.1',
    port: 0,
    fetch: handler,
  })
  servers.push(server)
  return `http://127.0.0.1:${server.port}/v1`
}

function modelAt(baseUrl: string) {
  return createLanguageModel({
    conversationId: 'provider-loopback-test',
    provider: LLM_PROVIDERS.OPENAI_COMPATIBLE,
    model: 'fixture-tool-model',
    baseUrl,
  }).then(({ model }) => model)
}

async function streamFailure(model: Awaited<ReturnType<typeof modelAt>>) {
  const response = await createAgentUIStreamResponse({
    agent: new ToolLoopAgent({ model, maxRetries: 0 }),
    uiMessages: [
      { id: 'user-1', role: 'user', parts: [{ type: 'text', text: 'hello' }] },
    ],
    onError: (error: unknown) =>
      toChatErrorText(error, { provider: 'openai-compatible' }),
  })
  const body = await response.text()
  const frame = body
    .split('\n')
    .find(
      (line) => line.startsWith('data: ') && line.includes('"type":"error"'),
    )
  if (!frame) throw new Error(`Expected stream error frame; got: ${body}`)
  return parseChatErrorEnvelope(JSON.parse(frame.slice(6)).errorText)
}

async function streamWithAgent(model: Awaited<ReturnType<typeof modelAt>>) {
  const response = await createAgentUIStreamResponse({
    agent: new ToolLoopAgent({ model, maxRetries: 0 }),
    uiMessages: [
      { id: 'user-1', role: 'user', parts: [{ type: 'text', text: 'hello' }] },
    ],
    onError: (error: unknown) =>
      toChatErrorText(error, { provider: 'openai-compatible' }),
  })
  return response.text()
}

afterEach(() => {
  for (const server of servers.splice(0)) server.stop(true)
})

describe('production provider loopback resilience', () => {
  it.each([401, 403])(
    'surfaces provider authentication status %i',
    async (statusCode) => {
      const baseUrl = startProvider(() =>
        Response.json(
          { error: { message: 'Credentials rejected' } },
          { status: statusCode },
        ),
      )
      const error = await streamFailure(await modelAt(baseUrl))
      expect(error?.code).toBe('auth_failed')
      expect(error?.statusCode).toBe(statusCode)
      expect(error?.retryable).toBe(false)
    },
    15000,
  )

  it('preserves the Retry-After hint and provider message for rate limits', async () => {
    const baseUrl = startProvider(
      () =>
        new Response(
          JSON.stringify({ error: { message: 'Quota window active' } }),
          {
            status: 429,
            headers: { 'content-type': 'application/json', 'retry-after': '7' },
          },
        ),
    )
    const error = await streamFailure(await modelAt(baseUrl))
    expect(error?.code).toBe('rate_limited')
    expect(error?.retryable).toBe(true)
    expect(error?.retryAfterSeconds).toBe(7)
    expect(error?.message).toContain('Quota window active')
  }, 15000)

  it('surfaces unavailable provider responses as retryable', async () => {
    const baseUrl = startProvider(() =>
      Response.json(
        { error: { message: 'Temporary upstream outage' } },
        { status: 503 },
      ),
    )
    const error = await streamFailure(await modelAt(baseUrl))
    expect(error?.code).toBe('provider_unavailable')
    expect(error?.retryable).toBe(true)
    expect(error?.statusCode).toBe(503)
  }, 15000)

  it('surfaces a refused local provider connection as actionable', async () => {
    const baseUrl = startProvider(() => new Response('unused'))
    const server = servers.pop()
    server?.stop(true)
    const error = await streamFailure(await modelAt(baseUrl))
    expect(error?.code).toBe('connection_failed')
    expect(error?.retryable).toBe(true)
    expect(error?.docsUrl).toContain('troubleshooting/connection-issues')
  }, 15000)

  it('reports an interrupted provider stream with a connection error envelope', async () => {
    const baseUrl = startProvider(
      () =>
        new Response(
          new ReadableStream<Uint8Array>({
            start(controller) {
              controller.enqueue(new TextEncoder().encode('data: {"choices":['))
              controller.error(new Error('fixture stream interrupted'))
            },
          }),
          { headers: { 'content-type': 'text/event-stream' } },
        ),
    )
    const error = await streamFailure(await modelAt(baseUrl))
    expect(error?.code).toBe('connection_failed')
    expect(error?.retryable).toBe(true)
  }, 15000)

  it('retains partial assistant output when the provider stream fails afterward', async () => {
    const baseUrl = startProvider(
      () =>
        new Response(
          new ReadableStream<Uint8Array>({
            start(controller) {
              controller.enqueue(
                new TextEncoder().encode(
                  `data: ${JSON.stringify({
                    id: 'fixture-partial',
                    object: 'chat.completion.chunk',
                    created: 1,
                    model: 'fixture-tool-model',
                    choices: [
                      {
                        index: 0,
                        delta: {
                          role: 'assistant',
                          content: 'partial provider answer',
                        },
                        finish_reason: null,
                      },
                    ],
                  })}\n\n`,
                ),
              )
              setTimeout(() => {
                controller.enqueue(
                  new TextEncoder().encode(
                    `data: ${JSON.stringify({ error: { message: 'provider stream failed', type: 'server_error' } })}\n\n`,
                  ),
                )
                controller.close()
              }, 50)
            },
          }),
          { headers: { 'content-type': 'text/event-stream' } },
        ),
    )
    const body = await streamWithAgent(await modelAt(baseUrl))
    expect(body).toContain('partial provider answer')
    expect(body).toContain('"type":"error"')
    expect(body).toContain('provider stream failed')
  }, 15000)
})
