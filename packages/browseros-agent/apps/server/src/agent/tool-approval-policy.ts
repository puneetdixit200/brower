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
  /\b(send|submit|post|purchase|payment|pay|transfer|delete|remove|write|upload|publish|share|shell|command|execute)\b/i

/** Fail closed for ambiguous, code-execution and external-side-effect tools. */
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

  if (
    lowerName.startsWith('filesystem_write') ||
    lowerName.startsWith('filesystem_delete') ||
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

  return { required: false }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null
}
