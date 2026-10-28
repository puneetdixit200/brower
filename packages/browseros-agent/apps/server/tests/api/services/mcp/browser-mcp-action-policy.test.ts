import { afterEach, describe, expect, it } from 'bun:test'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { BrowserSession } from '@browseros/browser-core/core/session'
import { createBrowserOutputFileAccess } from '@browseros/browser-mcp/output-file'
import { DbActionPolicyStore } from '../../../../src/agent/action-policy'
import type { ActiveConversationRun } from '../../../../src/api/services/conversation-runs'
import { BrowserMcpModule } from '../../../../src/api/services/mcp/browser-mcp-module'
import { closeDb, initializeDb } from '../../../../src/lib/db'

let dbDir = ''
afterEach(async () => {
  closeDb()
  if (dbDir) await rm(dbDir, { recursive: true, force: true })
  dbDir = ''
})

function makeFixture(source: string) {
  let opens = 0
  const conversationId = crypto.randomUUID()
  const run = {
    conversationId,
    runId: 'policy-test-run',
    panelsVisible: true,
    tabGroup: { title: 'test', colorKey: 'browseros' },
    signal: new AbortController().signal,
    associateTabs: () => true,
  } as ActiveConversationRun
  const session = {
    pages: {
      newPage: async () => {
        opens += 1
        return 2
      },
    },
  } as unknown as BrowserSession
  const runtime = new BrowserMcpModule({
    version: 'test',
    browserSession: session,
    conversationRuns: { activeRun: () => run },
  })
  const lease = runtime.createLease({
    conversationId,
    readOnly: false,
    outputFileAccess: createBrowserOutputFileAccess(),
    source,
  })
  const server = runtime.createMcpServer({
    leaseToken: lease.token,
  }) as unknown as {
    _registeredTools: Record<
      string,
      {
        handler(
          args: Record<string, unknown>,
        ): Promise<{ content: Array<{ text?: string }>; isError?: boolean }>
      }
    >
  }
  return { getOpens: () => opens, server }
}

function tabsHandler(server: ReturnType<typeof makeFixture>['server']) {
  const handler = server._registeredTools.tabs?.handler
  if (!handler) throw new Error('Expected tabs tool to be registered')
  return handler
}

async function policyStore() {
  dbDir = await mkdtemp(join(tmpdir(), 'browser-mcp-action-policy-'))
  const handle = initializeDb({ dbPath: join(dbDir, 'state.sqlite') })
  return new DbActionPolicyStore(handle.db)
}

describe('BrowserMcpModule action policy boundary', () => {
  it('blocks ACP execution when the saved action decision is Deny', async () => {
    const store = await policyStore()
    await store.put('browser.tabs.new', { decision: 'deny', expiresAt: null })
    const { server, getOpens } = makeFixture('acp')

    const result = await tabsHandler(server)({
      action: 'new',
      url: 'https://example.com',
    })

    expect(result.isError).toBe(true)
    expect(result.content[0]?.text).toContain('saved action policy')
    expect(getOpens()).toBe(0)
  })

  it('fails closed for ACP Ask and unknown actions without executing', async () => {
    await policyStore()
    const { server, getOpens } = makeFixture('acp')

    const result = await tabsHandler(server)({
      action: 'new',
      url: 'https://example.com',
    })

    expect(result.isError).toBe(true)
    expect(result.content[0]?.text).toContain('Approval required')
    expect(getOpens()).toBe(0)
  })

  it('leaves chat Ask execution to the AI SDK approval hook', async () => {
    await policyStore()
    const { server, getOpens } = makeFixture('chat')

    const result = await tabsHandler(server)({
      action: 'new',
      url: 'https://example.com',
    })

    expect(result.isError).not.toBe(true)
    expect(getOpens()).toBe(1)
  })
})
