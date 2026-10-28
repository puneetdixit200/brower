import type { UIMessage } from 'ai'
import { and, eq, gt, isNull, or } from 'drizzle-orm'
import { type BrowserOsDatabase, getDb } from '../lib/db'
import { actionPolicyRules } from '../lib/db/schema/action-policy'
import {
  decideToolApproval,
  type ToolApprovalCandidate,
} from './tool-approval-policy'

export type PolicyDecision = 'allow' | 'ask' | 'deny'

export const ACTION_POLICY_CATALOG = [
  { id: 'browser.act.click', label: 'Click page element' },
  { id: 'browser.act.click_at', label: 'Click page coordinates' },
  { id: 'browser.act.type', label: 'Type into page' },
  { id: 'browser.act.type_at', label: 'Type at page coordinates' },
  { id: 'browser.act.fill', label: 'Fill page field' },
  { id: 'browser.act.press', label: 'Press page key' },
  { id: 'browser.act.hover', label: 'Hover page element' },
  { id: 'browser.act.hover_at', label: 'Hover page coordinates' },
  { id: 'browser.act.focus', label: 'Focus page element' },
  { id: 'browser.act.check', label: 'Check page control' },
  { id: 'browser.act.uncheck', label: 'Uncheck page control' },
  { id: 'browser.act.select', label: 'Select page option' },
  { id: 'browser.act.scroll', label: 'Scroll page' },
  { id: 'browser.act.drag', label: 'Drag page element' },
  { id: 'browser.act.drag_at', label: 'Drag page coordinates' },
  { id: 'browser.run', label: 'Run browser code' },
  { id: 'browser.evaluate', label: 'Evaluate page code' },
  { id: 'browser.tabs.new', label: 'Open browser tab' },
  { id: 'browser.tabs.close', label: 'Close browser tab' },
  { id: 'browser.windows.create', label: 'Create browser window' },
  { id: 'browser.windows.close', label: 'Close browser window' },
  { id: 'browser.windows.activate', label: 'Activate browser window' },
  { id: 'browser.tab_groups.create', label: 'Create tab group' },
  { id: 'browser.tab_groups.update', label: 'Update tab group' },
  { id: 'browser.tab_groups.ungroup', label: 'Ungroup browser tabs' },
  { id: 'browser.tab_groups.close', label: 'Close tab group' },
  { id: 'filesystem.write', label: 'Write workspace file' },
  { id: 'filesystem.edit', label: 'Edit workspace file' },
  { id: 'filesystem.bash', label: 'Run workspace command' },
  { id: 'browser.upload', label: 'Upload local file to page' },
  { id: 'browser.download', label: 'Download file from page' },
] as const

export type ActionPolicyId = (typeof ACTION_POLICY_CATALOG)[number]['id']
const catalogIds = new Set<string>(ACTION_POLICY_CATALOG.map(({ id }) => id))
const MAX_EXPIRY_MS = 366 * 24 * 60 * 60 * 1000

export interface ActionPolicyRuleView {
  id: ActionPolicyId
  label: string
  decision: PolicyDecision
  expiresAt: number | null
}

export function isActionPolicyId(value: string): value is ActionPolicyId {
  return catalogIds.has(value)
}

export function validateActionPolicyInput(
  value: unknown,
): { decision: PolicyDecision; expiresAt: number | null } | null {
  if (!isRecord(value)) return null
  const keys = Object.keys(value)
  if (
    keys.length !== 2 ||
    !keys.includes('decision') ||
    !keys.includes('expiresAt')
  ) {
    return null
  }
  if (!['allow', 'ask', 'deny'].includes(String(value.decision))) return null
  const expiresAt = value.expiresAt
  if (
    expiresAt !== null &&
    (typeof expiresAt !== 'number' ||
      !Number.isSafeInteger(expiresAt) ||
      expiresAt <= Date.now() ||
      expiresAt > Date.now() + MAX_EXPIRY_MS)
  ) {
    return null
  }
  return { decision: value.decision as PolicyDecision, expiresAt }
}

export class DbActionPolicyStore {
  constructor(private readonly db?: BrowserOsDatabase) {}

  private get database(): BrowserOsDatabase {
    return this.db ?? getDb()
  }

  async list(): Promise<ActionPolicyRuleView[]> {
    const now = Date.now()
    const rows = await this.database
      .select()
      .from(actionPolicyRules)
      .where(
        or(
          isNull(actionPolicyRules.expiresAt),
          gt(actionPolicyRules.expiresAt, now),
        ),
      )
    const byId = new Map(rows.map((row) => [row.actionId, row]))
    return ACTION_POLICY_CATALOG.map(({ id, label }) => {
      const row = byId.get(id)
      return {
        id,
        label,
        decision: row?.decision ?? 'ask',
        expiresAt: row?.expiresAt ?? null,
      }
    })
  }

  async getDecision(id: ActionPolicyId): Promise<PolicyDecision | null> {
    const now = Date.now()
    const [row] = await this.database
      .select({ decision: actionPolicyRules.decision })
      .from(actionPolicyRules)
      .where(
        and(
          eq(actionPolicyRules.actionId, id),
          or(
            isNull(actionPolicyRules.expiresAt),
            gt(actionPolicyRules.expiresAt, now),
          ),
        ),
      )
      .limit(1)
    return row?.decision ?? null
  }

  async put(
    id: ActionPolicyId,
    input: { decision: PolicyDecision; expiresAt: number | null },
  ) {
    await this.database
      .insert(actionPolicyRules)
      .values({ ...input, actionId: id, updatedAt: Date.now() })
      .onConflictDoUpdate({
        target: actionPolicyRules.actionId,
        set: { ...input, updatedAt: Date.now() },
      })
    const catalogItem = ACTION_POLICY_CATALOG.find((item) => item.id === id)
    if (!catalogItem) throw new Error(`Unknown action policy ID: ${id}`)
    return { ...catalogItem, ...input }
  }

  async delete(id: ActionPolicyId): Promise<void> {
    await this.database
      .delete(actionPolicyRules)
      .where(eq(actionPolicyRules.actionId, id))
  }
}

/** Existing safe classifier remains authoritative; only known guarded operations are configurable. */
export async function decideActionPolicy(candidate: ToolApprovalCandidate) {
  const base = decideToolApproval(candidate)
  if (!base.required)
    return { decision: 'allow' as const, actionId: null, reason: undefined }
  const actionId = actionPolicyIdForCandidate(candidate)
  if (!actionId)
    return { decision: 'ask' as const, actionId: null, reason: base.reason }
  const configured = await new DbActionPolicyStore().getDecision(actionId)
  return { decision: configured ?? 'ask', actionId, reason: base.reason }
}

/** Maps only the exact server-owned tool and validated action to a persisted rule ID. */
export function actionPolicyIdForCandidate(
  candidate: ToolApprovalCandidate,
): ActionPolicyId | null {
  return classifyGuardedAction(candidate)
}

/** Rechecks a pending approval from server-held tool data before accepting it. */
export async function enforceCurrentActionPolicyOnApproval(
  messages: UIMessage[],
  response: { id: string; approved: boolean; reason?: string },
  evaluatePolicy: (candidate: ToolApprovalCandidate) => Promise<{
    decision: PolicyDecision
    actionId: ActionPolicyId | null
  }>,
): Promise<{ id: string; approved: boolean; reason?: string }> {
  if (!response.approved) return response
  const candidate = findPendingCandidate(messages, response.id)
  if (!candidate) return response
  const actionId = actionPolicyIdForCandidate(candidate)
  if (!actionId) return response
  const current = await evaluatePolicy(candidate)
  if (current.actionId !== actionId || current.decision === 'deny') {
    return {
      ...response,
      approved: false,
      reason: 'Blocked by the current saved action policy.',
    }
  }
  return response
}

function findPendingCandidate(
  messages: UIMessage[],
  approvalId: string,
): ToolApprovalCandidate | null {
  for (
    let messageIndex = messages.length - 1;
    messageIndex >= 0;
    messageIndex--
  ) {
    const message = messages[messageIndex]
    if (message.role !== 'assistant') continue
    for (
      let partIndex = message.parts.length - 1;
      partIndex >= 0;
      partIndex--
    ) {
      const part = message.parts[partIndex] as {
        type?: string
        state?: string
        toolName?: string
        input?: unknown
        approval?: { id?: string }
      }
      if (
        part.state !== 'approval-requested' ||
        part.approval?.id !== approvalId
      )
        continue
      return {
        toolName:
          part.type === 'dynamic-tool'
            ? (part.toolName ?? 'tool')
            : (part.type?.replace(/^tool-/, '') ?? 'tool'),
        input: part.input,
      }
    }
  }
  return null
}

function classifyGuardedAction(
  candidate: ToolApprovalCandidate,
): ActionPolicyId | null {
  const name = candidate.toolName.toLowerCase()
  const input = isRecord(candidate.input) ? candidate.input : {}
  const action = input.action
  if (name === 'act' && typeof input.kind === 'string')
    return knownId(`browser.act.${input.kind}`)
  if (name === 'run') return 'browser.run'
  if (name === 'evaluate') return 'browser.evaluate'
  if (name === 'tabs' && ['new', 'close'].includes(String(action)))
    return knownId(`browser.tabs.${action}`)
  if (
    name === 'windows' &&
    ['create', 'close', 'activate'].includes(String(action))
  )
    return knownId(`browser.windows.${action}`)
  if (
    name === 'tab_groups' &&
    ['create', 'update', 'ungroup', 'close'].includes(String(action))
  )
    return knownId(`browser.tab_groups.${action}`)
  if (name === 'filesystem_write') return 'filesystem.write'
  if (name === 'filesystem_edit') return 'filesystem.edit'
  if (name === 'filesystem_bash') return 'filesystem.bash'
  if (name === 'upload') return 'browser.upload'
  if (name === 'download') return 'browser.download'
  return null
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function knownId(value: string): ActionPolicyId | null {
  return isActionPolicyId(value) ? value : null
}
