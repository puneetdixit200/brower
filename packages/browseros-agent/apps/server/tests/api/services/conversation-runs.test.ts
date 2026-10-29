/**
 * @license
 * Copyright 2025 BrowserOS
 * SPDX-License-Identifier: AGPL-3.0-or-later
 */

import { describe, expect, it } from 'bun:test'
import type { UIMessage, UIMessageChunk } from 'ai'
import type { AgentTaskTraceEvent } from '../../../src/agent/task-contract'
import {
  ConversationRunAlreadyActiveError,
  ConversationRuns,
} from '../../../src/api/services/conversation-runs'
import type { DurableHumanWait } from '../../../src/lib/conversations/conversation-run-lifecycle-store'

const firstChunk: UIMessageChunk = { type: 'text-start', id: 'answer' }
const secondChunk: UIMessageChunk = {
  type: 'text-delta',
  id: 'answer',
  delta: 'hello',
}

describe('ConversationRuns', () => {
  it('holds the live stream factory until the exact run-scoped human wait resumes', async () => {
    const runs = new ConversationRuns()
    const conversationId = crypto.randomUUID()
    let runId = ''
    let wait: ReturnType<ConversationRuns['requestHumanIntervention']>
    let factoryFinished = false
    const starting = runs.start({
      conversationId,
      messages: [],
      createStream: async (_signal, id) => {
        runId = id
        wait = runs.requestHumanIntervention(conversationId, id)
        if (!wait) throw new Error('failed to create human wait')
        await wait.continuation
        factoryFinished = true
        return new ReadableStream<UIMessageChunk>({
          start(controller) {
            controller.enqueue({ type: 'text-start', id: 'answer' })
            controller.close()
          },
        })
      },
    })

    for (let attempt = 0; attempt < 20 && !wait; attempt += 1) {
      await Promise.resolve()
    }
    expect(wait).toBeDefined()
    expect(factoryFinished).toBe(false)
    expect(runs.getSnapshot(conversationId)?.status).toBe('running')
    expect(runs.getSnapshot(conversationId)?.humanIntervention?.requestId).toBe(
      wait?.requestId,
    )
    expect(
      runs.resumeAfterHumanIntervention(
        conversationId,
        'stale-run',
        wait?.requestId ?? '',
      ),
    ).toBe(false)
    expect(
      runs.resumeAfterHumanIntervention(conversationId, runId, 'stale-request'),
    ).toBe(false)
    expect(factoryFinished).toBe(false)
    expect(
      runs.resumeAfterHumanIntervention(
        conversationId,
        runId,
        wait?.requestId ?? '',
      ),
    ).toBe(true)
    const started = await starting
    expect(started.runId).toBe(runId)
    expect(factoryFinished).toBe(true)
    await collect(runs.subscribe(conversationId, runId))
    expect(runs.getSnapshot(conversationId)?.status).toBe('completed')
    expect(
      runs.resumeAfterHumanIntervention(
        conversationId,
        runId,
        wait?.requestId ?? '',
      ),
    ).toBe(false)
  })

  it('lets browser dispatch request a wait through the pinned active-run capability', async () => {
    const runs = new ConversationRuns()
    const conversationId = crypto.randomUUID()
    let waitStarted = false
    const starting = runs.start({
      conversationId,
      messages: [],
      createStream: async () => {
        const activeRun = runs.activeRun(conversationId)
        if (!activeRun?.waitForHumanIntervention) {
          throw new Error('active run cannot request a human wait')
        }
        waitStarted = true
        await activeRun.waitForHumanIntervention()
        return new ReadableStream<UIMessageChunk>({
          start(controller) {
            controller.close()
          },
        })
      },
    })
    for (let attempt = 0; attempt < 20 && !waitStarted; attempt += 1) {
      await Promise.resolve()
    }
    const wait = runs.getSnapshot(conversationId)?.humanIntervention
    expect(waitStarted).toBe(true)
    expect(wait?.requestId).toBeDefined()
    const active = runs.activeRun(conversationId)
    expect(active).toBeDefined()
    expect(
      runs.resumeAfterHumanIntervention(
        conversationId,
        active?.runId ?? '',
        wait?.requestId ?? '',
      ),
    ).toBe(true)
    await starting
  })

  it('persists an opaque wait before advertising it and completes only its exact request', async () => {
    const rows = new Map<string, DurableHumanWait>()
    const lifecycleStore = {
      start: () => {},
      finish: () => {},
      get: () => undefined,
      appendTraceEvent: () => {},
      markTracePersistenceDegraded: () => {},
      ensureInterruptionTraceEvent: () => {
        throw new Error('not used')
      },
      getTraceEvents: () => [],
      delete: () => false,
      beginHumanWait: (
        conversationId: string,
        runId: string,
        requestId: string,
      ) => {
        const row: DurableHumanWait = {
          conversationId,
          runId,
          requestId,
          phase: 'waiting',
          createdAt: 1,
          updatedAt: 1,
          completedAt: null,
          version: 1,
        }
        rows.set(conversationId, row)
        return row
      },
      getHumanWait: () => undefined,
      completeHumanWait: (
        conversationId: string,
        runId: string,
        requestId: string,
      ) => {
        const row = rows.get(conversationId)
        if (
          !row ||
          row.runId !== runId ||
          row.requestId !== requestId ||
          row.phase !== 'waiting'
        ) {
          return false
        }
        row.phase = 'human_completed'
        return true
      },
      cancelHumanWait: () => false,
    }
    const runs = new ConversationRuns({ lifecycleStore })
    const conversationId = crypto.randomUUID()
    let waiting = false
    const starting = runs.start({
      conversationId,
      messages: [],
      createStream: async () => {
        const active = runs.activeRun(conversationId)
        if (!active?.waitForHumanIntervention) throw new Error('missing wait')
        waiting = true
        await active.waitForHumanIntervention()
        return new ReadableStream<UIMessageChunk>({
          start(controller) {
            controller.close()
          },
        })
      },
    })

    for (let attempt = 0; attempt < 20 && !waiting; attempt += 1) {
      await Promise.resolve()
    }
    const wait = runs.getSnapshot(conversationId)?.humanIntervention
    expect(waiting).toBe(true)
    expect(rows.get(conversationId)).toMatchObject({
      requestId: wait?.requestId,
      phase: 'waiting',
    })
    const runId = runs.activeRun(conversationId)?.runId ?? ''
    expect(
      runs.resumeAfterHumanIntervention(
        conversationId,
        runId,
        wait?.requestId ?? '',
      ),
    ).toBe(true)
    expect(rows.get(conversationId)?.phase).toBe('human_completed')
    expect(
      runs.resumeAfterHumanIntervention(
        conversationId,
        runId,
        wait?.requestId ?? '',
      ),
    ).toBe(false)
    await starting
  })

  it('aborts the run when a durable human wait cannot be recorded', async () => {
    const lifecycleStore = {
      start: () => {},
      finish: () => {},
      get: () => undefined,
      appendTraceEvent: () => {},
      markTracePersistenceDegraded: () => {},
      ensureInterruptionTraceEvent: () => {
        throw new Error('not used')
      },
      getTraceEvents: () => [],
      delete: () => false,
      beginHumanWait: () => undefined,
      getHumanWait: () => undefined,
      completeHumanWait: () => false,
      cancelHumanWait: () => false,
    }
    const runs = new ConversationRuns({ lifecycleStore })
    const conversationId = crypto.randomUUID()
    let signal: AbortSignal | undefined
    const starting = runs.start({
      conversationId,
      messages: [],
      createStream: async (runSignal) => {
        signal = runSignal
        const active = runs.activeRun(conversationId)
        if (!active?.waitForHumanIntervention) throw new Error('missing wait')
        await active.waitForHumanIntervention()
        throw new Error('model must not continue without a durable wait')
      },
    })

    await expect(starting).rejects.toThrow('Human wait is no longer available')
    expect(signal?.aborted).toBe(true)
    expect(runs.getSnapshot(conversationId)?.status).toBe('aborted')
  })

  it('rejects an outstanding human wait when that run is stopped', async () => {
    const runs = new ConversationRuns()
    const conversationId = crypto.randomUUID()
    let runId = ''
    let requestId = ''
    const starting = runs.start({
      conversationId,
      messages: [],
      createStream: async (_signal, id) => {
        runId = id
        const wait = runs.requestHumanIntervention(conversationId, id)
        if (!wait) throw new Error('failed to create human wait')
        requestId = wait.requestId
        await wait.continuation
        return new ReadableStream<UIMessageChunk>()
      },
    })

    for (let attempt = 0; attempt < 20 && !requestId; attempt += 1) {
      await Promise.resolve()
    }
    expect(requestId).not.toBe('')
    expect(await runs.stop(conversationId)).toBe(true)
    await expect(starting).rejects.toThrow()
    expect(runs.getSnapshot(conversationId)?.status).toBe('aborted')
    expect(
      runs.resumeAfterHumanIntervention(conversationId, runId, requestId),
    ).toBe(false)
  })

  it('generates validated, redacted task and tool trace events from the live stream', async () => {
    const source = controlledSource()
    const runs = new ConversationRuns()
    const started = await runs.start({
      conversationId: 'trace-run',
      messages: [],
      createStream: () => source.stream,
    })
    source.write({
      type: 'tool-input-start',
      toolCallId: 'provider-call-private-secret',
      toolName: 'browser.navigate',
    })
    source.write({
      type: 'tool-approval-request',
      approvalId: 'approval-private-secret',
      toolCallId: 'provider-call-private-secret',
      reason: 'private page context',
    })
    source.write({
      type: 'tool-approval-response',
      approvalId: 'approval-private-secret',
      approved: true,
    })
    source.write({
      type: 'tool-output-available',
      toolCallId: 'provider-call-private-secret',
      output: { password: 'result-private-secret' },
    })
    source.close()
    await collect(runs.subscribe('trace-run'))

    const snapshot = runs.getSnapshot('trace-run')
    expect(
      snapshot?.traceEvents?.map(({ kind, outcome }) => [kind, outcome]),
    ).toEqual([
      ['task_started', undefined],
      ['tool_started', undefined],
      ['approval_requested', undefined],
      ['approval_resolved', 'approved'],
      ['tool_finished', 'ok'],
      ['task_finished', 'completed'],
    ])
    expect(
      snapshot?.traceEvents?.every((event) => event.taskId === started.runId),
    ).toBe(true)
    const approvalEvents = snapshot?.traceEvents?.filter((event) =>
      event.kind.startsWith('approval_'),
    )
    expect(approvalEvents).toHaveLength(2)
    expect(approvalEvents?.[0]?.approvalOperationId).toMatch(/^[0-9a-f-]{36}$/)
    expect(approvalEvents?.[1]?.approvalOperationId).toBe(
      approvalEvents?.[0]?.approvalOperationId,
    )
    expect(JSON.stringify(snapshot?.traceEvents)).not.toMatch(
      /provider-call-private-secret|approval-private-secret|private page context|result-private-secret|password/,
    )
    expect(
      new Set(snapshot?.traceEvents?.map((event) => event.eventId)).size,
    ).toBe(snapshot?.traceEvents?.length)
  })

  it('keeps interleaved conversations, approvals, results, panels, and stops isolated', async () => {
    const conversationA = 'parallel-conversation-a'
    const conversationB = 'parallel-conversation-b'
    const sourceA = controlledSource()
    const sourceB = controlledSource()
    const runs = new ConversationRuns()
    const startedA = await runs.start({
      conversationId: conversationA,
      messages: [
        {
          id: 'user-a',
          role: 'user',
          parts: [{ type: 'text', text: 'context-a' }],
        },
      ],
      panelTabIds: [41],
      createStream: () => sourceA.stream,
    })
    const startedB = await runs.start({
      conversationId: conversationB,
      messages: [
        {
          id: 'user-b',
          role: 'user',
          parts: [{ type: 'text', text: 'context-b' }],
        },
      ],
      panelTabIds: [42],
      createStream: () => sourceB.stream,
    })

    sourceA.write({ type: 'text-start', id: 'answer-a' })
    sourceB.write({ type: 'text-start', id: 'answer-b' })
    sourceA.write({
      type: 'tool-input-start',
      toolCallId: 'private-call-a',
      toolName: 'browser.navigate',
    })
    sourceB.write({
      type: 'tool-input-start',
      toolCallId: 'private-call-b',
      toolName: 'browser.navigate',
    })
    sourceA.write({
      type: 'tool-approval-request',
      approvalId: 'private-approval-a',
      toolCallId: 'private-call-a',
    })
    sourceB.write({
      type: 'tool-approval-request',
      approvalId: 'private-approval-b',
      toolCallId: 'private-call-b',
    })
    sourceA.write({
      type: 'tool-approval-response',
      approvalId: 'private-approval-b',
      approved: true,
    })
    sourceA.write({ type: 'text-delta', id: 'answer-a', delta: 'result-a' })
    sourceB.write({ type: 'text-delta', id: 'answer-b', delta: 'result-b' })

    const assignmentByTab = Object.fromEntries(
      (await currentPanelAssignments(runs)).assignments.map((item) => [
        item.tabId,
        item.conversationId,
      ]),
    )
    expect(assignmentByTab).toEqual({ 41: conversationA, 42: conversationB })
    expect(runs.getSnapshot(conversationA)?.messages?.[0]?.id).toBe('user-a')
    expect(runs.getSnapshot(conversationB)?.messages?.[0]?.id).toBe('user-b')
    expect(
      runs.updateMessages(conversationA, startedB.runId, [
        { id: 'foreign-b', role: 'assistant', parts: [] },
      ]),
    ).toBe(false)
    expect(
      runs.updateMessages(conversationB, startedA.runId, [
        { id: 'foreign-a', role: 'assistant', parts: [] },
      ]),
    ).toBe(false)
    expect(
      runs.updateMessages(conversationA, startedA.runId, [
        { id: 'message-a', role: 'assistant', parts: [] },
      ]),
    ).toBe(true)
    expect(
      runs.updateMessages(conversationB, startedB.runId, [
        { id: 'message-b', role: 'assistant', parts: [] },
      ]),
    ).toBe(true)

    await eventually(() => {
      expect(
        runs
          .getSnapshot(conversationA)
          ?.traceEvents?.filter((event) => event.kind === 'approval_requested'),
      ).toHaveLength(1)
      expect(
        runs
          .getSnapshot(conversationB)
          ?.traceEvents?.filter((event) => event.kind === 'approval_requested'),
      ).toHaveLength(1)
    })
    expect(
      runs
        .getSnapshot(conversationA)
        ?.traceEvents?.filter((event) => event.kind === 'approval_resolved'),
    ).toHaveLength(0)
    expect(
      runs
        .getSnapshot(conversationB)
        ?.traceEvents?.filter((event) => event.kind === 'approval_resolved'),
    ).toHaveLength(0)
    sourceA.write({
      type: 'tool-approval-response',
      approvalId: 'private-approval-a',
      approved: true,
    })
    await eventually(() => {
      expect(
        runs
          .getSnapshot(conversationA)
          ?.traceEvents?.filter((event) => event.kind === 'approval_resolved'),
      ).toHaveLength(1)
      expect(
        runs
          .getSnapshot(conversationB)
          ?.traceEvents?.filter((event) => event.kind === 'approval_resolved'),
      ).toHaveLength(0)
    })

    const traceA = runs.getSnapshot(conversationA)?.traceEvents ?? []
    const traceB = runs.getSnapshot(conversationB)?.traceEvents ?? []
    const operationA = traceA.find(
      (event) => event.kind === 'approval_requested',
    )?.approvalOperationId
    const operationB = traceB.find(
      (event) => event.kind === 'approval_requested',
    )?.approvalOperationId
    expect(operationA).toMatch(/^[0-9a-f-]{36}$/)
    expect(operationB).toMatch(/^[0-9a-f-]{36}$/)
    expect(operationA).not.toBe(operationB)
    expect(
      traceA
        .filter((event) => event.kind.startsWith('approval_'))
        .map((event) => event.approvalOperationId),
    ).toEqual([operationA, operationA])
    expect(
      traceB
        .filter((event) => event.kind.startsWith('approval_'))
        .map((event) => event.approvalOperationId),
    ).toEqual([operationB])
    expect(
      traceA
        .filter((event) => event.kind === 'approval_resolved')
        .map((event) => ({
          approvalOperationId: event.approvalOperationId,
          outcome: event.outcome,
        })),
    ).toEqual([{ approvalOperationId: operationA, outcome: 'approved' }])
    expect(JSON.stringify(traceA)).not.toContain('private-approval-b')
    expect(JSON.stringify(traceB)).not.toContain('private-approval-a')

    expect(await runs.stop(conversationA)).toBe(true)
    expect(runs.getSnapshot(conversationA)?.status).toBe('aborted')
    expect(runs.getSnapshot(conversationB)?.status).toBe('running')
    expect(
      (await currentPanelAssignments(runs)).assignments.map((item) => [
        item.tabId,
        item.conversationId,
        item.status,
      ]),
    ).toEqual([
      [41, conversationA, 'aborted'],
      [42, conversationB, 'running'],
    ])

    const replayA = await collect(runs.subscribe(conversationA, startedA.runId))
    expect(
      replayA.some(
        (chunk) => chunk.type === 'text-delta' && chunk.delta === 'result-a',
      ),
    ).toBe(true)
    expect(
      replayA.some(
        (chunk) => chunk.type === 'text-delta' && chunk.delta === 'result-b',
      ),
    ).toBe(false)
    expect(
      runs.updateMessages(conversationA, startedB.runId, [
        { id: 'foreign-after-stop', role: 'assistant', parts: [] },
      ]),
    ).toBe(false)

    const replacementSource = controlledSource()
    const replacement = await runs.start({
      conversationId: conversationA,
      messages: [],
      createStream: () => replacementSource.stream,
    })
    expect(replacement.runId).not.toBe(startedA.runId)
    expect(
      runs.updateMessages(conversationA, startedA.runId, [
        { id: 'stale-a', role: 'assistant', parts: [] },
      ]),
    ).toBe(false)
    expect(
      runs.updateMessages(conversationA, startedB.runId, [
        { id: 'foreign-b-replacement', role: 'assistant', parts: [] },
      ]),
    ).toBe(false)
    expect(
      runs.updateMessages(conversationA, replacement.runId, [
        { id: 'replacement-message', role: 'assistant', parts: [] },
      ]),
    ).toBe(true)

    sourceB.write({
      type: 'tool-approval-response',
      approvalId: 'private-approval-b',
      approved: false,
    })
    sourceB.write({
      type: 'tool-output-denied',
      toolCallId: 'private-call-b',
      reason: 'denied privately',
    })
    sourceB.write({ type: 'text-end', id: 'answer-b' })
    sourceB.close()
    await eventually(() =>
      expect(runs.getSnapshot(conversationB)?.status).toBe('completed'),
    )
    expect(
      runs
        .getSnapshot(conversationB)
        ?.traceEvents?.filter((event) => event.kind === 'approval_resolved')
        .map((event) => ({
          approvalOperationId: event.approvalOperationId,
          outcome: event.outcome,
        })),
    ).toEqual([{ approvalOperationId: operationB, outcome: 'denied' }])
    const replayB = await collect(runs.subscribe(conversationB, startedB.runId))
    expect(
      replayB.some(
        (chunk) => chunk.type === 'text-delta' && chunk.delta === 'result-b',
      ),
    ).toBe(true)
    expect(
      replayB.some(
        (chunk) => chunk.type === 'text-delta' && chunk.delta === 'result-a',
      ),
    ).toBe(false)
    expect(
      JSON.stringify(runs.getSnapshot(conversationB)?.traceEvents),
    ).not.toContain('private-approval-a')

    expect(await runs.stop(conversationA)).toBe(true)
    await eventually(() =>
      expect(runs.getSnapshot(conversationA)?.status).toBe('aborted'),
    )
  })

  it('persists lifecycle metadata and returns a non-resumable interruption snapshot', async () => {
    const rows = new Map<
      string,
      {
        conversationId: string
        runId: string
        status: 'running' | 'completed' | 'aborted' | 'failed' | 'interrupted'
        startedAt: number
        finishedAt: number | null
        tracePersistenceDegraded: boolean
        tracePersistenceDegraded: boolean
      }
    >()
    const traces = new Map<string, AgentTaskTraceEvent[]>()
    const lifecycleStore = {
      start: (conversationId: string, runId: string, startedAt: number) => {
        rows.set(conversationId, {
          conversationId,
          runId,
          status: 'running',
          startedAt,
          finishedAt: null,
          tracePersistenceDegraded: false,
        })
      },
      finish: (
        conversationId: string,
        runId: string,
        status: 'completed' | 'aborted' | 'failed' | 'interrupted',
        finishedAt: number,
      ) => {
        const row = rows.get(conversationId)
        if (row?.runId === runId)
          rows.set(conversationId, { ...row, status, finishedAt })
      },
      get: (conversationId: string) => rows.get(conversationId),
      markTracePersistenceDegraded: (conversationId: string, runId: string) => {
        const row = rows.get(conversationId)
        if (row?.runId === runId) {
          rows.set(conversationId, { ...row, tracePersistenceDegraded: true })
        }
      },
      appendTraceEvent: (
        conversationId: string,
        runId: string,
        event: AgentTaskTraceEvent,
      ) => {
        if (event.taskId !== runId) throw new Error('trace scope mismatch')
        const key = `${conversationId}:${runId}`
        traces.set(key, [...(traces.get(key) ?? []), event])
      },
      getTraceEvents: (conversationId: string, runId: string) =>
        traces.get(`${conversationId}:${runId}`) ?? [],
      ensureInterruptionTraceEvent: (
        conversationId: string,
        runId: string,
        at: number,
      ) => {
        const key = `${conversationId}:${runId}`
        const runEvents = traces.get(key) ?? []
        const existing = runEvents.find(
          (event) => event.kind === 'task_interrupted',
        )
        if (existing) return existing
        const event: AgentTaskTraceEvent = {
          version: 1,
          taskId: runId,
          eventId: crypto.randomUUID(),
          at,
          kind: 'task_interrupted',
        }
        traces.set(key, [...runEvents, event])
        return event
      },
      delete: (conversationId: string) => rows.delete(conversationId),
    }
    const source = controlledSource()
    const runs = new ConversationRuns({ lifecycleStore })
    const started = await runs.start({
      conversationId: 'durable-run',
      messages: [],
      createStream: () => source.stream,
    })
    const saved = rows.get('durable-run')
    expect(saved).toMatchObject({ runId: started.runId, status: 'running' })
    if (!saved) throw new Error('Expected persisted run metadata')
    expect(
      traces.get(`durable-run:${started.runId}`)?.map(({ kind }) => kind),
    ).toEqual(['task_started'])

    // Simulate process restart: the next process reconciles the persisted row.
    rows.set('durable-run', {
      ...saved,
      status: 'interrupted',
      finishedAt: Date.now(),
    })
    const restarted = new ConversationRuns({ lifecycleStore })
    expect(await restarted.getPreparedSnapshot('durable-run')).toMatchObject({
      conversationId: 'durable-run',
      runId: started.runId,
      status: 'interrupted',
      chunkCount: 0,
    })
    expect(
      (await restarted.getPreparedSnapshot('durable-run'))?.traceEvents?.map(
        ({ taskId, kind }) => ({ taskId, kind }),
      ),
    ).toEqual([
      { taskId: started.runId, kind: 'task_started' },
      { taskId: started.runId, kind: 'task_interrupted' },
    ])
    expect(restarted.activeRun('durable-run')).toBeUndefined()
    expect(() => restarted.subscribe('durable-run')).toThrow(
      'Conversation run not found',
    )
    source.close()
    await eventually(() =>
      expect(rows.get('durable-run')?.status).toBe('completed'),
    )
    expect(await restarted.delete('durable-run')).toBe(true)
    expect(rows.has('durable-run')).toBe(false)
    expect(await runs.delete('durable-run')).toBe(true)
  })

  it('normalizes a still-running durable row and persists one stable recovery event across parallel reads', async () => {
    const runId = crypto.randomUUID()
    const row = {
      conversationId: 'recovering-run',
      runId,
      status: 'running' as 'running' | 'interrupted',
      startedAt: 100,
      finishedAt: null,
      tracePersistenceDegraded: false,
    }
    const events: AgentTaskTraceEvent[] = []
    const lifecycleStore = {
      start: () => {},
      finish: (
        _conversationId: string,
        currentRunId: string,
        status: 'interrupted',
        finishedAt: number,
      ) => {
        if (row.runId === currentRunId) {
          row.status = status
          row.finishedAt = finishedAt
        }
      },
      get: () => row,
      markTracePersistenceDegraded: () => {},
      appendTraceEvent: () => {},
      getTraceEvents: () => [...events],
      ensureInterruptionTraceEvent: (
        _conversationId: string,
        currentRunId: string,
        at: number,
      ) => {
        const existing = events.find(
          (event) => event.kind === 'task_interrupted',
        )
        if (existing) return existing
        const event: AgentTaskTraceEvent = {
          version: 1,
          taskId: currentRunId,
          eventId: crypto.randomUUID(),
          at,
          kind: 'task_interrupted',
        }
        events.push(event)
        return event
      },
      delete: () => false,
    }
    const runs = new ConversationRuns({ lifecycleStore })
    const [first, concurrent] = await Promise.all([
      runs.getPreparedSnapshot('recovering-run'),
      runs.getPreparedSnapshot('recovering-run'),
    ])
    const repeated = await runs.getPreparedSnapshot('recovering-run')

    expect(row.status).toBe('interrupted')
    expect(first?.status).toBe('interrupted')
    const firstEvent = first?.traceEvents?.find(
      (event) => event.kind === 'task_interrupted',
    )
    expect(firstEvent).toBeDefined()
    expect(
      concurrent?.traceEvents?.find(
        (event) => event.kind === 'task_interrupted',
      ),
    ).toEqual(firstEvent)
    expect(
      repeated?.traceEvents?.find((event) => event.kind === 'task_interrupted'),
    ).toEqual(firstEvent)
    expect(events).toEqual([firstEvent])
  })

  it('surfaces trace persistence degradation without changing run completion', async () => {
    const source = controlledSource()
    let durableRun:
      | {
          conversationId: string
          runId: string
          status: 'running' | 'completed'
          startedAt: number
          finishedAt: number | null
          tracePersistenceDegraded: boolean
        }
      | undefined
    const lifecycleStore = {
      start: (conversationId: string, runId: string, startedAt: number) => {
        durableRun = {
          conversationId,
          runId,
          status: 'running',
          startedAt,
          finishedAt: null,
          tracePersistenceDegraded: false,
        }
      },
      finish: (
        _conversationId: string,
        _runId: string,
        status: 'completed',
        finishedAt: number,
      ) => {
        if (durableRun) durableRun = { ...durableRun, status, finishedAt }
      },
      get: () => durableRun,
      markTracePersistenceDegraded: () => {
        if (durableRun) {
          durableRun = { ...durableRun, tracePersistenceDegraded: true }
        }
      },
      appendTraceEvent: () => {
        throw new Error('storage unavailable')
      },
      ensureInterruptionTraceEvent: () => {
        throw new Error('storage unavailable')
      },
      getTraceEvents: () => [],
      delete: () => false,
    }
    const runs = new ConversationRuns({ lifecycleStore })
    await runs.start({
      conversationId: 'trace-degraded',
      messages: [],
      createStream: () => source.stream,
    })
    source.close()
    await collect(runs.subscribe('trace-degraded'))

    expect(runs.getSnapshot('trace-degraded')).toMatchObject({
      status: 'completed',
      tracePersistenceDegraded: true,
    })
    const restarted = new ConversationRuns({ lifecycleStore })
    expect(await restarted.getPreparedSnapshot('trace-degraded')).toMatchObject(
      {
        status: 'completed',
        tracePersistenceDegraded: true,
      },
    )
  })

  it('publishes one canonical run to streams and panel assignments', async () => {
    const source = controlledSource()
    const runs = new ConversationRuns()
    const panels = runs.subscribePanelAssignments().getReader()
    expect((await panels.read()).value).toEqual({ assignments: [] })

    const started = await runs.start({
      conversationId: 'conversation-1',
      messages: [],
      panelTabIds: [10, 11],
      createStream: () => source.stream,
    })

    expect((await panels.read()).value).toEqual({
      assignments: [
        {
          tabId: 10,
          conversationId: 'conversation-1',
          runId: started.runId,
          status: 'running',
        },
        {
          tabId: 11,
          conversationId: 'conversation-1',
          runId: started.runId,
          status: 'running',
        },
      ],
    })

    const pinnedRun = runs.activeRun('conversation-1')
    expect(pinnedRun?.associateTabs([12])).toBe(true)
    expect(
      (await panels.read()).value?.assignments.map((tab) => tab.tabId),
    ).toEqual([10, 11, 12])

    const streamed = collect(runs.subscribe('conversation-1'))
    source.write(firstChunk)
    source.close()
    expect(await streamed).toEqual([firstChunk])
    expect((await panels.read()).value?.assignments).toEqual([
      expect.objectContaining({ tabId: 10, status: 'completed' }),
      expect.objectContaining({ tabId: 11, status: 'completed' }),
      expect.objectContaining({ tabId: 12, status: 'completed' }),
    ])

    // A request pins the record that authorized it. Late effects from that
    // record must not attach a tab to a later turn.
    const next = controlledSource()
    await runs.start({
      conversationId: 'conversation-1',
      messages: [],
      panelTabIds: [10],
      createStream: () => next.stream,
    })
    expect(pinnedRun?.associateTabs([13])).toBe(false)
    await runs.stop('conversation-1')
    await panels.cancel()
  })

  it('keeps creation identity across turns and removes only retired bindings', async () => {
    const runs = new ConversationRuns()
    const first = controlledSource()
    await runs.start({
      conversationId: 'old',
      messages: [],
      panelTabIds: [10],
      createStream: () => first.stream,
    })
    const run = runs.activeRun('old')
    if (!run) throw new Error('Expected active run')
    run.associateTabs([11, 12])
    const initial = (await currentPanelAssignments(runs)).assignments
    expect(initial[0]?.autoOpenId).toBeUndefined()
    expect(initial[1]?.autoOpenId).toBeString()
    first.close()
    await collect(runs.subscribe('old'))
    expect(
      (await currentPanelAssignments(runs)).assignments.map((a) => a.tabId),
    ).toEqual([10, 11, 12])
    const second = controlledSource()
    await runs.start({
      conversationId: 'old',
      messages: [],
      panelTabIds: [10],
      createStream: () => second.stream,
    })
    expect(
      (await currentPanelAssignments(runs)).assignments[1]?.autoOpenId,
    ).toBe(initial[1]?.autoOpenId)
    expect(() => {
      runs.subscribe('old', run.runId)
    }).toThrow('Conversation run not found')
    await runs.start({
      conversationId: 'new',
      messages: [],
      panelTabIds: [12],
      createStream: () => new ReadableStream(),
    })
    await runs.delete('old')
    expect((await currentPanelAssignments(runs)).assignments).toEqual([
      expect.objectContaining({ tabId: 12, conversationId: 'new' }),
    ])
    runs.removePanelTab(12)
    expect((await currentPanelAssignments(runs)).assignments).toEqual([])
    await runs.stop('new')
  })

  it('retires mappings immediately while provider preparation is still unwinding', async () => {
    let release!: (stream: ReadableStream<UIMessageChunk>) => void
    const runs = new ConversationRuns()
    const starting = runs.start({
      conversationId: 'retiring',
      messages: [],
      panelTabIds: [4],
      createStream: () =>
        new Promise((resolve) => {
          release = resolve
        }),
    })
    const run = runs.activeRun('retiring')
    if (!run) throw new Error('Expected active run')
    const retiring = runs.delete('retiring')
    expect((await currentPanelAssignments(runs)).assignments).toEqual([])
    expect(run.associateTabs([5])).toBe(false)
    release(new ReadableStream())
    await starting
    await retiring
  })

  it('periodically repeats current panel assignments for client healing', async () => {
    const source = controlledSource()
    const runs = new ConversationRuns({ panelAssignmentsHeartbeatMs: 20 })
    const panels = runs.subscribePanelAssignments().getReader()
    expect((await panels.read()).value).toEqual({ assignments: [] })

    const started = await runs.start({
      conversationId: 'conversation-heartbeat',
      messages: [],
      panelTabIds: [14],
      createStream: () => source.stream,
    })
    const changed = (await panels.read()).value
    const heartbeat = (await panels.read()).value

    expect(changed).toEqual({
      assignments: [
        {
          tabId: 14,
          conversationId: 'conversation-heartbeat',
          runId: started.runId,
          status: 'running',
        },
      ],
    })
    expect(heartbeat).toEqual(changed)

    await panels.cancel()
    await runs.stop('conversation-heartbeat')
  })

  it('keeps replay, multicast, explicit cancellation, and preparation races server-owned', async () => {
    let provideStream!: (stream: ReadableStream<UIMessageChunk>) => void
    const prepared = new Promise<ReadableStream<UIMessageChunk>>((resolve) => {
      provideStream = resolve
    })
    const runs = new ConversationRuns()
    const starting = runs.start({
      conversationId: 'conversation-2',
      messages: [],
      createStream: () => prepared,
    })

    expect(await runs.stop('conversation-2')).toBe(true)
    await expect(
      runs.start({
        conversationId: 'conversation-2',
        messages: [],
        createStream: () => new ReadableStream<UIMessageChunk>(),
      }),
    ).rejects.toBeInstanceOf(ConversationRunAlreadyActiveError)

    provideStream(new ReadableStream<UIMessageChunk>())
    await starting
    expect(runs.getSnapshot('conversation-2')?.status).toBe('aborted')

    const source = controlledSource()
    await runs.start({
      conversationId: 'conversation-2',
      messages: [],
      createStream: () => source.stream,
    })
    const first = collect(runs.subscribe('conversation-2'))
    source.write(firstChunk)
    await eventually(() =>
      expect(runs.getSnapshot('conversation-2')?.chunkCount).toBe(1),
    )
    const late = collect(runs.subscribe('conversation-2'))
    source.write(secondChunk)
    source.close()

    expect(await first).toEqual([firstChunk, secondChunk])
    expect(await late).toEqual([firstChunk, secondChunk])
  })

  it('does not let a subscriber disconnect cancel execution', async () => {
    const source = controlledSource()
    const runs = new ConversationRuns()
    await runs.start({
      conversationId: 'conversation-3',
      messages: [],
      createStream: () => source.stream,
    })

    const abandoned = runs.subscribe('conversation-3').getReader()
    const remaining = collect(runs.subscribe('conversation-3'))
    await abandoned.cancel('panel closed')
    source.write(secondChunk)
    source.close()

    expect(source.cancelReasons).toEqual([])
    expect(await remaining).toEqual([secondChunk])
    expect(runs.getSnapshot('conversation-3')?.status).toBe('completed')
  })

  it('rejects late transcript updates after an explicit stop', async () => {
    const source = controlledSource()
    let updateMessages!: (messages: UIMessage[]) => boolean
    const runs = new ConversationRuns()
    await runs.start({
      conversationId: 'stopped-transcript',
      messages: [],
      createStream: (_signal, _runId, update) => {
        updateMessages = update
        return source.stream
      },
    })

    const partial = [
      {
        id: 'partial',
        role: 'assistant' as const,
        parts: [{ type: 'text' as const, text: 'partial answer' }],
      },
    ]
    expect(updateMessages(partial)).toBe(true)
    await runs.stop('stopped-transcript')

    expect(
      updateMessages([
        ...partial,
        {
          id: 'late',
          role: 'assistant' as const,
          parts: [{ type: 'text' as const, text: 'late mutation' }],
        },
      ]),
    ).toBe(false)
    expect(runs.getSnapshot('stopped-transcript')?.messages).toEqual(partial)
  })

  it('marks an AI SDK error chunk as a failed run and panel assignment', async () => {
    const source = controlledSource()
    const runs = new ConversationRuns()
    const panels = runs.subscribePanelAssignments().getReader()
    await panels.read()
    await runs.start({
      conversationId: 'conversation-error',
      messages: [],
      panelTabIds: [7],
      createStream: () => source.stream,
    })
    await panels.read()

    source.write({ type: 'error', errorText: 'provider unavailable' })
    source.close()

    expect((await panels.read()).value?.assignments[0]?.status).toBe('failed')
    expect(runs.getSnapshot('conversation-error')?.status).toBe('failed')
    await panels.cancel()
  })

  it('waits for preparation cleanup before deletion and blocks replacement', async () => {
    let provideStream!: (stream: ReadableStream<UIMessageChunk>) => void
    const prepared = new Promise<ReadableStream<UIMessageChunk>>((resolve) => {
      provideStream = resolve
    })
    const runs = new ConversationRuns()
    const starting = runs.start({
      conversationId: 'conversation-deleting',
      messages: [],
      createStream: () => prepared,
    })
    let settled = false
    const deleting = runs.delete('conversation-deleting').then((value) => {
      settled = true
      return value
    })
    await Promise.resolve()

    expect(settled).toBe(false)
    await expect(
      runs.start({
        conversationId: 'conversation-deleting',
        messages: [],
        createStream: () => new ReadableStream<UIMessageChunk>(),
      }),
    ).rejects.toBeInstanceOf(ConversationRunAlreadyActiveError)

    provideStream(new ReadableStream<UIMessageChunk>())
    await starting
    expect(await deleting).toBe(true)
    expect(runs.getSnapshot('conversation-deleting')).toBeUndefined()
  })

  it('wakes retained panels without reclaiming tabs owned by another conversation', async () => {
    const runs = new ConversationRuns()
    const first = controlledSource()
    await runs.start({
      conversationId: 'older',
      messages: [],
      panelTabIds: [20],
      createStream: () => first.stream,
    })
    runs.activeRun('older')?.associateTabs([21])
    first.close()
    await eventually(() =>
      expect(runs.getSnapshot('older')?.status).toBe('completed'),
    )

    const newer = controlledSource()
    await runs.start({
      conversationId: 'newer',
      messages: [],
      panelTabIds: [21],
      createStream: () => newer.stream,
    })
    const second = controlledSource()
    await runs.start({
      conversationId: 'older',
      messages: [],
      panelTabIds: [20],
      createStream: () => second.stream,
    })

    const assignments = await currentPanelAssignments(runs)
    expect(assignments.assignments).toEqual([
      expect.objectContaining({ tabId: 20, conversationId: 'older' }),
      expect.objectContaining({ tabId: 21, conversationId: 'newer' }),
    ])
    await runs.stop('newer')
    await runs.stop('older')
  })

  it('keeps scheduled runs out of panel state', async () => {
    const source = controlledSource()
    const runs = new ConversationRuns()
    await runs.start({
      conversationId: 'scheduled',
      messages: [],
      panelTabIds: [30],
      panelsVisible: false,
      createStream: () => source.stream,
    })

    expect(runs.activeRun('scheduled')?.associateTabs([31])).toBe(false)
    expect(await currentPanelAssignments(runs)).toEqual({ assignments: [] })
    await runs.stop('scheduled')
  })

  it('records explicit stop as an aborted task outcome', async () => {
    const source = controlledSource()
    const runs = new ConversationRuns()
    const started = await runs.start({
      conversationId: 'aborted-trace',
      messages: [],
      createStream: () => source.stream,
    })
    await runs.stop('aborted-trace')
    expect(
      runs
        .getSnapshot('aborted-trace')
        ?.traceEvents?.map(({ taskId, kind, outcome }) => [
          taskId,
          kind,
          outcome,
        ]),
    ).toEqual([
      [started.runId, 'task_started', undefined],
      [started.runId, 'task_finished', 'aborted'],
    ])
  })

  it('holds panel hydration until preparation publishes canonical messages', async () => {
    let releasePreparation!: () => void
    const preparation = new Promise<void>((resolve) => {
      releasePreparation = resolve
    })
    const runs = new ConversationRuns()
    const starting = runs.start({
      conversationId: 'hydrating',
      messages: [],
      panelTabIds: [32],
      createStream: async (_signal, _runId, updateMessages) => {
        await preparation
        updateMessages([{ id: 'canonical-user', role: 'user', parts: [] }])
        return new ReadableStream<UIMessageChunk>()
      },
    })
    let settled = false
    const hydrating = runs.getPreparedSnapshot('hydrating').then((snapshot) => {
      settled = true
      return snapshot
    })
    await Promise.resolve()
    expect(settled).toBe(false)

    releasePreparation()
    await starting
    expect((await hydrating)?.messages?.[0]?.id).toBe('canonical-user')
    await runs.stop('hydrating')
  })

  it('rejects stale message updates from a replaced run', async () => {
    const first = controlledSource()
    const runs = new ConversationRuns()
    const firstRun = await runs.start({
      conversationId: 'conversation-messages',
      messages: [],
      createStream: () => first.stream,
    })
    first.close()
    await eventually(() =>
      expect(runs.getSnapshot('conversation-messages')?.status).toBe(
        'completed',
      ),
    )
    const second = controlledSource()
    const secondRun = await runs.start({
      conversationId: 'conversation-messages',
      messages: [],
      createStream: () => second.stream,
    })

    expect(
      runs.updateMessages('conversation-messages', firstRun.runId, [
        { id: 'stale', role: 'assistant', parts: [] },
      ]),
    ).toBe(false)
    expect(
      runs.updateMessages('conversation-messages', secondRun.runId, [
        { id: 'current', role: 'user', parts: [] },
      ]),
    ).toBe(true)
    expect(runs.getSnapshot('conversation-messages')?.messages?.[0]?.id).toBe(
      'current',
    )
    await runs.stop('conversation-messages')
  })
})

function controlledSource() {
  let controller!: ReadableStreamDefaultController<UIMessageChunk>
  const cancelReasons: unknown[] = []
  const stream = new ReadableStream<UIMessageChunk>({
    start(nextController) {
      controller = nextController
    },
    cancel(reason) {
      cancelReasons.push(reason)
    },
  })
  return {
    stream,
    cancelReasons,
    write: (chunk: UIMessageChunk) => controller.enqueue(chunk),
    close: () => controller.close(),
  }
}

async function currentPanelAssignments(runs: ConversationRuns) {
  const reader = runs.subscribePanelAssignments().getReader()
  const assignments = (await reader.read()).value ?? { assignments: [] }
  await reader.cancel()
  return assignments
}

async function collect(
  stream: ReadableStream<UIMessageChunk>,
): Promise<UIMessageChunk[]> {
  const chunks: UIMessageChunk[] = []
  for await (const chunk of stream) chunks.push(chunk)
  return chunks
}

async function eventually(assertion: () => void): Promise<void> {
  for (let attempt = 0; attempt < 20; attempt += 1) {
    try {
      assertion()
      return
    } catch {
      await Promise.resolve()
    }
  }
  assertion()
}
