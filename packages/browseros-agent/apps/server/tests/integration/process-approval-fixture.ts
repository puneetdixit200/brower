/**
 * Opt-in actual-process approval fixture for the production server binary.
 *
 * This deliberately starts only loopback fixtures and an isolated headless
 * Chromium. It requires `--execute` so reviewing the launch plan never starts
 * a child process by accident. `--restart` checks that pending approvals cannot
 * be accepted or replayed after a forced server restart.
 */

import { Database } from 'bun:sqlite'
import { type ChildProcess, spawn } from 'node:child_process'
import { createHash } from 'node:crypto'
import { closeSync, openSync, readlinkSync } from 'node:fs'
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { createServer } from 'node:net'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import {
  createMcpHonoApp,
  localhostHostValidation,
} from '@modelcontextprotocol/hono'
import {
  McpServer,
  WebStandardStreamableHTTPServerTransport,
} from '@modelcontextprotocol/server'
import { z } from 'zod'

const REPO_ROOT = resolve(import.meta.dir, '../../../..')
const DEFAULT_SERVER = join(
  REPO_ROOT,
  'dist/prod/aster-server/linux-x64/resources/bin/aster_server',
)
const RESOURCES = join(REPO_ROOT, 'dist/prod/aster-server/linux-x64/resources')
const APP_ID = 'oifdmombnijnaiocijiacjhajbnpdlhb'
const CHILD_ENV_KEYS = [
  'PATH',
  'HOME',
  'LANG',
  'LC_ALL',
  'TMPDIR',
  'APPIMAGE_EXTRACT_AND_RUN',
] as const
const BROWSER_FIXTURE_MARKER = 'ASTER_BROWSER_FIXTURE_NAVIGATE'
const BROWSER_SENTINEL = 'ASTER_LOCAL_PAGE_SENTINEL_71C4'
const BROWSER_PAGE_TITLE = 'Aster Local Fixture'
const PARTIAL_TRANSCRIPT_MARKER = 'ASTER_PARTIAL_TRANSCRIPT_FIXTURE'
const PARTIAL_TRANSCRIPT_TEXT = 'Synthetic partial transcript. '.repeat(12)

type FixtureCall = { destination: string; body: string }
type BrowserToolStep = {
  toolName: string | null
  input?: Record<string, unknown>
  targetPageId?: number
  observedToolResults: string[]
}

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message)
}

function assertDispatchCount(
  dispatches: FixtureCall[],
  expected: number,
  message: string,
): void {
  if (dispatches.length !== expected) throw new Error(message)
}

function historyToolNames(messages: unknown[]): string[] {
  return messages.flatMap((message) => {
    if (!message || typeof message !== 'object') return []
    const object = message as Record<string, unknown>
    if (!Array.isArray(object.tool_calls)) return []
    return object.tool_calls.flatMap((call) => {
      if (!call || typeof call !== 'object') return []
      const fn = (call as { function?: { name?: unknown } }).function
      return typeof fn?.name === 'string' ? [fn.name] : []
    })
  })
}

function capturedModelMessages(requests: unknown[]): unknown[] {
  return requests.map((request, requestIndex) => {
    const object = request as { messages?: unknown }
    const messages = Array.isArray(object?.messages) ? object.messages : []
    return {
      requestIndex,
      messages: messages.flatMap((message) => {
        if (!message || typeof message !== 'object') return []
        const item = message as Record<string, unknown>
        if (!['assistant', 'tool', 'user'].includes(String(item.role)))
          return []
        return [
          {
            role: item.role,
            content: item.content,
            tool_calls: item.tool_calls,
            tool_call_id: item.tool_call_id,
            name: item.name,
          },
        ]
      }),
    }
  })
}

function toolResultText(messages: unknown[]): string[] {
  return messages.flatMap((message) => {
    if (!message || typeof message !== 'object') return []
    const object = message as Record<string, unknown>
    return object.role === 'tool' ? [JSON.stringify(object.content ?? '')] : []
  })
}

function pageIdFromToolResults(
  messages: unknown[],
  expectedUrl = 'about:blank',
): number | null {
  const text = toolResultText(messages).join('\n')
  const escapedUrl = expectedUrl.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  const readable = text.match(
    new RegExp(`\\[(\\d+)\\]\\s+${escapedUrl}(?:\\s|\\()`, 'i'),
  )
  const structured = text.match(
    new RegExp(`"page":\\s*(\\d+)[^}]*"url":\\s*"${escapedUrl}"`, 'i'),
  )
  const value = Number(readable?.[1] ?? structured?.[1])
  return Number.isSafeInteger(value) && value > 0 ? value : null
}

function selectModelStep(
  messages: unknown[],
  toolNames: string[],
  pagePort: number,
  browserToolSteps: BrowserToolStep[],
): {
  toolName: string | null
  input?: Record<string, unknown>
  finalText: string
} {
  const callHistory = historyToolNames(messages)
  const resultHistory = toolResultText(messages)
  const browserScenario = JSON.stringify(messages).includes(
    BROWSER_FIXTURE_MARKER,
  )
  if (!browserScenario) {
    if (callHistory.some((name) => name.includes('send_message')))
      return { toolName: null, finalText: 'Fixture turn complete.' }
    const toolName = toolNames.find((name) => name.includes('send_message'))
    if (!toolName)
      throw new Error('send_message tool missing from model advertisement')
    return {
      toolName,
      input: { destination: 'sink@example.test', body: 'fixture body' },
      finalText: 'Fixture turn complete.',
    }
  }

  const lastCall = callHistory.at(-1)
  if (lastCall === 'read' && callHistory.includes('navigate')) {
    const hasSentinel = resultHistory.some((text) =>
      text.includes(BROWSER_SENTINEL),
    )
    const hasTitle = resultHistory.some((text) =>
      text.includes(BROWSER_PAGE_TITLE),
    )
    if (!hasSentinel || !hasTitle)
      throw new Error(
        'read tool output did not include the local page title and sentinel',
      )
    browserToolSteps.push({
      toolName: null,
      observedToolResults: resultHistory,
    })
    return {
      toolName: null,
      finalText: `Read ${BROWSER_PAGE_TITLE}; sentinel ${BROWSER_SENTINEL}.`,
    }
  }
  if (lastCall === 'navigate') {
    const toolName = toolNames.find((name) => name === 'tabs')
    if (!toolName) throw new Error('tabs tool missing from model advertisement')
    const input = { action: 'list' }
    browserToolSteps.push({
      toolName,
      input,
      observedToolResults: resultHistory,
    })
    return {
      toolName,
      input,
      finalText: 'Read the local fixture title and sentinel.',
    }
  }
  if (lastCall === 'tabs' && callHistory.includes('navigate')) {
    const expectedUrl = `http://127.0.0.1:${pagePort}/fixture`
    const targetPageId = pageIdFromToolResults(messages, expectedUrl)
    if (targetPageId === null)
      throw new Error('tabs list did not return the exact local fixture page')
    const toolName = toolNames.find((name) => name === 'read')
    if (!toolName) throw new Error('read tool missing from model advertisement')
    const input = { page: targetPageId, format: 'text' }
    browserToolSteps.push({
      toolName,
      input,
      targetPageId,
      observedToolResults: resultHistory,
    })
    return {
      toolName,
      input,
      finalText: 'Read the local fixture title and sentinel.',
    }
  }
  if (lastCall === 'tabs') {
    const toolName = toolNames.find((name) => name === 'navigate')
    if (!toolName)
      throw new Error('navigate tool missing from model advertisement')
    const targetPageId = pageIdFromToolResults(messages)
    if (targetPageId === null) {
      browserToolSteps.push({
        toolName: null,
        observedToolResults: resultHistory,
      })
      return {
        toolName: null,
        finalText: 'Browser tabs tool did not return a usable page ID.',
      }
    }
    const input = {
      page: targetPageId,
      action: 'url',
      url: `http://127.0.0.1:${pagePort}/fixture`,
    }
    browserToolSteps.push({
      toolName,
      input,
      targetPageId,
      observedToolResults: resultHistory,
    })
    return {
      toolName,
      input,
      finalText: 'Read the local fixture title and sentinel.',
    }
  }
  const toolName = toolNames.find((name) => name === 'tabs')
  if (!toolName) throw new Error('tabs tool missing from model advertisement')
  const input = { action: 'list' }
  browserToolSteps.push({ toolName, input, observedToolResults: resultHistory })
  return {
    toolName,
    input,
    finalText: 'Read the local fixture title and sentinel.',
  }
}

function assertAdvertisedToolSchema(tools: unknown[], toolName: string): void {
  const advertised = tools.find(
    (tool) =>
      !!tool &&
      typeof tool === 'object' &&
      (tool as { function?: { name?: unknown } }).function?.name === toolName,
  ) as { function?: { parameters?: unknown } } | undefined
  const parameters = advertised?.function?.parameters as
    | { properties?: Record<string, { enum?: unknown[]; type?: string }> }
    | undefined
  assert(
    parameters?.properties,
    `Advertised tool ${toolName} has no parameter schema`,
  )
  if (toolName === 'tabs')
    assert(
      parameters.properties.action?.enum?.includes('list'),
      'tabs schema lacks action=list',
    )
  if (toolName === 'navigate') {
    assert(
      parameters.properties.page?.type === 'integer' ||
        parameters.properties.page?.type === 'number',
      'navigate schema lacks a numeric page field',
    )
    assert(
      parameters.properties.action?.enum?.includes('url'),
      'navigate schema lacks action=url',
    )
    assert(
      parameters.properties.url?.type === 'string',
      'navigate schema lacks a URL string field',
    )
  }
}

function makeCompletionChunks(
  responseId: string,
  toolName: string | null,
  input: Record<string, unknown> | undefined,
  finalText: string,
): Record<string, unknown>[] {
  const toolCall = toolName
    ? {
        id: `fixture-call-${responseId}`,
        type: 'function',
        function: { name: toolName, arguments: JSON.stringify(input) },
      }
    : undefined
  const finishReason = toolCall ? 'tool_calls' : 'stop'
  const firstDelta = toolCall
    ? { role: 'assistant', tool_calls: [{ index: 0, ...toolCall }] }
    : { role: 'assistant', content: finalText }
  return [
    {
      id: responseId,
      object: 'chat.completion.chunk',
      created: 1,
      model: 'fixture-model',
      choices: [{ index: 0, delta: firstDelta, finish_reason: null }],
    },
    {
      id: responseId,
      object: 'chat.completion.chunk',
      created: 1,
      model: 'fixture-model',
      choices: [{ index: 0, delta: {}, finish_reason: finishReason }],
    },
  ]
}

async function freePort(): Promise<number> {
  const server = createServer()
  await new Promise<void>((resolveListen, reject) => {
    server.once('error', reject)
    server.listen(0, '127.0.0.1', resolveListen)
  })
  const address = server.address()
  assert(
    address && typeof address !== 'string',
    'Could not reserve a loopback port',
  )
  const port = address.port
  await new Promise<void>((resolveClose, reject) =>
    server.close((error) => (error ? reject(error) : resolveClose())),
  )
  return port
}

async function waitForHealth(
  url: string,
  process: ChildProcess,
  logPath: string,
  getSpawnError: () => Error | undefined,
) {
  const deadline = Date.now() + 30_000
  while (Date.now() < deadline) {
    if (getSpawnError()) throw getSpawnError()
    if (process.exitCode !== null) {
      throw new Error(
        `Aster sidecar exited (${process.exitCode}); log: ${logPath}`,
      )
    }
    try {
      const response = await fetch(url, { signal: AbortSignal.timeout(500) })
      if (response.ok) return
    } catch {
      // Startup is expected to take a moment while Chromium/CDP initializes.
    }
    await Bun.sleep(200)
  }
  throw new Error(`Aster sidecar did not become healthy; log: ${logPath}`)
}

async function readSse(response: Response): Promise<string> {
  assert(response.ok, `Chat HTTP failed: ${response.status}`)
  const reader = response.body?.getReader()
  assert(reader, 'Chat response had no stream body')
  const decoder = new TextDecoder()
  let output = ''
  while (true) {
    const { done, value } = await reader.read()
    if (done) break
    output += decoder.decode(value, { stream: true })
    assert(output.length < 2_000_000, 'Chat stream exceeded fixture limit')
  }
  output += decoder.decode()
  return output
}

function approvalIdFromSse(raw: string): string {
  for (const line of raw.split(/\r?\n/)) {
    if (!line.startsWith('data:')) continue
    const text = line.slice(5).trim()
    if (!text || text === '[DONE]') continue
    let value: unknown
    try {
      value = JSON.parse(text)
    } catch {
      continue
    }
    const stack: unknown[] = [value]
    while (stack.length) {
      const current = stack.pop()
      if (!current || typeof current !== 'object') continue
      if (Array.isArray(current)) {
        stack.push(...current)
        continue
      }
      const object = current as Record<string, unknown>
      if (
        object.type === 'tool-approval-request' &&
        typeof object.approvalId === 'string'
      ) {
        return object.approvalId
      }
      if (object.state === 'approval-requested') {
        const approval = object.approval as Record<string, unknown> | undefined
        if (typeof approval?.id === 'string') return approval.id
      }
      stack.push(...Object.values(object))
    }
  }
  throw new Error(`No approval id in SSE; first bytes: ${raw.slice(0, 1200)}`)
}

function assistantTextFromSse(raw: string): string {
  const textById = new Map<string, string>()
  const completedTexts: string[] = []
  for (const line of raw.split(/\r?\n/)) {
    if (!line.startsWith('data:')) continue
    let value: unknown
    try {
      value = JSON.parse(line.slice(5).trim())
    } catch {
      continue
    }
    if (!value || typeof value !== 'object') continue
    const event = value as { type?: unknown; id?: unknown; delta?: unknown }
    if (typeof event.id !== 'string') continue
    if (event.type === 'text-start') {
      textById.set(event.id, '')
    } else if (
      event.type === 'text-delta' &&
      typeof event.delta === 'string' &&
      textById.has(event.id)
    ) {
      textById.set(event.id, `${textById.get(event.id)}${event.delta}`)
    } else if (event.type === 'text-end' && textById.has(event.id)) {
      completedTexts.push(textById.get(event.id) ?? '')
    }
  }
  return completedTexts.at(-1) ?? ''
}

function persistedPendingApproval(
  messages: unknown,
  approvalId: string,
): Record<string, unknown> {
  assert(Array.isArray(messages), 'Persisted conversation messages are invalid')
  const matches = messages.flatMap((message) => {
    if (!message || typeof message !== 'object') return []
    const object = message as { role?: unknown; parts?: unknown }
    if (object.role !== 'assistant' || !Array.isArray(object.parts)) return []
    return object.parts.flatMap((part) => {
      if (!part || typeof part !== 'object') return []
      const toolPart = part as {
        type?: unknown
        toolCallId?: unknown
        state?: unknown
        approval?: { id?: unknown }
      }
      const isToolPart =
        toolPart.type === 'dynamic-tool' ||
        (typeof toolPart.type === 'string' && toolPart.type.startsWith('tool-'))
      return isToolPart &&
        toolPart.state === 'approval-requested' &&
        toolPart.approval?.id === approvalId
        ? [toolPart as Record<string, unknown>]
        : []
    })
  })
  assert(
    matches.length === 1,
    `Expected exactly one assistant tool part with approval ${approvalId} in approval-requested state; found ${matches.length}`,
  )
  assert(
    typeof matches[0].toolCallId === 'string',
    'Persisted pending approval has no toolCallId',
  )
  return matches[0]
}

async function main() {
  const execute = process.argv.includes('--execute')
  const browserMode = process.argv.includes('--browser')
  const partialRestartMode = process.argv.includes('--partial-restart')
  const restartMode = process.argv.includes('--restart') || partialRestartMode
  assert(
    !(browserMode && restartMode),
    '--browser and --restart are separate fixture modes',
  )
  if (browserMode) {
    const currentNetNamespace = readlinkSync('/proc/self/ns/net')
    const hostNamespaceFd = process.env.ASTER_FIXTURE_HOST_NETNS_FD
    let hostNetNamespace: string | undefined
    if (hostNamespaceFd && /^\d+$/.test(hostNamespaceFd)) {
      try {
        hostNetNamespace = readlinkSync(`/proc/self/fd/${hostNamespaceFd}`)
      } catch {
        // Missing or closed descriptors fail the guard below.
      }
    }
    assert(
      typeof hostNetNamespace === 'string' &&
        /^net:\[\d+\]$/.test(hostNetNamespace) &&
        currentNetNamespace !== hostNetNamespace,
      '--browser requires a distinct network namespace; use tests/integration/run_browser_process_fixture_isolated.py',
    )
  }
  if (
    process.argv.some(
      (arg) =>
        !['--execute', '--browser', '--restart', '--partial-restart'].includes(
          arg,
        ) &&
        arg !== process.argv[0] &&
        arg !== process.argv[1],
    )
  ) {
    throw new Error(
      'Usage: bun tests/integration/process-approval-fixture.ts [--execute] [--browser] [--restart|--partial-restart]\nDefault --execute runs approval/deny/replay only. --browser adds local-page navigation and requires BrowserOS Chromium with Browser.getTabs CDP support. --restart tests pending-approval failure after SIGKILL/restart. --partial-restart kills a streaming run and verifies bounded transcript recovery without replay. Set ASTER_SERVER_BINARY and CHROMIUM_BINARY to select binaries.',
    )
  }
  const binary = resolve(process.env.ASTER_SERVER_BINARY ?? DEFAULT_SERVER)
  const chromium = resolve(process.env.CHROMIUM_BINARY ?? '/usr/bin/chromium')
  const runDir = await mkdtemp(join(tmpdir(), 'aster-chat-process-'))
  const ports = {
    server: await freePort(),
    cdp: await freePort(),
    model: await freePort(),
    mcp: await freePort(),
    page: await freePort(),
  }
  const paths = {
    config: join(runDir, 'sidecar.json'),
    state: join(runDir, 'aster-state'),
    execution: join(runDir, 'execution'),
    profile: join(runDir, 'chromium-profile'),
    serverLog: join(runDir, 'sidecar.log'),
    browserLog: join(runDir, 'chromium.log'),
    evidence: join(runDir, 'evidence.json'),
  }
  await Promise.all(
    [paths.state, paths.execution, paths.profile].map((p) =>
      mkdir(p, { recursive: true }),
    ),
  )
  const config = {
    ports: { server: ports.server, cdp: ports.cdp },
    directories: { resources: RESOURCES, execution: paths.execution },
    flags: { allow_remote_in_mcp: false },
    instance: {
      client_id: 'process-approval-fixture',
      install_id: 'process-approval-fixture',
      browseros_version: 'integration-fixture',
      chromium_version: browserMode
        ? 'browseros-chromium-fixture'
        : 'system-chromium',
    },
  }
  await writeFile(paths.config, `${JSON.stringify(config, null, 2)}\n`, {
    mode: 0o600,
  })

  const argv = [binary, '--config', paths.config]
  const browserArgv = [
    chromium,
    '--headless=new',
    `--user-data-dir=${paths.profile}`,
    // Defense-in-depth only; the isolated network namespace is the egress boundary.
    '--host-resolver-rules=MAP * ~NOTFOUND, EXCLUDE 127.0.0.1',
    '--remote-debugging-address=127.0.0.1',
    `--remote-debugging-port=${ports.cdp}`,
    '--no-first-run',
    '--no-default-browser-check',
    'about:blank',
  ]
  const plan = {
    mode: partialRestartMode
      ? 'partial-transcript-restart'
      : restartMode
        ? 'approval-restart'
        : browserMode
          ? 'approval-and-browser'
          : 'approval-only',
    browserPrerequisite: browserMode
      ? 'BrowserOS Chromium exposing the Browser.getTabs CDP extension; stock Chromium is insufficient.'
      : undefined,
    binary,
    argv,
    browserArgv,
    ports,
    configPath: paths.config,
    config,
    stateDirectory: paths.state,
    evidencePath: paths.evidence,
    launchAllowed: execute,
  }
  console.log(JSON.stringify(plan, null, 2))
  if (!execute) {
    await rm(runDir, { recursive: true, force: true })
    return
  }

  assert(await Bun.file(binary).exists(), `Missing sidecar binary: ${binary}`)
  assert(
    await Bun.file(chromium).exists(),
    `Missing Chromium binary: ${chromium}`,
  )
  const modelRequests: unknown[] = []
  const advertisedToolNames: string[][] = []
  const syntheticModelResponses: unknown[] = []
  const browserToolSteps: Array<{
    toolName: string | null
    input?: Record<string, unknown>
    targetPageId?: number
    observedToolResults: string[]
  }> = []
  const browserPageRequests: string[] = []
  const dispatches: FixtureCall[] = []
  let browserSseOutput = ''
  let modelCall = 0
  let modelServer: ReturnType<typeof Bun.serve> | undefined
  let mcpHttp: ReturnType<typeof Bun.serve> | undefined
  let pageHttp: ReturnType<typeof Bun.serve> | undefined
  let transport: WebStandardStreamableHTTPServerTransport | undefined
  let browserProcess: ChildProcess | undefined
  let serverProcess: ChildProcess | undefined
  let browserSpawnError: Error | undefined
  let serverSpawnError: Error | undefined
  let browserLogFd: number | undefined
  let serverLogFd: number | undefined
  let cleanupPromise: Promise<void> | undefined
  let restartEvidence: Record<string, unknown> | undefined
  const cleanup = (): Promise<void> => {
    if (cleanupPromise) return cleanupPromise
    cleanupPromise = (async () => {
      modelServer?.stop(true)
      mcpHttp?.stop(true)
      pageHttp?.stop(true)
      await transport?.close().catch(() => undefined)
      serverProcess?.kill('SIGTERM')
      browserProcess?.kill('SIGTERM')
      await Promise.all(
        [serverProcess, browserProcess]
          .filter(Boolean)
          .filter((child) => child !== serverProcess || !serverSpawnError)
          .filter((child) => child !== browserProcess || !browserSpawnError)
          .map((child) => waitChild(child as ChildProcess)),
      )
      if (browserLogFd !== undefined) closeSync(browserLogFd)
      if (serverLogFd !== undefined) closeSync(serverLogFd)
    })()
    return cleanupPromise
  }
  const handleSignal = (signal: NodeJS.Signals) => {
    void cleanup().then(() => process.exit(signal === 'SIGINT' ? 130 : 143))
  }
  process.once('SIGINT', handleSignal)
  process.once('SIGTERM', handleSignal)

  try {
    pageHttp = Bun.serve({
      hostname: '127.0.0.1',
      port: ports.page,
      fetch(request) {
        const url = new URL(request.url)
        if (url.pathname !== '/fixture')
          return new Response('not found', { status: 404 })
        browserPageRequests.push(url.pathname)
        return new Response(
          `<!doctype html><html><head><title>${BROWSER_PAGE_TITLE}</title></head><body><h1>${BROWSER_PAGE_TITLE}</h1><main>${BROWSER_SENTINEL}</main></body></html>`,
          { headers: { 'Content-Type': 'text/html; charset=utf-8' } },
        )
      },
    })
    modelServer = Bun.serve({
      hostname: '127.0.0.1',
      port: ports.model,
      async fetch(request) {
        const url = new URL(request.url)
        if (url.pathname === '/v1/models') {
          return Response.json({
            object: 'list',
            data: [{ id: 'fixture-model', object: 'model' }],
          })
        }
        if (
          url.pathname !== '/v1/chat/completions' ||
          request.method !== 'POST'
        ) {
          return new Response('not found', { status: 404 })
        }
        const body = (await request.json()) as Record<string, unknown>
        modelRequests.push(body)
        const messages = Array.isArray(body.messages) ? body.messages : []
        const tools = Array.isArray(body.tools) ? body.tools : []
        const toolNames = tools.flatMap((tool) => {
          if (!tool || typeof tool !== 'object') return []
          const fn = (tool as { function?: { name?: unknown } }).function
          return typeof fn?.name === 'string' ? [fn.name] : []
        })
        advertisedToolNames.push(toolNames)
        modelCall++
        const responseId = `chatcmpl-process-fixture-${modelCall}`
        const partialTranscriptScenario =
          partialRestartMode &&
          JSON.stringify(messages).includes(PARTIAL_TRANSCRIPT_MARKER)
        const selection = partialTranscriptScenario
          ? { toolName: null, finalText: PARTIAL_TRANSCRIPT_TEXT }
          : selectModelStep(messages, toolNames, ports.page, browserToolSteps)
        if (selection.toolName)
          assertAdvertisedToolSchema(tools, selection.toolName)
        const toolCall = selection.toolName
          ? {
              id: `fixture-call-${modelCall}`,
              type: 'function',
              function: {
                name: selection.toolName,
                arguments: JSON.stringify(selection.input),
              },
            }
          : undefined
        const content = toolCall
          ? { role: 'assistant', content: null, tool_calls: [toolCall] }
          : { role: 'assistant', content: selection.finalText }
        const finishReason = toolCall ? 'tool_calls' : 'stop'
        if (body.stream !== true) {
          return Response.json({
            id: responseId,
            object: 'chat.completion',
            created: 1,
            model: 'fixture-model',
            choices: [
              { index: 0, message: content, finish_reason: finishReason },
            ],
          })
        }
        const chunks = makeCompletionChunks(
          responseId,
          selection.toolName,
          selection.input,
          selection.finalText,
        )
        if (partialTranscriptScenario) {
          const partialChunk = {
            id: responseId,
            object: 'chat.completion.chunk',
            created: 1,
            model: 'fixture-model',
            choices: [
              {
                index: 0,
                delta: { role: 'assistant', content: PARTIAL_TRANSCRIPT_TEXT },
                finish_reason: null,
              },
            ],
          }
          syntheticModelResponses.push(partialChunk)
          const encoder = new TextEncoder()
          return new Response(
            new ReadableStream<Uint8Array>({
              start(controller) {
                controller.enqueue(
                  encoder.encode(`data: ${JSON.stringify(partialChunk)}\n\n`),
                )
                // Deliberately keep the fixture provider response open until
                // the parent kills the sidecar after its DB checkpoint.
              },
            }),
            { headers: { 'Content-Type': 'text/event-stream' } },
          )
        }
        syntheticModelResponses.push(...chunks)
        return new Response(
          `${chunks.map((chunk) => `data: ${JSON.stringify(chunk)}\n\n`).join('')}data: [DONE]\n\n`,
          {
            headers: {
              'Content-Type': 'text/event-stream',
              'Cache-Control': 'no-cache',
            },
          },
        )
      },
    })

    const mcpServer = new McpServer({
      name: 'process-fixture',
      version: '1.0.0',
    })
    mcpServer.registerTool(
      'send_message',
      {
        description:
          'Post an external message to a destination. This is a fixture side effect.',
        inputSchema: { destination: z.string(), body: z.string() },
      },
      async ({ destination, body }) => {
        dispatches.push({ destination, body })
        return { content: [{ type: 'text', text: 'fixture accepted' }] }
      },
    )
    const currentTransport = new WebStandardStreamableHTTPServerTransport({
      sessionIdGenerator: undefined,
    })
    transport = currentTransport
    await mcpServer.connect(currentTransport)
    const mcpApp = createMcpHonoApp()
    mcpApp.use('*', localhostHostValidation())
    mcpApp.all('/mcp', (context) =>
      currentTransport.handleRequest(context.req.raw, {
        parsedBody: (context as unknown as { get(key: string): unknown }).get(
          'parsedBody',
        ),
      }),
    )
    mcpHttp = Bun.serve({
      hostname: '127.0.0.1',
      port: ports.mcp,
      fetch: mcpApp.fetch,
    })

    const env = Object.fromEntries(
      CHILD_ENV_KEYS.flatMap((key) =>
        process.env[key] ? [[key, process.env[key] as string]] : [],
      ),
    )
    Object.assign(env, {
      NODE_ENV: 'test',
      HOME: runDir,
      TMPDIR: runDir,
      ASTER_DIR: paths.state,
      BROWSEROS_USE_MOCK_LLM: '',
    })
    if (browserMode && chromium.endsWith('.AppImage')) {
      env.APPIMAGE_EXTRACT_AND_RUN = '1'
    }
    browserLogFd = openSync(paths.browserLog, 'w')
    serverLogFd = openSync(paths.serverLog, 'w')
    // The outer network namespace maps the invoking user to UID 0 so it can
    // bring up loopback. Run Chromium as that same host user through a nested
    // UID map so Chromium can keep its sandbox enabled without appearing root.
    const browserCommand = browserMode ? 'unshare' : chromium
    const browserArgs = browserMode
      ? [
          '--user',
          '--map-user',
          '1000',
          '--setuid',
          '1000',
          '--',
          chromium,
          ...browserArgv.slice(1),
        ]
      : browserArgv.slice(1)
    browserProcess = spawn(browserCommand, browserArgs, {
      env,
      stdio: ['ignore', browserLogFd, browserLogFd],
    })
    browserProcess.on('error', (error) => {
      browserSpawnError = error
    })
    await waitForCdp(ports.cdp, browserProcess, () => browserSpawnError)
    serverProcess = spawn(binary, ['--config', paths.config], {
      env,
      stdio: ['ignore', serverLogFd, serverLogFd],
    })
    serverProcess.on('error', (error) => {
      serverSpawnError = error
    })
    await waitForHealth(
      `http://127.0.0.1:${ports.server}/system/health`,
      serverProcess,
      paths.serverLog,
      () => serverSpawnError,
    )

    const base = `http://127.0.0.1:${ports.server}/chat`
    const makeRequest = async (
      conversationId: string,
      approvalResponse?: { id: string; approved: boolean },
      userMessage = 'Send the fixture message.',
      readBody = true,
    ) => {
      const response = await fetch(base, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Origin: `chrome-extension://${APP_ID}`,
        },
        body: JSON.stringify({
          conversationId,
          message: approvalResponse ? '' : userMessage,
          target: { type: 'browseros' },
          provider: 'openai-compatible',
          model: 'fixture-model',
          baseUrl: `http://127.0.0.1:${ports.model}/v1`,
          apiKey: 'fixture-only-key',
          mode: 'agent',
          // The restart mode must restore the pending approval from SQLite.
          persist: restartMode,
          browserContext: {
            customMcpServers: [
              { name: 'fixture', url: `http://127.0.0.1:${ports.mcp}/mcp` },
            ],
          },
          ...(approvalResponse ? { approvalResponse } : {}),
        }),
        signal: AbortSignal.timeout(30_000),
      })
      return {
        response,
        text: readBody
          ? response.ok
            ? await readSse(response)
            : await response.text()
          : '',
      }
    }

    const runPartialTranscriptRestart = async () => {
      const conversationId = crypto.randomUUID()
      const initial = await makeRequest(
        conversationId,
        undefined,
        `${PARTIAL_TRANSCRIPT_MARKER}: return a partial answer and keep streaming.`,
        false,
      )
      assert(
        initial.response.status === 200,
        `Initial partial-transcript chat failed: ${initial.response.status}`,
      )
      const pendingClientRead = readSse(initial.response).catch(() => '')
      const stateDbPath = join(paths.state, 'db', 'browseros.sqlite')
      const stateDb = new Database(stateDbPath, { readonly: true })
      const deadline = Date.now() + 15_000
      let checkpoint: { text?: string } | null = null
      try {
        while (Date.now() < deadline) {
          checkpoint = stateDb
            .query(
              'SELECT text FROM conversation_run_text_checkpoints WHERE conversation_id = ?',
            )
            .get(conversationId) as { text?: string } | null
          if (checkpoint?.text === PARTIAL_TRANSCRIPT_TEXT) break
          await Bun.sleep(50)
        }
        assert(
          checkpoint?.text === PARTIAL_TRANSCRIPT_TEXT,
          'Partial assistant text was not durably checkpointed before sidecar interruption',
        )
      } finally {
        stateDb.close()
      }

      const interruptedProcess = serverProcess
      assert(interruptedProcess, 'Sidecar process has no PID for SIGKILL case')
      const interruptedPid = interruptedProcess.pid
      assert(interruptedPid, 'Sidecar process has no PID for SIGKILL case')
      interruptedProcess.kill('SIGKILL')
      await waitForExit(interruptedProcess, 5_000)
      assert(
        interruptedProcess.signalCode === 'SIGKILL',
        `Expected SIGKILL, received ${interruptedProcess.signalCode ?? interruptedProcess.exitCode}`,
      )
      await pendingClientRead

      const restartedProcess = spawn(binary, ['--config', paths.config], {
        env,
        stdio: ['ignore', serverLogFd, serverLogFd],
      })
      serverProcess = restartedProcess
      serverSpawnError = undefined
      restartedProcess.on('error', (error) => {
        serverSpawnError = error
      })
      await waitForHealth(
        `http://127.0.0.1:${ports.server}/system/health`,
        restartedProcess,
        paths.serverLog,
        () => serverSpawnError,
      )
      const stateResponse = await fetch(
        `${base}/${encodeURIComponent(conversationId)}/state`,
        {
          headers: { Origin: `chrome-extension://${APP_ID}` },
          signal: AbortSignal.timeout(5_000),
        },
      )
      assert(
        stateResponse.status === 200,
        `Recovered state returned HTTP ${stateResponse.status}`,
      )
      const snapshot = (await stateResponse.json()) as Record<string, unknown>
      assert(
        snapshot.status === 'interrupted',
        'Recovered run is not interrupted',
      )
      assert(
        snapshot.partialTranscript === PARTIAL_TRANSCRIPT_TEXT,
        'Recovered state did not expose the exact durable partial transcript',
      )
      assert(
        !('messages' in snapshot),
        'Interrupted recovery exposed replayable messages',
      )
      assert(
        modelRequests.length === 1,
        `Expected no post-restart provider replay; observed ${modelRequests.length} requests`,
      )
      assertDispatchCount(
        dispatches,
        0,
        'Interrupted transcript recovery dispatched an MCP action',
      )
      const evidence = {
        status: 'passed',
        mode: 'partial-transcript-restart',
        serverBinary: binary,
        serverSha256: createHash('sha256')
          .update(new Uint8Array(await Bun.file(binary).arrayBuffer()))
          .digest('hex'),
        config,
        ports,
        stateDirectory: paths.state,
        stateDbPath,
        conversationId,
        interruptedPid,
        restartedPid: restartedProcess.pid,
        requestCount: modelRequests.length,
        postRestartModelRequests: 0,
        partialTranscriptBytes: Buffer.byteLength(
          String(snapshot.partialTranscript),
          'utf8',
        ),
        modelMessages: capturedModelMessages(modelRequests),
        syntheticModelResponses,
        dispatches,
        zeroDispatchesAfterRestart: dispatches.length === 0,
        evidencePath: paths.evidence,
      }
      await writeFile(
        paths.evidence,
        `${JSON.stringify(evidence, null, 2)}\n`,
        {
          mode: 0o600,
        },
      )
      console.log(JSON.stringify(evidence, null, 2))
      return
    }

    if (partialRestartMode) {
      await runPartialTranscriptRestart()
      return
    }

    if (restartMode) {
      const conversationId = crypto.randomUUID()
      const initial = await makeRequest(conversationId)
      assert(
        initial.response.status === 200,
        `Initial chat failed: ${initial.response.status}`,
      )
      const approvalId = approvalIdFromSse(initial.text)
      assertDispatchCount(dispatches, 0, 'Tool dispatched before approval')
      const requestCountBeforeRestart = modelRequests.length
      const stateDbPath = join(paths.state, 'db', 'browseros.sqlite')
      const stateDb = new Database(stateDbPath, { readonly: true })
      try {
        const row = stateDb
          .query('SELECT messages FROM conversations WHERE id = ?')
          .get(conversationId) as { messages?: unknown } | null
        assert(
          typeof row?.messages === 'string',
          'Pending approval was not persisted',
        )
        restartEvidence = {
          persistedPendingApproval: persistedPendingApproval(
            JSON.parse(row.messages),
            approvalId,
          ),
        }
      } finally {
        stateDb.close()
      }

      const interruptedPid = serverProcess.pid
      assert(
        interruptedPid,
        'Server process has no PID for SIGKILL restart case',
      )
      serverProcess.kill('SIGKILL')
      await waitForExit(serverProcess, 5_000)
      assert(
        serverProcess.signalCode === 'SIGKILL',
        `Expected SIGKILL, received ${serverProcess.signalCode ?? serverProcess.exitCode}`,
      )

      serverProcess = spawn(binary, ['--config', paths.config], {
        env,
        stdio: ['ignore', serverLogFd, serverLogFd],
      })
      serverSpawnError = undefined
      serverProcess.on('error', (error) => {
        serverSpawnError = error
      })
      await waitForHealth(
        `http://127.0.0.1:${ports.server}/system/health`,
        serverProcess,
        paths.serverLog,
        () => serverSpawnError,
      )

      const staleApproval = await makeRequest(conversationId, {
        id: approvalId,
        approved: true,
      })
      restartEvidence = {
        ...restartEvidence,
        conversationId,
        approvalId,
        interruptedPid,
        restartedPid: serverProcess.pid,
        acceptedApprovalStatus: staleApproval.response.status,
        requestCountBeforeRestart,
      }
      assert(
        staleApproval.response.status === 409,
        `Expected stale approval to fail closed with 409, got ${staleApproval.response.status}`,
      )
      const stateDbAfterRestart = new Database(stateDbPath, { readonly: true })
      try {
        const row = stateDbAfterRestart
          .query('SELECT messages FROM conversations WHERE id = ?')
          .get(conversationId) as { messages?: unknown } | null
        assert(
          typeof row?.messages === 'string',
          'Expired approval conversation was not persisted after restart',
        )
        const messages = JSON.parse(row.messages) as unknown[]
        const originalPart = restartEvidence?.persistedPendingApproval as
          | { toolCallId?: unknown }
          | undefined
        const matchingParts = messages.flatMap((message) => {
          if (!message || typeof message !== 'object') return []
          const item = message as { role?: unknown; parts?: unknown }
          if (item.role !== 'assistant' || !Array.isArray(item.parts)) return []
          return item.parts.filter((part) => {
            if (!part || typeof part !== 'object') return false
            const toolPart = part as {
              type?: unknown
              toolCallId?: unknown
              approval?: { id?: unknown }
            }
            const isToolPart =
              toolPart.type === 'dynamic-tool' ||
              (typeof toolPart.type === 'string' &&
                toolPart.type.startsWith('tool-'))
            return (
              isToolPart &&
              toolPart.approval?.id === approvalId &&
              toolPart.toolCallId === originalPart?.toolCallId
            )
          })
        }) as Array<Record<string, unknown>>
        assert(
          matchingParts.length === 1,
          `Expected exactly one persisted assistant part for the expired approval; found ${matchingParts.length}`,
        )
        const approval = matchingParts[0].approval as
          | { id?: unknown; approved?: unknown; reason?: unknown }
          | undefined
        assert(
          matchingParts[0].state === 'approval-responded' &&
            approval?.id === approvalId &&
            approval.approved === false &&
            approval.reason ===
              'This approval expired when the server restarted. Review the action and request it again.',
          'Persisted approval was not rewritten to the exact restart-expiry denial',
        )
        restartEvidence.postRestartApproval = matchingParts[0]
      } finally {
        stateDbAfterRestart.close()
      }
      assertDispatchCount(
        dispatches,
        0,
        'Pending approval dispatched an MCP tool after server restart',
      )

      const replay = await makeRequest(conversationId, {
        id: approvalId,
        approved: true,
      })
      restartEvidence.replayStatus = replay.response.status
      assert(
        replay.response.status === 409,
        `Expected stale approval replay to fail closed with 409, got ${replay.response.status}`,
      )
      assertDispatchCount(
        dispatches,
        0,
        'Stale approval replay dispatched an MCP tool after server restart',
      )
      assert(
        modelRequests.length === requestCountBeforeRestart,
        'Stale approval or replay unexpectedly contacted the model provider',
      )

      const evidence = {
        status: 'passed',
        mode: 'approval-restart',
        serverBinary: binary,
        serverSha256: createHash('sha256')
          .update(new Uint8Array(await Bun.file(binary).arrayBuffer()))
          .digest('hex'),
        config,
        ports,
        stateDirectory: paths.state,
        stateDbPath,
        ...restartEvidence,
        requestCount: modelRequests.length,
        postRestartModelRequests:
          modelRequests.length - requestCountBeforeRestart,
        modelMessages: capturedModelMessages(modelRequests),
        advertisedToolNames,
        syntheticModelResponses,
        mcpEndpoint: `http://127.0.0.1:${ports.mcp}/mcp`,
        dispatches,
        zeroDispatchesAfterRestart: dispatches.length === 0,
        evidencePath: paths.evidence,
      }
      await writeFile(
        paths.evidence,
        `${JSON.stringify(evidence, null, 2)}\n`,
        {
          mode: 0o600,
        },
      )
      console.log(JSON.stringify(evidence, null, 2))
      return
    }

    const approvedConversation = crypto.randomUUID()
    const approvedInitial = await makeRequest(approvedConversation)
    const approvedId = approvalIdFromSse(approvedInitial.text)
    assertDispatchCount(dispatches, 0, 'Tool dispatched before approval')
    const approvedFollowup = await makeRequest(approvedConversation, {
      id: approvedId,
      approved: true,
    })
    assert(
      approvedFollowup.response.status === 200,
      `Approval follow-up failed: ${approvedFollowup.response.status}`,
    )
    assertDispatchCount(
      dispatches,
      1,
      `Expected one approved dispatch, got ${dispatches.length}`,
    )
    const replay = await makeRequest(approvedConversation, {
      id: approvedId,
      approved: true,
    })
    assert(
      replay.response.status === 409,
      `Expected approval replay 409, got ${replay.response.status}`,
    )
    assertDispatchCount(
      dispatches,
      1,
      'Approval replay dispatched the tool again',
    )

    const deniedConversation = crypto.randomUUID()
    const deniedInitial = await makeRequest(deniedConversation)
    const deniedId = approvalIdFromSse(deniedInitial.text)
    assertDispatchCount(
      dispatches,
      1,
      'Denied scenario dispatched before decision',
    )
    const deniedFollowup = await makeRequest(deniedConversation, {
      id: deniedId,
      approved: false,
    })
    assert(
      deniedFollowup.response.status === 200,
      `Denial follow-up failed: ${deniedFollowup.response.status}`,
    )
    assertDispatchCount(
      dispatches,
      1,
      `Denied tool dispatched; total calls ${dispatches.length}`,
    )

    if (browserMode) {
      const browserConversation = crypto.randomUUID()
      const browserResult = await makeRequest(
        browserConversation,
        undefined,
        `${BROWSER_FIXTURE_MARKER}: navigate a browser tab to http://127.0.0.1:${ports.page}/fixture and report its title and sentinel.`,
      )
      assert(
        browserResult.response.status === 200,
        `Browser tool scenario failed: ${browserResult.response.status}`,
      )
      browserSseOutput = browserResult.text
      const assistantText = assistantTextFromSse(browserResult.text)
      assert(
        assistantText.includes(BROWSER_PAGE_TITLE) &&
          assistantText.includes(BROWSER_SENTINEL),
        'Final assistant reply omitted the title or sentinel read from the page',
      )
      const navigateStep = browserToolSteps.find(
        (step) => step.toolName === 'navigate',
      )
      const readStep = browserToolSteps.find((step) => step.toolName === 'read')
      assert(navigateStep, 'Model did not select the advertised navigate tool')
      assert(readStep, 'Model did not select the advertised read tool')
      assert(
        navigateStep.input?.url === `http://127.0.0.1:${ports.page}/fixture`,
        'navigate tool did not target the exact local fixture URL',
      )
      assert(
        navigateStep.targetPageId !== undefined,
        'navigate tool did not target a page returned by tabs list',
      )
      assert(
        readStep.input?.page === navigateStep.targetPageId &&
          readStep.input?.format === 'text',
        'read tool did not target the navigated fixture page in text format',
      )
      const navigateResultStep = browserToolSteps.find(
        (step) =>
          step.toolName === null &&
          step.observedToolResults.some(
            (text) =>
              text.includes(BROWSER_SENTINEL) &&
              text.includes(BROWSER_PAGE_TITLE),
          ),
      )
      assert(
        navigateResultStep,
        'Model request did not receive the local page sentinel in MCP tool output',
      )
      assert(
        browserPageRequests.includes('/fixture'),
        'Chromium did not request the local fixture page',
      )
      assertDispatchCount(
        dispatches,
        1,
        'Browser scenario dispatched an unexpected side effect',
      )
    }

    const evidence = {
      status: 'passed',
      mode: browserMode ? 'approval-and-browser' : 'approval-only',
      browserPrerequisite: browserMode
        ? 'BrowserOS Chromium exposing the Browser.getTabs CDP extension; stock Chromium is insufficient.'
        : undefined,
      serverBinary: binary,
      serverSha256: createHash('sha256')
        .update(new Uint8Array(await Bun.file(binary).arrayBuffer()))
        .digest('hex'),
      config,
      ports,
      requestCount: modelRequests.length,
      modelMessages: capturedModelMessages(modelRequests),
      advertisedToolNames,
      syntheticModelResponses,
      browserToolSteps,
      browserPageRequests,
      browserResponseSse: browserSseOutput,
      localPageTitle: BROWSER_PAGE_TITLE,
      localPageSentinel: BROWSER_SENTINEL,
      approvedApprovalObserved: true,
      deniedApprovalObserved: true,
      approvedDispatches: dispatches,
      deniedAdditionalDispatches: 0,
      evidencePath: paths.evidence,
    }
    await writeFile(paths.evidence, `${JSON.stringify(evidence, null, 2)}\n`, {
      mode: 0o600,
    })
    console.log(JSON.stringify(evidence, null, 2))
  } catch (error) {
    await writeFile(
      paths.evidence,
      `${JSON.stringify({ status: 'failed', mode: partialRestartMode ? 'partial-transcript-restart' : restartMode ? 'approval-restart' : browserMode ? 'approval-and-browser' : 'approval-only', browserPrerequisite: browserMode ? 'BrowserOS Chromium exposing the Browser.getTabs CDP extension; stock Chromium is insufficient.' : undefined, error: error instanceof Error ? error.message : String(error), ports, config, requestCount: modelRequests.length, modelMessages: capturedModelMessages(modelRequests), advertisedToolNames, syntheticModelResponses, browserToolSteps, browserPageRequests, browserResponseSse: browserSseOutput, restartEvidence, dispatches }, null, 2)}\n`,
      { mode: 0o600 },
    )
    throw error
  } finally {
    process.removeListener('SIGINT', handleSignal)
    process.removeListener('SIGTERM', handleSignal)
    await cleanup()
    // Keep the isolated evidence and logs for inspection.
    console.log(`Fixture directory retained at ${runDir}`)
  }
}

async function waitForCdp(
  port: number,
  browserProcess: ChildProcess,
  getSpawnError: () => Error | undefined,
) {
  const url = `http://127.0.0.1:${port}/json/version`
  const deadline = Date.now() + 20_000
  while (Date.now() < deadline) {
    if (getSpawnError()) throw getSpawnError()
    if (browserProcess.exitCode !== null)
      throw new Error(`Chromium exited (${browserProcess.exitCode})`)
    try {
      const response = await fetch(url, { signal: AbortSignal.timeout(400) })
      if (response.ok) return
    } catch {
      // Poll until CDP comes up.
    }
    await Bun.sleep(150)
  }
  throw new Error('Isolated Chromium CDP did not become ready')
}

async function waitChild(child: ChildProcess): Promise<void> {
  if (child.exitCode !== null || child.signalCode !== null) return
  try {
    await waitForExit(child, 5_000)
  } catch {
    child.kill('SIGKILL')
    await waitForExit(child, 3_000)
  }
}

async function waitForExit(
  child: ChildProcess,
  timeoutMs: number,
): Promise<void> {
  if (child.exitCode !== null || child.signalCode !== null) return
  await new Promise<void>((resolveExit, reject) => {
    const timer = setTimeout(
      () => reject(new Error(`Child ${child.pid ?? '(unknown)'} did not exit`)),
      timeoutMs,
    )
    child.once('exit', () => {
      clearTimeout(timer)
      resolveExit()
    })
  })
}

void main().catch((error) => {
  console.error(error)
  process.exitCode = 1
})
