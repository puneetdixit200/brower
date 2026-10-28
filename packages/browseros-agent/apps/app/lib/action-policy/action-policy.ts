export const ACTION_POLICY_IDS = [
  'browser.act.click',
  'browser.act.click_at',
  'browser.act.type',
  'browser.act.type_at',
  'browser.act.fill',
  'browser.act.press',
  'browser.act.hover',
  'browser.act.hover_at',
  'browser.act.focus',
  'browser.act.check',
  'browser.act.uncheck',
  'browser.act.select',
  'browser.act.scroll',
  'browser.act.drag',
  'browser.act.drag_at',
  'browser.run',
  'browser.evaluate',
  'browser.tabs.new',
  'browser.tabs.close',
  'browser.windows.create',
  'browser.windows.close',
  'browser.windows.activate',
  'browser.tab_groups.create',
  'browser.tab_groups.update',
  'browser.tab_groups.ungroup',
  'browser.tab_groups.close',
  'filesystem.write',
  'filesystem.edit',
  'filesystem.bash',
  'browser.upload',
  'browser.download',
] as const

const actionPolicyIdSet = new Set<string>(ACTION_POLICY_IDS)

export type ActionDecision = 'allow' | 'ask' | 'deny'

export interface ActionPolicy {
  id: (typeof ACTION_POLICY_IDS)[number]
  label: string
  decision: ActionDecision
  expiresAt: number | null
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

export function parseActionPolicyAction(value: unknown): ActionPolicy {
  if (!isRecord(value))
    throw new Error('The policy service returned an invalid action')
  const { id, label, decision, expiresAt } = value
  if (typeof id !== 'string' || !actionPolicyIdSet.has(id))
    throw new Error('The policy service returned an unknown action ID')
  if (typeof label !== 'string' || !label.trim() || label.length > 120)
    throw new Error('The policy service returned an invalid action label')
  if (decision !== 'allow' && decision !== 'ask' && decision !== 'deny')
    throw new Error('The policy service returned an invalid decision')
  if (
    expiresAt !== null &&
    (typeof expiresAt !== 'number' ||
      !Number.isSafeInteger(expiresAt) ||
      expiresAt <= 0)
  )
    throw new Error('The policy service returned an invalid expiration')
  return { id: id as ActionPolicy['id'], label, decision, expiresAt }
}

export function parseActionPolicyList(value: unknown): ActionPolicy[] {
  if (!isRecord(value) || !Array.isArray(value.actions))
    throw new Error('The policy service returned an invalid action list')
  const actions = value.actions.map(parseActionPolicyAction)
  const ids = new Set(actions.map((action) => action.id))
  if (ids.size !== actions.length)
    throw new Error('The policy service returned duplicate action IDs')
  if (actions.length !== ACTION_POLICY_IDS.length)
    throw new Error('The policy service returned an incomplete action catalog')
  return actions
}

export function normalizeExpiredActionPolicy(
  action: ActionPolicy,
  now = Date.now(),
): ActionPolicy {
  if (action.expiresAt === null || action.expiresAt > now) return action
  return { ...action, decision: 'ask', expiresAt: null }
}

export function parseUpdatedActionPolicy(
  value: unknown,
  expectedId: string,
): ActionPolicy {
  if (!isRecord(value) || !actionPolicyIdSet.has(expectedId))
    throw new Error('The policy service returned an invalid update')
  const action = parseActionPolicyAction(value.action)
  if (action.id !== expectedId)
    throw new Error(
      'The policy service returned a different action than requested',
    )
  return action
}

export async function readActionPolicyResponse(
  response: Response,
): Promise<unknown> {
  let body: unknown
  try {
    body = await response.json()
  } catch {
    throw new Error('The policy service returned an invalid response')
  }
  if (!response.ok) {
    const message =
      isRecord(body) && typeof body.error === 'string' ? body.error : null
    throw new Error(message ?? `Policy request failed (${response.status})`)
  }
  return body
}
