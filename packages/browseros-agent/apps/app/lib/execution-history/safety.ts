/**
 * Heuristic credential detector shared by persistence and history display boundaries.
 * Recognized token formats reduce accidental exposure; this cannot identify every
 * secret and must not be treated as a substitute for secret handling controls.
 */
export function containsCredentialShapedText(value: string): boolean {
  return (
    /-----BEGIN (?:(?:RSA |EC |OPENSSH |DSA )?PRIVATE KEY|ENCRYPTED PRIVATE KEY)-----/.test(
      value,
    ) ||
    /\b(password|passwd|api[_ -]?key|secret[_ -]?key|access[_ -]?token)\s*[:=]/i.test(
      value,
    ) ||
    /\bBearer\s+[A-Za-z0-9._~+/-]{20,}/i.test(value) ||
    /\beyJ[A-Za-z0-9_-]{5,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\b/.test(
      value,
    ) ||
    /\bxox(?:b|p|a|r|s)-[A-Za-z0-9-]{20,}\b/.test(value) ||
    /\bxapp-[A-Za-z0-9-]{20,}\b/.test(value) ||
    /\bgithub_pat_[A-Za-z0-9_-]{50,}\b/.test(value) ||
    // Google API keys and npm automation tokens have stable, distinctive prefixes.
    /\bAIza[0-9A-Za-z_-]{35}\b/.test(value) ||
    /\bnpm_[A-Za-z0-9]{36}\b/.test(value) ||
    // Stripe secret/restricted keys; public `pk_` keys are intentionally excluded.
    /\bsk_(?:live|test)_[A-Za-z0-9]{20,}\b/.test(value) ||
    /\brk_(?:live|test)_[A-Za-z0-9]{20,}\b/.test(value) ||
    // SendGrid API keys use three dot-separated components after the SG prefix.
    /\bSG\.[A-Za-z0-9_-]{20,}\.[A-Za-z0-9_-]{20,}\b/.test(value) ||
    /\b(?:AKIA[0-9A-Z]{16}|sk-[A-Za-z0-9_-]{24,}|gh[pousr]_[A-Za-z0-9]{30,})\b/.test(
      value,
    )
  )
}
