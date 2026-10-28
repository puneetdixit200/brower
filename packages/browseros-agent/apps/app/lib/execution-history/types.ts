export type ExecutionTaskStatus =
  | 'running'
  | 'completed'
  | 'stopped'
  | 'failed'
  | 'interrupted'

export type ExecutionStepState =
  | 'input-streaming'
  | 'input-available'
  | 'approval-requested'
  | 'approval-responded'
  | 'output-available'
  | 'output-error'
  | 'output-denied'

export interface ExecutionStepApproval {
  id: string
  approved?: boolean
  reason?: string
}

export interface ExecutionArtifactDescriptor {
  artifactId?: string
  filename: string
  sizeBytes: number
  sha256: string
}

export interface ExecutionStepRecord {
  id: string
  toolName: string
  order: number
  state: ExecutionStepState
  startedAt: string
  completedAt?: string
  input?: unknown
  output?: unknown
  errorText?: string
  previewText: string
  artifact?: ExecutionArtifactDescriptor
  approval?: ExecutionStepApproval
}

export interface ExecutionTaskRecord {
  id: string
  conversationId: string
  /** Server-owned run identity used to reconcile this local task after restart. */
  serverRunId?: string
  promptText: string
  promptMessageId?: string
  assistantMessageId?: string
  startedAt: string
  completedAt?: string
  status: ExecutionTaskStatus
  responseText?: string
  responsePreview?: string
  actionCount: number
  approvalCount: number
  deniedCount: number
  errorCount: number
  steps: ExecutionStepRecord[]
  artifacts?: ExecutionArtifactDescriptor[]
}

export interface ConversationExecutionHistory {
  conversationId: string
  updatedAt: number
  tasks: ExecutionTaskRecord[]
}

export type ExecutionHistoryByConversation = Record<
  string,
  ConversationExecutionHistory
>
