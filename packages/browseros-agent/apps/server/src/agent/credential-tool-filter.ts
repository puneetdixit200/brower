import type { ToolSet } from 'ai'

/**
 * Tools exposing the browser's saved credentials do not belong in the LLM tool
 * catalog. Explicit user autofill/passkey flows must stay outside this agent
 * path, so approval cannot accidentally authorize a password dump.
 *
 * These metadata heuristics cannot prove complete prevention: a tool with
 * deceptive metadata can still expose secrets. They are not a substitute for
 * hardening CDP/DOM tools or hostile page text.
 */
const SECRET_RESOURCE =
  /(?:passwords?|credentials?|passkeys?|passphrases?|authenticat(?:ion|or)|otp|totp|one.?time.?codes?|(?:recovery|backup)\s*codes?|login\s*details?|vault\s*entries|access\s*tokens?|session\s*tokens?|refresh\s*tokens?|bearer\s*tokens?|api\s*tokens?|api\s*keys?|private\s*keys?|client\s*secrets?|security\s+questions?(?:\s+(?:answers?|responses?))?|question\s+(?:answers?|responses?)|pins?|pin\s*codes?|tokens?|cookies?|secrets?)/i
const EXPOSE_ACTION =
  /\b(?:read|list|retrieve|get|fetch|export|dump|copy|reveal|show|extract|decrypt|autofill|fill|view|inspect|display)\w*/i
// Descriptions are matched on both an access verb and a sensitive resource.
// This keeps standalone warnings about those resources available in the catalog.
const SECRET_EXPORT_ACTION =
  /(?:read|retrieve|list|enumerate|search|access|return|export|reveal|dump|decrypt|autofill|fill|fetch|obtain|query|show|extract|copy|view|inspect)\w*/i
const EXPLICIT_SECRET_EXPORT = new RegExp(
  `(?=.*\\b${SECRET_EXPORT_ACTION.source}\\b)(?=.*\\b${SECRET_RESOURCE.source}\\b)`,
  'i',
)
// Unlike generic verbs, “display” is matched only when its direct object is a
// credential resource. This preserves safe warning/help tools such as
// “Display a warning about saved-password security.”
const DISPLAY_SECRET_EXPORT = new RegExp(
  `\\bdisplay\\w*\\s+(?:(?:the|saved|stored|account|browser)\\s+)*${SECRET_RESOURCE.source}\\b`,
  'i',
)

// These internal browser tools execute caller-supplied JavaScript in a page or
// expose raw CDP. Keep them out of the model catalog even if their descriptions
// change; standalone MCP clients retain the registered tools.
const RAW_PAGE_CODE_TOOLS = new Set(['run', 'evaluate'])

export function isCredentialAccessTool(
  name: string,
  description = '',
): boolean {
  const normalized = name.replace(/[_-]+/g, ' ')
  return (
    (SECRET_RESOURCE.test(normalized) && EXPOSE_ACTION.test(normalized)) ||
    EXPLICIT_SECRET_EXPORT.test(description) ||
    DISPLAY_SECRET_EXPORT.test(description)
  )
}

export function excludeRawPageCodeTools(internalBrowserTools: ToolSet): {
  allowed: ToolSet
  blocked: string[]
} {
  const allowed: ToolSet = {}
  const blocked: string[] = []
  for (const [name, tool] of Object.entries(internalBrowserTools)) {
    if (RAW_PAGE_CODE_TOOLS.has(name)) blocked.push(name)
    else allowed[name] = tool
  }
  return { allowed, blocked }
}

export function excludeCredentialAccessTools(candidateTools: ToolSet): {
  allowed: ToolSet
  blocked: string[]
} {
  const allowed: ToolSet = {}
  const blocked: string[] = []
  for (const [name, tool] of Object.entries(candidateTools)) {
    if (
      isCredentialAccessTool(
        name,
        typeof tool.description === 'string' ? tool.description : '',
      )
    ) {
      blocked.push(name)
    } else {
      allowed[name] = tool
    }
  }
  return { allowed, blocked }
}

/** Final catalog gate used immediately before constructing the model agent. */
export function buildAgentToolCatalog(candidateTools: ToolSet): {
  tools: ToolSet
  blocked: string[]
} {
  const { allowed, blocked } = excludeCredentialAccessTools(candidateTools)
  return { tools: allowed, blocked }
}
