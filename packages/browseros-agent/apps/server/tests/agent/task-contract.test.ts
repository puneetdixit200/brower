import { describe, expect, it } from 'bun:test'
import {
  AgentTaskTraceEventSchema,
  AgentToolCallEnvelopeSchema,
  AgentToolResultEnvelopeSchema,
  canRetryAgentTask,
  canTransitionAgentTask,
  createAgentTaskTraceEvent,
  recoverAgentTaskAfterRestart,
  transitionAgentTask,
} from '../../src/agent/task-contract'

const taskId = 'adce6ef6-8007-4a95-9d8e-ead50ee8c3be'
const retryTaskId = 'adce6ef6-8007-4a95-9d8e-ead50ee8c3bf'
const eventId = '24f55f66-ff4b-4a7a-935e-00628dbdf430'
const traceToolCallId = '7480a0ce-f7e4-47db-9f74-e55de32f2195'
const jwtSentinel = 'eyJhbGciOiJub25lIn0.eyJzdWIiOiIxMjM0NTY3ODkwIn0.signature'
const baseEvent = { version: 1, taskId, eventId, at: 0 }

describe('agent task contract', () => {
  it('accepts versioned tool calls and rejects unsupported or malformed envelopes', () => {
    const call = {
      version: 1,
      taskId,
      toolCallId: 'call-1',
      toolName: 'browser.navigate',
      input: { url: 'https://example.test' },
    }
    expect(AgentToolCallEnvelopeSchema.parse(call)).toEqual(call)
    expect(
      AgentToolCallEnvelopeSchema.safeParse({ ...call, version: 2 }).success,
    ).toBe(false)
    expect(
      AgentToolCallEnvelopeSchema.safeParse({ ...call, unexpected: 'field' })
        .success,
    ).toBe(false)
    for (const sentinel of [
      'credential=sentinel',
      'user secret',
      'token\nvalue',
    ]) {
      expect(
        AgentToolCallEnvelopeSchema.safeParse({ ...call, toolCallId: sentinel })
          .success,
      ).toBe(false)
      expect(
        AgentToolCallEnvelopeSchema.safeParse({ ...call, toolName: sentinel })
          .success,
      ).toBe(false)
    }
  })

  it('keeps result success and error payloads mutually exclusive', () => {
    const good = {
      version: 1,
      taskId,
      toolCallId: 'call-1',
      toolName: 'navigate',
      ok: true,
      output: { title: 'Example' },
    }
    expect(AgentToolResultEnvelopeSchema.parse(good)).toEqual(good)
    expect(
      AgentToolResultEnvelopeSchema.safeParse({ ...good, errorCode: 'FAILED' })
        .success,
    ).toBe(false)
    expect(
      AgentToolResultEnvelopeSchema.safeParse({ ...good, ok: false }).success,
    ).toBe(false)
    expect(
      AgentToolResultEnvelopeSchema.safeParse({
        ...good,
        toolName: 'password=sentinel',
      }).success,
    ).toBe(false)
  })

  it('preserves safe task/tool attribution and rejects context or credential sentinels', () => {
    const event = {
      ...baseEvent,
      at: 1_800_000_000_000,
      kind: 'tool_finished',
      toolCallId: traceToolCallId,
      toolName: 'navigate',
      outcome: 'ok',
      durationMs: 25,
    } as const
    expect(AgentTaskTraceEventSchema.parse(event)).toEqual(event)
    expect(
      AgentTaskTraceEventSchema.parse({ ...event, toolName: 'browser.tabs' })
        .toolName,
    ).toBe('browser.tabs')
    expect(
      AgentTaskTraceEventSchema.parse({
        ...event,
        toolName: 'mcp__google_drive__search',
      }).toolName,
    ).toBe('mcp__google_drive__search')
    for (const sentinel of [
      'password=sentinel',
      'private page',
      'token\nvalue',
      jwtSentinel,
      jwtSentinel.toLowerCase(),
    ]) {
      expect(
        AgentTaskTraceEventSchema.safeParse({
          ...event,
          toolCallId: sentinel,
        }).success,
      ).toBe(false)
      expect(
        AgentTaskTraceEventSchema.safeParse({
          ...event,
          toolName: sentinel,
        }).success,
      ).toBe(false)
    }
    expect(
      AgentTaskTraceEventSchema.safeParse({
        ...event,
        output: { password: 'sentinel' },
      }).success,
    ).toBe(false)
    expect(
      AgentTaskTraceEventSchema.safeParse({
        ...event,
        pageText: 'private page',
      }).success,
    ).toBe(false)
    expect(
      AgentTaskTraceEventSchema.safeParse({ ...event, taskId: 'not-a-uuid' })
        .success,
    ).toBe(false)
  })

  it('generates trace identity locally and validates generated events', () => {
    const event = createAgentTaskTraceEvent(
      { kind: 'task_started' },
      { taskId, at: 42, eventId },
    )
    expect(event).toEqual({
      version: 1,
      taskId,
      kind: 'task_started',
      at: 42,
      eventId,
    })
    expect(() =>
      createAgentTaskTraceEvent(
        { kind: 'tool_started', toolCallId: 'private', toolName: 'navigate' },
        { taskId, at: 42, eventId },
      ),
    ).toThrow()
  })

  it('requires finished outcomes and makes approval request/resolution distinct', () => {
    expect(
      AgentTaskTraceEventSchema.safeParse({
        ...baseEvent,
        kind: 'tool_started',
        toolCallId: traceToolCallId,
        toolName: 'navigate',
        outcome: 'ok',
      }).success,
    ).toBe(false)
    expect(
      AgentTaskTraceEventSchema.safeParse({
        ...baseEvent,
        kind: 'tool_finished',
        toolCallId: traceToolCallId,
        toolName: 'navigate',
      }).success,
    ).toBe(false)
    expect(
      AgentTaskTraceEventSchema.safeParse({
        ...baseEvent,
        kind: 'task_finished',
      }).success,
    ).toBe(false)
    expect(
      AgentTaskTraceEventSchema.safeParse({
        ...baseEvent,
        kind: 'task_started',
        outcome: 'completed',
      }).success,
    ).toBe(false)

    const requested = {
      ...baseEvent,
      kind: 'approval_requested',
      toolCallId: traceToolCallId,
      toolName: 'send_message',
    } as const
    expect(AgentTaskTraceEventSchema.parse(requested)).toEqual(requested)
    expect(
      AgentTaskTraceEventSchema.safeParse({
        ...requested,
        outcome: 'approved',
      }).success,
    ).toBe(false)
    const resolved = {
      ...baseEvent,
      kind: 'approval_resolved',
      toolCallId: traceToolCallId,
      toolName: 'send_message',
      outcome: 'denied',
    } as const
    expect(AgentTaskTraceEventSchema.parse(resolved)).toEqual(resolved)
    expect(
      AgentTaskTraceEventSchema.safeParse({
        ...resolved,
        toolName: undefined,
      }).success,
    ).toBe(false)
    expect(
      AgentTaskTraceEventSchema.safeParse({
        ...baseEvent,
        kind: 'approval_resolved',
        outcome: 'approved',
      }).success,
    ).toBe(false)
    expect(
      AgentTaskTraceEventSchema.safeParse({
        ...baseEvent,
        kind: 'approval_requested',
      }).success,
    ).toBe(false)
  })

  it('models cancellation of queued and in-flight work without reopening terminal states', () => {
    expect(canTransitionAgentTask('queued', 'aborted')).toBe(true)
    expect(canTransitionAgentTask('running', 'cancel_requested')).toBe(true)
    expect(transitionAgentTask('cancel_requested', 'aborted')).toBe('aborted')
    expect(canTransitionAgentTask('cancel_requested', 'completed')).toBe(false)
    expect(canTransitionAgentTask('completed', 'running')).toBe(false)
    expect(() => transitionAgentTask('aborted', 'running')).toThrow(
      /Invalid agent task transition/,
    )
  })

  it('recovers pending work without replay and preserves terminal results', () => {
    expect(recoverAgentTaskAfterRestart('queued')).toBe('aborted')
    expect(recoverAgentTaskAfterRestart('running')).toBe('interrupted')
    expect(recoverAgentTaskAfterRestart('waiting_approval')).toBe('interrupted')
    expect(recoverAgentTaskAfterRestart('cancel_requested')).toBe('interrupted')
    expect(recoverAgentTaskAfterRestart('completed')).toBe('completed')
    expect(recoverAgentTaskAfterRestart('aborted')).toBe('aborted')
    expect(recoverAgentTaskAfterRestart('failed')).toBe('failed')
    expect(recoverAgentTaskAfterRestart('interrupted')).toBe('interrupted')
    expect(canRetryAgentTask('interrupted', taskId, retryTaskId)).toBe(true)
    expect(canRetryAgentTask('aborted', taskId, taskId)).toBe(false)
    expect(canRetryAgentTask('completed', taskId, retryTaskId)).toBe(false)
    expect(canRetryAgentTask('failed', 'bad-id', retryTaskId)).toBe(false)
  })
})
