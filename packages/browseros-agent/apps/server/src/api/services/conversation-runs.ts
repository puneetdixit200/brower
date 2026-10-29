/**
 * @license
 * Copyright 2025 BrowserOS
 * SPDX-License-Identifier: AGPL-3.0-or-later
 */

import type {
  ConversationPanelAssignments,
  ConversationRunStatus,
} from '@browseros/shared/schemas/conversation-panels'
import type { UIMessage, UIMessageChunk } from 'ai'
import {
  type AgentTaskStatus,
  type AgentTaskTraceEvent,
  AgentTaskTraceEventSchema,
  createAgentTaskTraceEvent,
  type NewAgentTaskTraceEvent,
  safeAgentTraceToolName,
  transitionAgentTask,
} from '../../agent/task-contract'
import type { ConversationRunLifecycleStore } from '../../lib/conversations/conversation-run-lifecycle-store'

export type { ConversationRunStatus } from '@browseros/shared/schemas/conversation-panels'

const DEFAULT_PANEL_ASSIGNMENTS_HEARTBEAT_MS = 5_000

export interface ConversationRunSnapshot {
  conversationId: string
  runId: string
  status: ConversationRunStatus
  /** Omitted when only lifecycle metadata survived a restart. */
  messages?: UIMessage[]
  chunkCount: number
  startedAt?: number
  finishedAt?: number | null
  /** Redacted lifecycle metadata; tool arguments/results are omitted. */
  traceEvents?: AgentTaskTraceEvent[]
  /** True when trace storage failed; execution and tool results remain usable. */
  tracePersistenceDegraded?: true
  /** Safe, opaque indication that an in-memory continuation awaits the user. */
  humanIntervention?: { requestId: string }
}

export interface ConversationTabGroupPresentation {
  /** Stable title used if this conversation creates browser tabs. */
  title: string
  /** Stable identity input used to choose a Chrome tab-group color. */
  colorKey: string
}

export interface StartConversationRunInput {
  conversationId: string
  messages: UIMessage[]
  /** Chrome tab ids whose panels should display this run immediately. */
  panelTabIds?: readonly number[]
  /** Scheduled work executes normally but must not open or group visible tabs. */
  panelsVisible?: boolean
  tabGroup?: ConversationTabGroupPresentation
  createStream: (
    signal: AbortSignal,
    runId: string,
    updateMessages: (messages: UIMessage[]) => boolean,
  ) => ReadableStream<UIMessageChunk> | Promise<ReadableStream<UIMessageChunk>>
}

export interface StartedConversationRun {
  runId: string
}

/**
 * A request-scoped capability pinned to the run that authorized a tool call.
 * Its mutations become no-ops after that run finishes or is replaced.
 */
export interface ActiveConversationRun {
  readonly conversationId: string
  readonly runId: string
  readonly panelsVisible: boolean
  readonly tabGroup: ConversationTabGroupPresentation | undefined
  /** Aborts browser work when the user stops this exact run. */
  readonly signal: AbortSignal
  /** Binds tabs created by this run and requests their initial panel open. */
  associateTabs(tabIds: readonly number[]): boolean
}

export interface ConversationRunActivity {
  beginChatStream(): void
  endChatStream(): void
}

interface ConversationRunRecord {
  conversationId: string
  runId: string
  status: ConversationRunStatus
  startedAt: number
  finishedAt: number | null
  messages: UIMessage[]
  chunks: UIMessageChunk[]
  panelsVisible: boolean
  tabGroup?: ConversationTabGroupPresentation
  abortController: AbortController
  reader?: ReadableStreamDefaultReader<UIMessageChunk>
  subscribers: Set<ReadableStreamDefaultController<UIMessageChunk>>
  sawErrorChunk: boolean
  ended: boolean
  deleting: boolean
  activityStarted: boolean
  preparedResolved: boolean
  prepared: Promise<void>
  resolvePrepared: () => void
  finished: Promise<void>
  resolveFinished: () => void
  taskStatus: AgentTaskStatus
  traceEvents: AgentTaskTraceEvent[]
  tracePersistenceDegraded: boolean
  toolTraceIds: Map<string, { traceId: string; toolName: string }>
  approvalToolCalls: Map<string, string>
  humanWait?: {
    requestId: string
    resolve: () => void
    reject: (error: Error) => void
    abort: () => void
  }
}

export interface HumanInterventionWait {
  requestId: string
  continuation: Promise<void>
}

interface PanelAssignmentsSubscriber {
  controller: ReadableStreamDefaultController<ConversationPanelAssignments>
  heartbeat?: ReturnType<typeof setInterval>
}

interface ConversationRunsDeps {
  activity?: ConversationRunActivity
  lifecycleStore?: ConversationRunLifecycleStore
  /** Lower values heal clients faster at the cost of more loopback traffic. */
  panelAssignmentsHeartbeatMs?: number
  /** Caps simultaneous model/browser runs, not retained finished histories. */
  maxConcurrentRuns?: number
}

export class ConversationRunAlreadyActiveError extends Error {
  constructor() {
    super('A conversation run is already active')
    this.name = 'ConversationRunAlreadyActiveError'
  }
}

export class ConversationCapacityError extends Error {
  constructor() {
    super(
      'Aster is at its concurrent agent-task limit; finish or stop a task first',
    )
    this.name = 'ConversationCapacityError'
  }
}

export class ConversationRunNotFoundError extends Error {
  constructor() {
    super('Conversation run not found')
    this.name = 'ConversationRunNotFoundError'
  }
}

/**
 * Owns execution, replay, cancellation, and the panel projection for every
 * conversation. Panel entries point directly at run records, so status cannot
 * drift between a separate “presence” service and the stream being rendered.
 */
export class ConversationRuns {
  private readonly runs = new Map<string, ConversationRunRecord>()
  private readonly recoveredInterruptionEvents = new Map<
    string,
    AgentTaskTraceEvent
  >()
  private readonly panelByTab = new Map<number, ConversationRunRecord>()
  private readonly autoOpenByTab = new Map<number, string>()
  private readonly panelSubscribers = new Set<PanelAssignmentsSubscriber>()

  constructor(private readonly deps: ConversationRunsDeps = {}) {}

  async start(
    input: StartConversationRunInput,
  ): Promise<StartedConversationRun> {
    const existing = this.runs.get(input.conversationId)
    if (existing?.status === 'running' || existing?.deleting) {
      throw new ConversationRunAlreadyActiveError()
    }
    // Separate conversations may run in parallel, but a burst cannot create
    // unbounded browser tools or model connections in a 14 GiB Linux session.
    const configuredCap = this.deps.maxConcurrentRuns ?? 4
    const cap = Math.max(1, Math.min(32, Math.floor(configuredCap)))
    const active = [...this.runs.values()].filter(
      (run) => run.status === 'running' || run.deleting,
    ).length
    if (active >= cap) throw new ConversationCapacityError()

    let resolveFinished!: () => void
    let resolvePrepared!: () => void
    const prepared = new Promise<void>((resolve) => {
      resolvePrepared = resolve
    })
    const finished = new Promise<void>((resolve) => {
      resolveFinished = resolve
    })
    const record: ConversationRunRecord = {
      conversationId: input.conversationId,
      runId: crypto.randomUUID(),
      status: 'running',
      startedAt: Date.now(),
      finishedAt: null,
      messages: [...input.messages],
      chunks: [],
      panelsVisible: input.panelsVisible ?? true,
      // Keep the first useful presentation across turns. If no tab was opened
      // until a later turn, its eventual group still describes the conversation
      // rather than only the latest prompt.
      tabGroup: existing?.tabGroup ?? input.tabGroup,
      abortController: new AbortController(),
      subscribers: new Set(),
      sawErrorChunk: false,
      ended: false,
      deleting: false,
      activityStarted: false,
      preparedResolved: false,
      prepared,
      resolvePrepared,
      finished,
      resolveFinished,
      taskStatus: 'queued',
      traceEvents: [],
      tracePersistenceDegraded: false,
      toolTraceIds: new Map(),
      approvalToolCalls: new Map(),
    }

    // Install before any provider/MCP preparation awaits. This both rejects a
    // concurrent POST and gives loopback MCP calls an authoritative active run.
    this.runs.set(input.conversationId, record)
    try {
      this.deps.lifecycleStore?.start(
        record.conversationId,
        record.runId,
        record.startedAt,
      )
    } catch (error) {
      this.runs.delete(input.conversationId)
      throw error
    }
    record.taskStatus = transitionAgentTask(record.taskStatus, 'running')
    this.appendTraceEvent(record, { kind: 'task_started' })
    this.deps.activity?.beginChatStream()
    record.activityStarted = true
    this.attachInitialPanels(record, input.panelTabIds ?? [])

    try {
      const stream = await input.createStream(
        record.abortController.signal,
        record.runId,
        (messages) =>
          this.updateMessages(record.conversationId, record.runId, messages),
      )
      record.reader = stream.getReader()
      // Stream factories publish canonical display messages before returning.
      // Release `/state` hydration only after that handoff is complete.
      this.markPrepared(record)
      if (record.abortController.signal.aborted) {
        await record.reader.cancel(record.abortController.signal.reason)
        await this.finish(record, 'aborted')
      } else {
        void this.pump(record)
      }
      return { runId: record.runId }
    } catch (error) {
      await this.finish(
        record,
        record.abortController.signal.aborted ? 'aborted' : 'failed',
      )
      throw error
    }
  }

  /** Replays buffered chunks, then attaches to the same live ordered stream. */
  subscribe(
    conversationId: string,
    runId?: string,
  ): ReadableStream<UIMessageChunk> {
    const record = this.runs.get(conversationId)
    if (!record || (runId !== undefined && record.runId !== runId)) {
      throw new ConversationRunNotFoundError()
    }
    let subscriber: ReadableStreamDefaultController<UIMessageChunk> | undefined

    return new ReadableStream<UIMessageChunk>({
      start: (controller) => {
        subscriber = controller
        for (const chunk of record.chunks) controller.enqueue(chunk)
        if (record.status === 'running') {
          record.subscribers.add(controller)
        } else {
          controller.close()
        }
      },
      // An HTTP response or panel is only a view. Explicit `stop` is the sole
      // operation allowed to cancel the provider and its browser tool calls.
      cancel: () => {
        if (subscriber) record.subscribers.delete(subscriber)
      },
    })
  }

  /**
   * Streams the complete current assignment set immediately, on each change,
   * and periodically so a client can repair transient browser-side failures.
   */
  subscribePanelAssignments(): ReadableStream<ConversationPanelAssignments> {
    let subscriber: PanelAssignmentsSubscriber | undefined
    return new ReadableStream<ConversationPanelAssignments>({
      start: (controller) => {
        subscriber = { controller }
        this.panelSubscribers.add(subscriber)
        this.enqueuePanelAssignments(subscriber)
        subscriber.heartbeat = setInterval(() => {
          if (subscriber) this.enqueuePanelAssignments(subscriber)
        }, this.deps.panelAssignmentsHeartbeatMs ??
          DEFAULT_PANEL_ASSIGNMENTS_HEARTBEAT_MS)
      },
      cancel: () => {
        if (subscriber) this.removePanelAssignmentsSubscriber(subscriber)
      },
    })
  }

  /** Pins the exact live record so a late tool effect cannot mutate a later run. */
  activeRun(conversationId: string): ActiveConversationRun | undefined {
    const record = this.runs.get(conversationId)
    if (record?.status !== 'running' || record.abortController.signal.aborted) {
      return undefined
    }
    return {
      conversationId: record.conversationId,
      runId: record.runId,
      panelsVisible: record.panelsVisible,
      tabGroup: record.tabGroup,
      signal: record.abortController.signal,
      associateTabs: (tabIds) => this.associateTabs(record, tabIds),
    }
  }

  /**
   * Suspends the caller's live stream producer on an opaque, run-scoped gate.
   * The promise lives only in memory and rejects on stop/replacement; no page
   * data or user-entered content is accepted or retained by this mechanism.
   */
  requestHumanIntervention(
    conversationId: string,
    runId: string,
    requestId: string = crypto.randomUUID(),
  ): HumanInterventionWait | undefined {
    const record = this.runs.get(conversationId)
    if (
      !record ||
      record.runId !== runId ||
      record.status !== 'running' ||
      record.deleting ||
      record.abortController.signal.aborted ||
      record.humanWait ||
      !requestId ||
      requestId.length > 200
    )
      return undefined

    let resolve!: () => void
    let reject!: (error: Error) => void
    const continuation = new Promise<void>((res, rej) => {
      resolve = res
      reject = rej
    })
    const abort = () => {
      if (record.humanWait?.requestId !== requestId) return
      record.humanWait = undefined
      reject(
        new DOMException('Run ended while waiting for the user', 'AbortError'),
      )
    }
    record.humanWait = { requestId, resolve, reject, abort }
    record.abortController.signal.addEventListener('abort', abort, {
      once: true,
    })
    return { requestId, continuation }
  }

  /** Only the exact live run and its one outstanding request may continue. */
  resumeAfterHumanIntervention(
    conversationId: string,
    runId: string,
    requestId: string,
  ): boolean {
    const record = this.runs.get(conversationId)
    const wait = record?.humanWait
    if (
      !record ||
      record.runId !== runId ||
      record.status !== 'running' ||
      record.deleting ||
      record.abortController.signal.aborted ||
      !wait ||
      wait.requestId !== requestId
    )
      return false
    record.abortController.signal.removeEventListener('abort', wait.abort)
    record.humanWait = undefined
    wait.resolve()
    return true
  }

  async stop(conversationId: string): Promise<boolean> {
    const record = this.runs.get(conversationId)
    if (record?.status !== 'running') return false

    const reason = new DOMException('Conversation stopped', 'AbortError')
    record.abortController.abort(reason)
    // Provider/MCP construction may still create resources after this call.
    // The stream factory owns unwinding them; finish only once it returns.
    if (!record.reader) return true

    await record.reader.cancel(reason).catch(() => undefined)
    await this.finish(record, 'aborted')
    return true
  }

  async delete(conversationId: string): Promise<boolean> {
    const record = this.runs.get(conversationId)
    if (!record)
      return this.deps.lifecycleStore?.delete(conversationId) ?? false
    // Prevent a replacement turn until late stream construction has unwound.
    record.deleting = true
    // Retire routing before waiting for provider cancellation. Panels must not
    // reattach to a conversation while its asynchronous teardown is unwinding.
    let panelsChanged = false
    for (const [tabId, owner] of this.panelByTab) {
      if (owner !== record) continue
      this.panelByTab.delete(tabId)
      this.autoOpenByTab.delete(tabId)
      panelsChanged = true
    }
    if (panelsChanged) this.publishPanelAssignments()
    if (record.status === 'running') await this.stop(conversationId)
    await record.finished
    if (this.runs.get(conversationId) !== record) return false

    this.runs.delete(conversationId)
    this.deps.lifecycleStore?.delete(conversationId)
    return true
  }

  getSnapshot(conversationId: string): ConversationRunSnapshot | undefined {
    const record = this.runs.get(conversationId)
    if (!record) return undefined
    return this.snapshot(record)
  }

  /**
   * Waits only for provider/agent preparation, never for the full model run.
   * This closes the panel-open race where an immediate mapping precedes loaded
   * conversation history.
   */
  async getPreparedSnapshot(
    conversationId: string,
  ): Promise<ConversationRunSnapshot | undefined> {
    while (true) {
      const record = this.runs.get(conversationId)
      if (!record) {
        const durable = this.deps.lifecycleStore?.get(conversationId)
        if (!durable) return undefined
        return this.durableSnapshot(durable)
      }
      await record.prepared
      if (this.runs.get(conversationId) === record) {
        return this.snapshot(record)
      }
    }
  }

  private durableSnapshot(
    durable: NonNullable<ReturnType<ConversationRunLifecycleStore['get']>>,
  ): ConversationRunSnapshot {
    const status = durable.status === 'running' ? 'interrupted' : durable.status
    const recoveryAt = durable.finishedAt ?? Date.now()
    const persisted = this.readDurableTraceEvents(durable)
    let tracePersistenceDegraded =
      durable.tracePersistenceDegraded || persisted.degraded
    const traceEvents = persisted.events
    const interruptionRecovery =
      status === 'interrupted'
        ? this.recoverInterruptionEvent(durable, recoveryAt)
        : undefined
    const interruptionEvent = interruptionRecovery?.event

    tracePersistenceDegraded ||= interruptionRecovery?.degraded === true
    if (
      interruptionEvent &&
      !traceEvents.some((event) => event.eventId === interruptionEvent.eventId)
    ) {
      traceEvents.push(interruptionEvent)
    }

    return {
      conversationId: durable.conversationId,
      runId: durable.runId,
      status,
      chunkCount: 0,
      startedAt: durable.startedAt,
      finishedAt:
        durable.finishedAt ??
        (status === 'interrupted'
          ? (interruptionEvent?.at ?? recoveryAt)
          : null),
      traceEvents,
      ...(tracePersistenceDegraded && {
        tracePersistenceDegraded: true as const,
      }),
    }
  }

  private readDurableTraceEvents(
    durable: NonNullable<ReturnType<ConversationRunLifecycleStore['get']>>,
  ): { events: AgentTaskTraceEvent[]; degraded: boolean } {
    try {
      const events =
        this.deps.lifecycleStore?.getTraceEvents(
          durable.conversationId,
          durable.runId,
        ) ?? []
      return {
        events: events.map((event) => {
          const validated = AgentTaskTraceEventSchema.parse(event)
          if (validated.taskId !== durable.runId) {
            throw new Error(
              'Stored conversation run trace event scope is invalid',
            )
          }
          return validated
        }),
        degraded: false,
      }
    } catch {
      return { events: [], degraded: true }
    }
  }

  private recoverInterruptionEvent(
    durable: NonNullable<ReturnType<ConversationRunLifecycleStore['get']>>,
    recoveryAt: number,
  ): { event: AgentTaskTraceEvent; degraded: boolean } {
    try {
      if (durable.status === 'running') {
        this.deps.lifecycleStore?.finish(
          durable.conversationId,
          durable.runId,
          'interrupted',
          recoveryAt,
        )
      }
      const persisted = this.deps.lifecycleStore?.ensureInterruptionTraceEvent(
        durable.conversationId,
        durable.runId,
        recoveryAt,
      )
      if (persisted) return { event: persisted, degraded: false }
    } catch {
      // Recovery continues with a stable in-memory event if persistence fails.
    }

    const key = `${durable.conversationId}:${durable.runId}`
    let event = this.recoveredInterruptionEvents.get(key)
    if (!event) {
      event = createAgentTaskTraceEvent(
        { kind: 'task_interrupted' },
        { taskId: durable.runId, at: recoveryAt },
      )
      this.recoveredInterruptionEvents.set(key, event)
    }
    return { event, degraded: true }
  }

  private snapshot(record: ConversationRunRecord): ConversationRunSnapshot {
    return {
      conversationId: record.conversationId,
      runId: record.runId,
      status: record.status,
      messages: [...record.messages],
      chunkCount: record.chunks.length,
      startedAt: record.startedAt,
      finishedAt: record.finishedAt,
      traceEvents: [...record.traceEvents],
      ...(record.humanWait && {
        humanIntervention: { requestId: record.humanWait.requestId },
      }),
      ...(record.tracePersistenceDegraded && {
        tracePersistenceDegraded: true as const,
      }),
    }
  }

  updateMessages(
    conversationId: string,
    runId: string,
    messages: UIMessage[],
  ): boolean {
    const record = this.runs.get(conversationId)
    if (
      !record ||
      record.runId !== runId ||
      record.status !== 'running' ||
      record.abortController.signal.aborted
    ) {
      return false
    }
    record.messages = [...messages]
    return true
  }

  private attachInitialPanels(
    record: ConversationRunRecord,
    requestedTabIds: readonly number[],
  ): void {
    if (!record.panelsVisible) return
    const tabIds = new Set(requestedTabIds)
    // A later turn wakes every tab still mapped to this conversation. A tab
    // claimed by another conversation is absent unless explicitly requested.
    for (const [tabId, owner] of this.panelByTab) {
      if (owner.conversationId === record.conversationId) tabIds.add(tabId)
    }
    if (tabIds.size === 0) return
    for (const tabId of tabIds) {
      if (
        this.panelByTab.get(tabId)?.conversationId !== record.conversationId
      ) {
        this.autoOpenByTab.delete(tabId)
      }
      this.panelByTab.set(tabId, record)
    }
    this.publishPanelAssignments()
  }

  private associateTabs(
    record: ConversationRunRecord,
    tabIds: readonly number[],
  ): boolean {
    if (
      !record.panelsVisible ||
      record.status !== 'running' ||
      record.deleting ||
      record.abortController.signal.aborted ||
      this.runs.get(record.conversationId) !== record
    ) {
      return false
    }

    let changed = false
    for (const tabId of tabIds) {
      if (!Number.isInteger(tabId) || tabId < 0) continue
      if (this.panelByTab.get(tabId) === record) continue
      this.panelByTab.set(tabId, record)
      this.autoOpenByTab.set(tabId, crypto.randomUUID())
      changed = true
    }
    if (changed) this.publishPanelAssignments()
    return true
  }

  removePanelTab(tabId: number): void {
    this.autoOpenByTab.delete(tabId)
    if (this.panelByTab.delete(tabId)) this.publishPanelAssignments()
  }

  private currentPanelAssignments(): ConversationPanelAssignments {
    return {
      assignments: [...this.panelByTab.entries()]
        .map(([tabId, record]) => ({
          tabId,
          conversationId: record.conversationId,
          runId: record.runId,
          status: record.status,
          ...(this.autoOpenByTab.has(tabId) && {
            autoOpenId: this.autoOpenByTab.get(tabId),
          }),
        }))
        .sort((a, b) => a.tabId - b.tabId),
    }
  }

  private publishPanelAssignments(): void {
    const assignments = this.currentPanelAssignments()
    for (const subscriber of [...this.panelSubscribers]) {
      this.enqueuePanelAssignments(subscriber, assignments)
    }
  }

  private enqueuePanelAssignments(
    subscriber: PanelAssignmentsSubscriber,
    assignments = this.currentPanelAssignments(),
  ): void {
    try {
      subscriber.controller.enqueue(assignments)
    } catch {
      this.removePanelAssignmentsSubscriber(subscriber)
    }
  }

  private removePanelAssignmentsSubscriber(
    subscriber: PanelAssignmentsSubscriber,
  ): void {
    // The timer belongs to this HTTP stream. Clearing it on cancellation avoids
    // retaining a dead controller and the run graph behind its closure.
    if (subscriber.heartbeat) clearInterval(subscriber.heartbeat)
    this.panelSubscribers.delete(subscriber)
    subscriber.heartbeat = undefined
  }

  private async pump(record: ConversationRunRecord): Promise<void> {
    const reader = record.reader
    if (!reader) return
    try {
      while (true) {
        const { done, value } = await reader.read()
        if (done) break
        if (value.type === 'error') record.sawErrorChunk = true
        this.recordTraceChunk(record, value)
        record.chunks.push(value)
        for (const subscriber of [...record.subscribers]) {
          try {
            subscriber.enqueue(value)
          } catch {
            record.subscribers.delete(subscriber)
          }
        }
      }
      await this.finish(
        record,
        record.abortController.signal.aborted
          ? 'aborted'
          : record.sawErrorChunk
            ? 'failed'
            : 'completed',
      )
    } catch {
      await this.finish(
        record,
        record.abortController.signal.aborted ? 'aborted' : 'failed',
      )
    } finally {
      reader.releaseLock()
    }
  }

  private async finish(
    record: ConversationRunRecord,
    status: Exclude<ConversationRunStatus, 'running'>,
  ): Promise<void> {
    if (record.ended) return
    record.ended = true
    record.status = status
    record.finishedAt = Date.now()
    record.humanWait?.abort()
    this.finishTaskTrace(record, status)
    // Setup failures have no stream-return point, but panel hydration must still
    // resolve to the visible failed/aborted state instead of hanging forever.
    this.markPrepared(record)
    for (const subscriber of record.subscribers) {
      try {
        subscriber.close()
      } catch {
        // A detached HTTP response may already have closed its controller.
      }
    }
    record.subscribers.clear()

    if ([...this.panelByTab.values()].includes(record)) {
      this.publishPanelAssignments()
    }
    try {
      if (record.activityStarted) this.deps.activity?.endChatStream()
    } finally {
      try {
        this.deps.lifecycleStore?.finish(
          record.conversationId,
          record.runId,
          status,
          record.finishedAt,
        )
      } finally {
        record.resolveFinished()
      }
    }
  }

  private appendTraceEvent(
    record: ConversationRunRecord,
    event: NewAgentTaskTraceEvent,
  ): void {
    const validated = createAgentTaskTraceEvent(
      { ...event },
      { taskId: record.runId },
    )
    record.traceEvents.push(validated)
    try {
      this.deps.lifecycleStore?.appendTraceEvent(
        record.conversationId,
        record.runId,
        validated,
      )
    } catch {
      // Trace durability is best effort; expose degradation in the safe
      // snapshot without changing tool execution or run completion.
      record.tracePersistenceDegraded = true
      try {
        this.deps.lifecycleStore?.markTracePersistenceDegraded(
          record.conversationId,
          record.runId,
        )
      } catch {
        // Keep the in-memory marker when the durability marker cannot be saved.
      }
    }
  }

  private recordTraceChunk(
    record: ConversationRunRecord,
    chunk: UIMessageChunk,
  ): void {
    if (record.status !== 'running' || record.abortController.signal.aborted)
      return
    const part = chunk as unknown as Record<string, unknown>
    if (typeof part.type !== 'string') return

    if (
      part.type === 'tool-input-start' &&
      typeof part.toolCallId === 'string' &&
      typeof part.toolName === 'string'
    ) {
      const traceId = crypto.randomUUID()
      const toolName = safeAgentTraceToolName(part.toolName)
      record.toolTraceIds.set(part.toolCallId, { traceId, toolName })
      this.appendTraceEvent(record, {
        kind: 'tool_started',
        toolCallId: traceId,
        toolName,
      })
      return
    }

    if (
      part.type === 'tool-approval-request' &&
      typeof part.approvalId === 'string' &&
      typeof part.toolCallId === 'string'
    ) {
      const call = record.toolTraceIds.get(part.toolCallId)
      if (!call) return
      record.approvalToolCalls.set(part.approvalId, part.toolCallId)
      if (record.taskStatus === 'running') {
        record.taskStatus = transitionAgentTask(
          record.taskStatus,
          'waiting_approval',
        )
      }
      this.appendTraceEvent(record, {
        kind: 'approval_requested',
        toolCallId: call.traceId,
        toolName: call.toolName,
      })
      return
    }

    if (
      part.type === 'tool-approval-response' &&
      typeof part.approvalId === 'string' &&
      typeof part.approved === 'boolean'
    ) {
      const rawCallId = record.approvalToolCalls.get(part.approvalId)
      const call = rawCallId && record.toolTraceIds.get(rawCallId)
      if (!call) return
      record.approvalToolCalls.delete(part.approvalId)
      if (record.taskStatus === 'waiting_approval') {
        record.taskStatus = transitionAgentTask(record.taskStatus, 'running')
      }
      this.appendTraceEvent(record, {
        kind: 'approval_resolved',
        toolCallId: call.traceId,
        toolName: call.toolName,
        outcome: part.approved ? 'approved' : 'denied',
      })
      return
    }

    if (
      (part.type === 'tool-output-available' ||
        part.type === 'tool-output-error' ||
        part.type === 'tool-output-denied' ||
        part.type === 'tool-input-error') &&
      typeof part.toolCallId === 'string'
    ) {
      const call = record.toolTraceIds.get(part.toolCallId)
      if (!call) return
      this.appendTraceEvent(record, {
        kind: 'tool_finished',
        toolCallId: call.traceId,
        toolName: call.toolName,
        outcome: part.type === 'tool-output-available' ? 'ok' : 'error',
      })
      record.toolTraceIds.delete(part.toolCallId)
    }
  }

  private finishTaskTrace(
    record: ConversationRunRecord,
    status: Exclude<ConversationRunStatus, 'running'>,
  ): void {
    if (status === 'interrupted') {
      if (
        record.taskStatus === 'cancel_requested' ||
        record.taskStatus === 'running' ||
        record.taskStatus === 'waiting_approval'
      ) {
        record.taskStatus = transitionAgentTask(
          record.taskStatus,
          'interrupted',
        )
      }
      this.appendTraceEvent(record, { kind: 'task_interrupted' })
      return
    }

    if (status === 'aborted') {
      if (
        record.taskStatus === 'running' ||
        record.taskStatus === 'waiting_approval'
      ) {
        record.taskStatus = transitionAgentTask(
          record.taskStatus,
          'cancel_requested',
        )
      }
      if (record.taskStatus === 'cancel_requested') {
        record.taskStatus = transitionAgentTask(record.taskStatus, 'aborted')
      }
    } else {
      if (record.taskStatus === 'waiting_approval') {
        record.taskStatus = transitionAgentTask(record.taskStatus, 'running')
      }
      record.taskStatus = transitionAgentTask(
        record.taskStatus,
        status === 'completed' ? 'completed' : 'failed',
      )
    }
    this.appendTraceEvent(record, {
      kind: 'task_finished',
      outcome: status === 'completed' ? 'completed' : status,
    })
    record.toolTraceIds.clear()
    record.approvalToolCalls.clear()
  }

  private markPrepared(record: ConversationRunRecord): void {
    if (record.preparedResolved) return
    record.preparedResolved = true
    record.resolvePrepared()
  }
}
