/**
 * @license
 * Copyright 2025 BrowserOS
 * SPDX-License-Identifier: AGPL-3.0-or-later
 */

import { z } from 'zod'

export const AGENT_TOOL_CONTRACT_VERSION = 1 as const

const SAFE_IDENTIFIER = /^[A-Za-z0-9][A-Za-z0-9_.:-]{0,127}$/
const SafeIdentifierSchema = z.string().regex(SAFE_IDENTIFIER)
const TRACE_TOOL_NAME = /^[a-z][a-z0-9]*(?:[._-]+[a-z0-9]+)*$/
const JWT_SHAPED_VALUE = /^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/

/** Versioned transport envelope. Tool arguments/results stay outside traces. */
export const AgentToolCallEnvelopeSchema = z
  .object({
    version: z.literal(AGENT_TOOL_CONTRACT_VERSION),
    taskId: z.string().uuid(),
    toolCallId: SafeIdentifierSchema,
    toolName: SafeIdentifierSchema,
    input: z.unknown(),
  })
  .strict()

export const AgentToolResultEnvelopeSchema = z
  .object({
    version: z.literal(AGENT_TOOL_CONTRACT_VERSION),
    taskId: z.string().uuid(),
    toolCallId: SafeIdentifierSchema,
    toolName: SafeIdentifierSchema,
    ok: z.boolean(),
    output: z.unknown().optional(),
    errorCode: SafeIdentifierSchema.optional(),
  })
  .strict()
  .superRefine((result, context) => {
    if (result.ok && result.errorCode !== undefined) {
      context.addIssue({
        code: 'custom',
        path: ['errorCode'],
        message: 'Successful results cannot include an error code',
      })
    }
    if (!result.ok && result.output !== undefined) {
      context.addIssue({
        code: 'custom',
        path: ['output'],
        message: 'Failed results cannot include output',
      })
    }
  })

/**
 * The trace deliberately has no arguments, output, prompt, URL, or free-form
 * message field. Strict parsing prevents callers from attaching private page
 * context or credential-bearing tool data.
 */
export const AgentTaskTraceEventSchema = z
  .object({
    version: z.literal(1),
    taskId: z.string().uuid(),
    eventId: z.string().uuid(),
    at: z.number().int().nonnegative(),
    kind: z.enum([
      'task_started',
      'tool_started',
      'tool_finished',
      'approval_requested',
      'approval_resolved',
      'task_finished',
      'task_interrupted',
    ]),
    // Trace IDs are generated locally; raw provider/tool call IDs may contain
    // credential-like data and must never be copied into the trace.
    toolCallId: z.string().uuid().optional(),
    toolName: z
      .string()
      .min(1)
      .max(128)
      .regex(TRACE_TOOL_NAME)
      .refine((name) => !JWT_SHAPED_VALUE.test(name), {
        message: 'Tool names cannot have a JWT-shaped value',
      })
      .optional(),
    outcome: z
      .enum([
        'ok',
        'error',
        'approved',
        'denied',
        'completed',
        'aborted',
        'failed',
      ])
      .optional(),
    durationMs: z.number().int().nonnegative().optional(),
  })
  .strict()
  .superRefine((event, context) => {
    const toolEvent =
      event.kind === 'tool_started' || event.kind === 'tool_finished'
    const approvalEvent =
      event.kind === 'approval_requested' || event.kind === 'approval_resolved'

    if (toolEvent && (!event.toolCallId || !event.toolName)) {
      context.addIssue({
        code: 'custom',
        message: 'Tool events require toolCallId and toolName attribution',
      })
    }
    if (
      !toolEvent &&
      !approvalEvent &&
      (event.toolCallId !== undefined || event.toolName !== undefined)
    ) {
      context.addIssue({
        code: 'custom',
        message: 'Only tool and approval events may include tool attribution',
      })
    }
    if (
      approvalEvent &&
      (event.toolCallId === undefined || event.toolName === undefined)
    ) {
      context.addIssue({
        code: 'custom',
        message: 'Approval events require toolCallId and toolName attribution',
      })
    }
    if (
      event.kind === 'tool_finished' &&
      event.outcome !== 'ok' &&
      event.outcome !== 'error'
    ) {
      context.addIssue({
        code: 'custom',
        path: ['outcome'],
        message: 'Finished tool events require an ok or error outcome',
      })
    }
    if (event.kind === 'tool_started' && event.outcome !== undefined) {
      context.addIssue({
        code: 'custom',
        path: ['outcome'],
        message: 'Tool-start events cannot have a finish outcome',
      })
    }
    if (event.kind === 'task_started' && event.outcome !== undefined) {
      context.addIssue({
        code: 'custom',
        path: ['outcome'],
        message: 'Task-start events cannot have a finish outcome',
      })
    }
    if (event.kind === 'approval_requested' && event.outcome !== undefined) {
      context.addIssue({
        code: 'custom',
        path: ['outcome'],
        message: 'Approval requests cannot include a resolution outcome',
      })
    }
    if (
      event.kind === 'approval_resolved' &&
      event.outcome !== 'approved' &&
      event.outcome !== 'denied'
    ) {
      context.addIssue({
        code: 'custom',
        path: ['outcome'],
        message: 'Approval resolutions require approved or denied outcome',
      })
    }
    if (
      event.kind === 'task_finished' &&
      event.outcome !== 'completed' &&
      event.outcome !== 'aborted' &&
      event.outcome !== 'failed'
    ) {
      context.addIssue({
        code: 'custom',
        path: ['outcome'],
        message: 'Finished tasks require completed, aborted, or failed outcome',
      })
    }
    if (event.kind === 'task_interrupted' && event.outcome !== undefined) {
      context.addIssue({
        code: 'custom',
        path: ['outcome'],
        message: 'Interrupted tasks cannot include a finish outcome',
      })
    }
  })

export type AgentTaskTraceEvent = z.infer<typeof AgentTaskTraceEventSchema>
export type AgentToolCallEnvelope = z.infer<typeof AgentToolCallEnvelopeSchema>
export type AgentToolResultEnvelope = z.infer<
  typeof AgentToolResultEnvelopeSchema
>

/** Build a trace event with local task identity, event identity, and time. */
export interface NewAgentTaskTraceEvent {
  kind: AgentTaskTraceEvent['kind']
  toolCallId?: string
  toolName?: string
  outcome?: NonNullable<AgentTaskTraceEvent['outcome']>
  durationMs?: number
}

/** Keep only conventional tool identifiers in traces; arguments and provider IDs never enter. */
export function safeAgentTraceToolName(name: string): string {
  return AgentTaskTraceEventSchema.safeParse({
    version: 1,
    taskId: '00000000-0000-4000-8000-000000000000',
    eventId: '00000000-0000-4000-8000-000000000001',
    at: 0,
    kind: 'tool_started',
    toolCallId: '00000000-0000-4000-8000-000000000002',
    toolName: name,
  }).success
    ? name
    : 'unknown'
}

export function createAgentTaskTraceEvent(
  event: NewAgentTaskTraceEvent,
  options: { taskId: string; at?: number; eventId?: string },
): AgentTaskTraceEvent {
  return AgentTaskTraceEventSchema.parse({
    version: AGENT_TOOL_CONTRACT_VERSION,
    ...event,
    taskId: options.taskId,
    eventId: options.eventId ?? crypto.randomUUID(),
    at: options.at ?? Date.now(),
  })
}

export type AgentTaskStatus =
  | 'queued'
  | 'running'
  | 'waiting_approval'
  | 'cancel_requested'
  | 'completed'
  | 'aborted'
  | 'failed'
  | 'interrupted'

const TRANSITIONS: Readonly<
  Record<AgentTaskStatus, readonly AgentTaskStatus[]>
> = {
  queued: ['running', 'aborted', 'failed'],
  running: [
    'waiting_approval',
    'completed',
    'cancel_requested',
    'failed',
    'interrupted',
  ],
  waiting_approval: ['running', 'cancel_requested', 'failed', 'interrupted'],
  cancel_requested: ['aborted', 'interrupted'],
  completed: [],
  aborted: [],
  failed: [],
  interrupted: [],
}

/** Return false for invalid or terminal-state transitions. */
export function canTransitionAgentTask(
  from: AgentTaskStatus,
  to: AgentTaskStatus,
): boolean {
  return TRANSITIONS[from].includes(to)
}

export function transitionAgentTask(
  from: AgentTaskStatus,
  to: AgentTaskStatus,
): AgentTaskStatus {
  if (!canTransitionAgentTask(from, to)) {
    throw new Error(`Invalid agent task transition: ${from} -> ${to}`)
  }
  return to
}

/**
 * On restart, queued work is cancelled and active work is interrupted. Neither
 * state resumes automatically, so a tool with side effects cannot replay.
 */
export function recoverAgentTaskAfterRestart(
  status: AgentTaskStatus,
): AgentTaskStatus {
  if (status === 'queued') return 'aborted'
  if (
    status === 'running' ||
    status === 'waiting_approval' ||
    status === 'cancel_requested'
  ) {
    return 'interrupted'
  }
  return status
}

/** Retries are new tasks; an existing identity is never reopened or replayed. */
export function canRetryAgentTask(
  status: AgentTaskStatus,
  previousTaskId: string,
  retryTaskId: string,
): boolean {
  return (
    (status === 'aborted' || status === 'failed' || status === 'interrupted') &&
    z.string().uuid().safeParse(previousTaskId).success &&
    z.string().uuid().safeParse(retryTaskId).success &&
    previousTaskId !== retryTaskId
  )
}
