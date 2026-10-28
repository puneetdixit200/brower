import { describe, expect, test } from 'bun:test'
import {
  buildHeartbeatContinuationMessage,
  mayContinueHeartbeat,
} from './heartbeat-continuation'
import type { ScheduledJobRun } from './scheduleTypes'

const completedRun: ScheduledJobRun = {
  id: 'run-123',
  jobId: 'job-456',
  conversationId: 'conversation-789',
  status: 'completed',
  startedAt: '2026-10-29T10:00:00.000Z',
  completedAt: '2026-10-29T10:01:00.000Z',
  result: 'private result',
  executionLog: 'private execution log',
  toolCalls: [
    {
      id: 'tool-call',
      name: 'private tool',
      input: { secret: 'private input' },
      output: { secret: 'private output' },
      timestamp: '2026-10-29T10:00:30.000Z',
    },
  ],
}

describe('heartbeat continuation policy', () => {
  test('allows the first run and continuation after a completed run', () => {
    expect(mayContinueHeartbeat(undefined, undefined)).toBe(true)
    expect(mayContinueHeartbeat('completed', 'existing-conversation')).toBe(
      true,
    )
  })

  test('fails closed after a running or failed run to avoid replaying uncertain tools', () => {
    expect(mayContinueHeartbeat('running', 'existing-conversation')).toBe(false)
    expect(mayContinueHeartbeat('failed', 'existing-conversation')).toBe(false)
  })

  test('fails closed when an existing conversation has no run evidence', () => {
    expect(mayContinueHeartbeat(undefined, 'existing-conversation')).toBe(false)
  })

  test('fails closed for unknown run states', () => {
    expect(mayContinueHeartbeat('unknown', 'existing-conversation')).toBe(false)
  })

  test('creates bounded versioned context from completed run identity and timestamps only', () => {
    const runWithUntrustedApproval = {
      ...completedRun,
      approvalState: 'private approval state',
    }
    const message = buildHeartbeatContinuationMessage(
      'Check the status',
      runWithUntrustedApproval,
      'job-456',
      'conversation-789',
    )

    expect(message).toContain('Check the status')
    expect(message).toContain('"version":1')
    expect(message).toContain('"runId":"run-123"')
    expect(message).toContain('"status":"completed"')
    expect(message).toContain(
      'Inspect the existing conversation and current state',
    )
    expect(message).toContain(
      'Do not replay side effects that already completed',
    )
    expect(message).toContain('stop and report that uncertainty')
    expect(message).toContain('advisory; not enforcement')
    expect(message).not.toContain('private result')
    expect(message).not.toContain('private execution log')
    expect(message).not.toContain('private tool')
    expect(message).not.toContain('private input')
    expect(message).not.toContain('private output')
    expect(message).not.toContain('private approval state')
    expect(message).toBeDefined()
    // The short task keeps this assertion focused on the bounded checkpoint.
    expect(message?.length).toBeLessThan(1500)
  })

  test('rejects missing or mismatched run identity and unbounded metadata', () => {
    expect(
      buildHeartbeatContinuationMessage(
        'task',
        undefined,
        'job-456',
        'conversation-789',
      ),
    ).toBeUndefined()
    expect(
      buildHeartbeatContinuationMessage(
        'task',
        completedRun,
        'different-job',
        'conversation-789',
      ),
    ).toBeUndefined()
    expect(
      buildHeartbeatContinuationMessage(
        'task',
        completedRun,
        'job-456',
        'different-conversation',
      ),
    ).toBeUndefined()
    // A prior run with conversation identity cannot safely continue a job
    // whose saved conversation identity has gone missing.
    expect(
      buildHeartbeatContinuationMessage(
        'task',
        completedRun,
        'job-456',
        undefined,
      ),
    ).toBeUndefined()
    expect(
      buildHeartbeatContinuationMessage(
        'task',
        { ...completedRun, id: 'x'.repeat(129) },
        'job-456',
        'conversation-789',
      ),
    ).toBeUndefined()
    expect(
      buildHeartbeatContinuationMessage(
        'task',
        { ...completedRun, completedAt: 'not-a-timestamp' },
        'job-456',
        'conversation-789',
      ),
    ).toBeUndefined()
  })
})
