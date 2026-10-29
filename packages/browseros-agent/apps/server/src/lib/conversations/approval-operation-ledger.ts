/**
 * @license
 * Copyright 2025 BrowserOS
 * SPDX-License-Identifier: AGPL-3.0-or-later
 */
import { createHash, randomUUID } from 'node:crypto'
import { getDbHandle } from '../db'

const GRANT_TTL_MS = 10 * 60 * 1000
const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i

export interface ApprovalOperationBinding {
  taskId: string
  approvalId: string
  toolCallId: string
  toolName: string
  actionId: string
  input: unknown
}

function framedHash(...parts: string[]): string {
  const hash = createHash('sha256')
  for (const part of parts)
    hash.update(`${Buffer.byteLength(part, 'utf8')}:${part}`)
  return hash.digest('hex')
}

function canonical(value: unknown): string {
  if (value === null || typeof value === 'string' || typeof value === 'boolean')
    return JSON.stringify(value)
  if (typeof value === 'number' && Number.isFinite(value))
    return JSON.stringify(value)
  if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`
  if (typeof value === 'object' && value !== null) {
    const entries = Object.entries(value as Record<string, unknown>).sort(
      ([a], [b]) => a.localeCompare(b),
    )
    return `{${entries.map(([key, item]) => `${JSON.stringify(key)}:${canonical(item)}`).join(',')}}`
  }
  throw new TypeError('Approval input must be canonical JSON data')
}

function bindingHashes(binding: ApprovalOperationBinding) {
  if (
    !UUID_RE.test(binding.taskId) ||
    !binding.approvalId ||
    !binding.toolCallId ||
    !binding.toolName ||
    !binding.actionId
  ) {
    throw new TypeError('Complete server approval binding is required')
  }
  return {
    taskHash: framedHash('task', binding.taskId),
    approvalHash: framedHash('approval', binding.approvalId),
    toolCallHash: framedHash('tool-call', binding.toolCallId),
    classificationHash: framedHash(
      'classification',
      binding.toolName,
      binding.actionId,
    ),
    inputHash: framedHash('input-v1', canonical(binding.input)),
  }
}

/** Stores only framed digests; callers must supply server-held pending approval data. */
export function issueApprovalOperation(
  binding: ApprovalOperationBinding,
  at = Date.now(),
): string {
  if (!Number.isSafeInteger(at))
    throw new TypeError('Finite timestamp required')
  const hashes = bindingHashes(binding)
  const operationId = randomUUID()
  const operationHash = framedHash('operation', operationId)
  const db = getDbHandle().sqlite
  db.prepare('DELETE FROM approval_operation_grants WHERE expires_at <= ?').run(
    at,
  )
  const result = db
    .prepare(`INSERT INTO approval_operation_grants
    (operation_hash, task_hash, approval_hash, tool_call_hash, classification_hash, input_hash, expires_at, consumed_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, NULL)`)
    .run(
      operationHash,
      hashes.taskHash,
      hashes.approvalHash,
      hashes.toolCallHash,
      hashes.classificationHash,
      hashes.inputHash,
      at + GRANT_TTL_MS,
    )
  if (result.changes !== 1)
    throw new Error('Unable to persist approval operation')
  return operationId
}

/** One atomic conditional update arbitrates replay, expiry and any binding mismatch. */
export function consumeApprovalOperation(
  binding: ApprovalOperationBinding,
  at = Date.now(),
): boolean {
  if (!Number.isSafeInteger(at)) return false
  let hashes: ReturnType<typeof bindingHashes>
  try {
    hashes = bindingHashes(binding)
  } catch {
    return false
  }
  const result = getDbHandle()
    .sqlite.prepare(`UPDATE approval_operation_grants SET consumed_at = ?
    WHERE task_hash = ? AND approval_hash = ? AND tool_call_hash = ? AND classification_hash = ? AND input_hash = ?
      AND consumed_at IS NULL AND expires_at > ?`)
    .run(
      at,
      hashes.taskHash,
      hashes.approvalHash,
      hashes.toolCallHash,
      hashes.classificationHash,
      hashes.inputHash,
      at,
    )
  return result.changes === 1
}
