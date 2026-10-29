/**
 * @license
 * Copyright 2025 BrowserOS
 * SPDX-License-Identifier: AGPL-3.0-or-later
 */
import { createHash } from 'node:crypto'
import { getDbHandle } from '../db'

const TOMBSTONE_TTL_MS = 30 * 24 * 60 * 60 * 1000
const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i

/**
 * Atomically claims a provider tool call for one task. The database stores only
 * a SHA-256 digest of the scoped identifiers and a bounded replay expiry.
 */
export function claimToolExecution(
  taskId: string,
  toolCallId: string,
  at = Date.now(),
): boolean {
  if (!UUID_RE.test(taskId)) throw new TypeError('taskId must be a UUID')
  if (!toolCallId || !Number.isFinite(at)) {
    throw new TypeError('toolCallId and a finite timestamp are required')
  }

  // Length framing prevents ambiguous concatenations while keeping source IDs out of storage.
  const key = createHash('sha256')
    .update(`${taskId.length}:${taskId}${toolCallId.length}:${toolCallId}`)
    .digest('hex')
  const sqlite = getDbHandle().sqlite

  // The unique insert arbitrates concurrent claims; expiry cleanup is safe
  // outside the insert because a live row is never deleted by this predicate.
  sqlite
    .prepare('DELETE FROM tool_operation_claims WHERE expires_at <= ?')
    .run(at)
  const result = sqlite
    .prepare(
      'INSERT INTO tool_operation_claims (claim_key, expires_at) VALUES (?, ?) ON CONFLICT(claim_key) DO NOTHING',
    )
    .run(key, at + TOMBSTONE_TTL_MS)
  return result.changes === 1
}
