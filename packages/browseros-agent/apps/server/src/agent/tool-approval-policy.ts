/**
 * Conservative approval defaults for actions that can mutate user data or
 * cause side effects outside the browser. This decision runs server side,
 * after the model proposes a tool call and before its execute function runs.
 */

export interface ToolApprovalCandidate {
  toolName: string
  input: unknown
  description?: string
}

export interface ToolApprovalDecision {
  required: boolean
  reason?: string
}

const EXTERNAL_SIDE_EFFECT =
  /\b(send|submit|post|purchase|payment|pay|transfer|delete|remove|write|upload|publish|share|shell|command|execute|create|edit|update|modify|move|archive|cancel|book|schedule|invite|refund|deploy|commit|push|revoke|grant)\b/i

const READ_ONLY_FILESYSTEM_TOOLS = new Set([
  'filesystem_read',
  'filesystem_ls',
  'filesystem_grep',
  'filesystem_find',
])

const READ_ONLY_BROWSER_TOOLS = new Set([
  'tabs',
  'history',
  'navigate',
  'snapshot',
  'diff',
  'read',
  'grep',
  'screenshot',
  'pdf',
  'wait',
])

const APPROVAL_UI_SENTINEL_TOOLS = new Set([
  'suggest_schedule',
  'suggest_app_connection',
])

/** Ask before mutation, code execution, and tools outside the read-only allowlist. */
export function decideToolApproval(
  candidate: ToolApprovalCandidate,
): ToolApprovalDecision {
  const { toolName } = candidate
  const lowerName = toolName.toLowerCase()

  if (lowerName === 'act') {
    return {
      required: true,
      reason:
        'This browser interaction may submit a form or change data on the site. Review the action before it runs.',
    }
  }

  if (lowerName === 'run' || lowerName === 'evaluate') {
    return {
      required: true,
      reason:
        'This tool executes code in the browser. Review its code and target page before it runs.',
    }
  }

  if (APPROVAL_UI_SENTINEL_TOOLS.has(lowerName)) {
    return { required: false }
  }

  if (lowerName === 'tab_groups' || lowerName === 'windows') {
    const action = isRecord(candidate.input) ? candidate.input.action : 'list'
    if (action === 'list') return { required: false }
    return {
      required: true,
      reason:
        'This changes browser organization or window state. Review the change before it runs.',
    }
  }

  if (
    (lowerName.startsWith('filesystem_') &&
      !READ_ONLY_FILESYSTEM_TOOLS.has(lowerName)) ||
    lowerName === 'upload' ||
    lowerName === 'download'
  ) {
    return {
      required: true,
      reason:
        'This tool writes or transfers a file. Review the path or destination before it runs.',
    }
  }

  if (
    EXTERNAL_SIDE_EFFECT.test(toolName.replace(/[_-]/g, ' ')) ||
    EXTERNAL_SIDE_EFFECT.test(candidate.description ?? '')
  ) {
    return {
      required: true,
      reason:
        'This tool may cause an external or destructive side effect. Review its destination and details before it runs.',
    }
  }

  if (
    lowerName === 'tabs' &&
    isRecord(candidate.input) &&
    candidate.input.action === 'close'
  ) {
    return {
      required: true,
      reason:
        'This closes a browser tab. Review the selected tab before it closes.',
    }
  }

  if (
    READ_ONLY_BROWSER_TOOLS.has(lowerName) ||
    READ_ONLY_FILESYSTEM_TOOLS.has(lowerName)
  ) {
    return { required: false }
  }

  return {
    required: true,
    reason:
      'This tool is not in the read-only allowlist. Review the proposed action before it runs.',
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null
}
