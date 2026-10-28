import type { ToolSet } from 'ai'

/**
 * Tools exposing the browser's saved credentials do not belong in the LLM tool
 * catalog. Explicit user autofill/passkey flows must stay outside this agent
 * path, so approval cannot accidentally authorize a password dump.
 *
 * This is not a substitute for hardening CDP/DOM tools or hostile page text.
 */
const SECRET_RESOURCE = /(?:passwords?|credentials?|passkeys?|authenticat(?:ion|or)|otp|totp|one.?time.?codes?)/i
const EXPOSE_ACTION = /(?:read|list|retrieve|get|fetch|export|dump|copy|reveal|show|extract|decrypt|autofill|fill)/i

export function isCredentialAccessTool(
  name: string,
  description = '',
): boolean {
  const normalized = name.replace(/[_-]+/g, ' ')
  return (
    (SECRET_RESOURCE.test(normalized) && EXPOSE_ACTION.test(normalized)) ||
    (SECRET_RESOURCE.test(description) && EXPOSE_ACTION.test(description))
  )
}

export function excludeCredentialAccessTools(
  tools: ToolSet,
): { allowed: ToolSet; blocked: string[] } {
  const allowed: ToolSet = {}
  const blocked: string[] = []
  for (const [name, tool] of Object.entries(tools)) {
    if (isCredentialAccessTool(name, tool.description ?? '')) blocked.push(name)
    else allowed[name] = tool
  }
  return { allowed, blocked }
}
