import type { ProviderType } from '@/lib/llm-providers/types'

export type ChatProviderType = ProviderType | 'acp'

export interface Provider {
  id: string
  name: string
  type: ChatProviderType
  kind: 'llm' | 'acp'
  agentId?: string
  adapterName?: string
  /** Brand id for the agent's logo (its type, or a popular-agent id). */
  brandKey?: string
  /** Persisted provider model selected in AI Settings. */
  modelId?: string
  /** Persisted provider reasoning controls selected in AI Settings. */
  reasoningEffort?: string
  modelLabel?: string
  modelControl?: 'runtime-supported' | 'best-effort'
}
