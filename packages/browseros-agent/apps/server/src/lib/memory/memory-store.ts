/**
 * @license
 * Copyright 2025 BrowserOS
 * SPDX-License-Identifier: AGPL-3.0-or-later
 */

import { chmodSync, mkdirSync, renameSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { getDbHandle } from '../db'

const MAX_CONTENT_CHARS = 20_000
const MAX_SEARCH_CHARS = 300
const RETENTION_OPTIONS = [30, 90, null] as const

export interface MemoryEntry {
  id: string
  content: string
  source: 'user'
  sourceUrl: string | null
  createdAt: number
  updatedAt: number
  expiresAt: number | null
}

export interface MemorySettings {
  enabled: boolean
  retentionDays: 30 | 90 | null
  updatedAt: number
}

interface MemoryRow {
  id: string
  content: string
  source: string
  source_url: string | null
  created_at: number
  updated_at: number
  expires_at: number | null
}

function mapRow(row: MemoryRow): MemoryEntry {
  return {
    id: row.id,
    content: row.content,
    source: 'user',
    sourceUrl: row.source_url,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    expiresAt: row.expires_at,
  }
}

function getSettingsRow(): MemorySettings {
  const sqlite = getDbHandle().sqlite
  const now = Date.now()
  sqlite
    .prepare(
      `INSERT OR IGNORE INTO memory_settings (id, enabled, retention_days, updated_at) VALUES (1, 0, 90, ?)`,
    )
    .run(now)
  const row = sqlite
    .query<
      { enabled: number; retention_days: number | null; updated_at: number },
      []
    >(
      'SELECT enabled, retention_days, updated_at FROM memory_settings WHERE id = 1',
    )
    .get()
  if (!row) throw new Error('Memory settings are unavailable')
  const retentionDays = RETENTION_OPTIONS.includes(
    row.retention_days as (typeof RETENTION_OPTIONS)[number],
  )
    ? (row.retention_days as (typeof RETENTION_OPTIONS)[number])
    : 90
  return {
    enabled: row.enabled === 1,
    retentionDays,
    updatedAt: row.updated_at,
  }
}

function mirrorPath(): string {
  return join(dirname(getDbHandle().path), 'memory', 'MEMORY.md')
}

function writeMarkdownMirror(): void {
  const entries = getDbHandle()
    .sqlite.query<MemoryRow, []>(
      'SELECT id, content, source, source_url, created_at, updated_at, expires_at FROM memories ORDER BY updated_at DESC',
    )
    .all()
  const path = mirrorPath()
  mkdirSync(dirname(path), { recursive: true, mode: 0o700 })
  chmodSync(dirname(path), 0o700)
  const body = [
    '# Aster Memory',
    '',
    '<!-- Generated from the local Aster memory database. Edit in Aster settings. -->',
    '',
    ...entries.flatMap((entry) => [
      `## ${entry.id}`,
      '',
      entry.content,
      '',
      entry.source_url ? `Source: <${entry.source_url}>` : 'Source: user',
      `Updated: ${new Date(entry.updated_at).toISOString()}`,
      '',
    ]),
  ].join('\n')
  const temporaryPath = `${path}.tmp-${crypto.randomUUID()}`
  writeFileSync(temporaryPath, body, { mode: 0o600 })
  renameSync(temporaryPath, path)
}

function calculateExpiry(createdAt: number, retentionDays: number | null) {
  return retentionDays === null
    ? null
    : createdAt + retentionDays * 24 * 60 * 60 * 1000
}

function pruneExpired(now = Date.now()): void {
  const result = getDbHandle()
    .sqlite.prepare(
      'DELETE FROM memories WHERE expires_at IS NOT NULL AND expires_at <= ?',
    )
    .run(now)
  if (result.changes > 0) writeMarkdownMirror()
}

export class DbMemoryStore {
  list(): { settings: MemorySettings; memories: MemoryEntry[] } {
    pruneExpired()
    const rows = getDbHandle()
      .sqlite.query<MemoryRow, []>(
        'SELECT id, content, source, source_url, created_at, updated_at, expires_at FROM memories ORDER BY updated_at DESC',
      )
      .all()
    return { settings: getSettingsRow(), memories: rows.map(mapRow) }
  }

  settings(): MemorySettings {
    pruneExpired()
    return getSettingsRow()
  }

  updateSettings(input: {
    enabled: boolean
    retentionDays: 30 | 90 | null
  }): MemorySettings {
    const now = Date.now()
    const sqlite = getDbHandle().sqlite
    sqlite
      .prepare(
        `INSERT INTO memory_settings (id, enabled, retention_days, updated_at)
         VALUES (1, ?, ?, ?)
         ON CONFLICT(id) DO UPDATE SET enabled = excluded.enabled, retention_days = excluded.retention_days, updated_at = excluded.updated_at`,
      )
      .run(input.enabled ? 1 : 0, input.retentionDays, now)
    if (input.retentionDays !== null) {
      sqlite
        .prepare('UPDATE memories SET expires_at = created_at + ? * 86400000')
        .run(input.retentionDays)
    } else {
      sqlite.prepare('UPDATE memories SET expires_at = NULL').run()
    }
    pruneExpired(now)
    writeMarkdownMirror()
    return getSettingsRow()
  }

  save(input: {
    id?: string
    content: string
    sourceUrl?: string | null
  }): MemoryEntry {
    const content = input.content.trim()
    if (!content) throw new Error('Memory content is required')
    if (content.length > MAX_CONTENT_CHARS)
      throw new Error('Memory is too long')
    if (
      /\b(password|passwd|api[_ -]?key|secret[_ -]?key|access[_ -]?token)\s*[:=]/i.test(
        content,
      ) ||
      /\bBearer\s+[A-Za-z0-9._~+/-]{20,}/i.test(content) ||
      /\b(?:AKIA[0-9A-Z]{16}|sk-[A-Za-z0-9_-]{24,}|gh[pousr]_[A-Za-z0-9]{30,})\b/.test(
        content,
      )
    ) {
      throw new Error(
        'This note looks like it contains a credential. Remove the secret before saving.',
      )
    }
    const sourceUrl = input.sourceUrl?.trim() || null
    if (sourceUrl) {
      const parsed = new URL(sourceUrl)
      if (
        !['http:', 'https:'].includes(parsed.protocol) ||
        parsed.username ||
        parsed.password ||
        [...parsed.searchParams.keys()].some((key) =>
          /token|key|secret|password|auth|signature/i.test(key),
        )
      ) {
        throw new Error(
          'Source URL must be a credential-free HTTP or HTTPS URL',
        )
      }
    }
    const now = Date.now()
    const settings = getSettingsRow()
    const id = input.id ?? crypto.randomUUID()
    const existing = input.id
      ? getDbHandle()
          .sqlite.query<{ created_at: number }, [string]>(
            'SELECT created_at FROM memories WHERE id = ?',
          )
          .get(input.id)
      : null
    const createdAt = existing?.created_at ?? now
    getDbHandle()
      .sqlite.prepare(
        `INSERT INTO memories (id, content, source, source_url, created_at, updated_at, expires_at)
         VALUES (?, ?, 'user', ?, ?, ?, ?)
         ON CONFLICT(id) DO UPDATE SET content = excluded.content, source_url = excluded.source_url, updated_at = excluded.updated_at, expires_at = excluded.expires_at`,
      )
      .run(
        id,
        content,
        sourceUrl,
        createdAt,
        now,
        calculateExpiry(createdAt, settings.retentionDays),
      )
    writeMarkdownMirror()
    const row = getDbHandle()
      .sqlite.query<MemoryRow, [string]>(
        'SELECT id, content, source, source_url, created_at, updated_at, expires_at FROM memories WHERE id = ?',
      )
      .get(id)
    if (!row) throw new Error('Memory could not be saved')
    return mapRow(row)
  }

  remove(id: string): boolean {
    const result = getDbHandle()
      .sqlite.prepare('DELETE FROM memories WHERE id = ?')
      .run(id)
    if (result.changes > 0) writeMarkdownMirror()
    return result.changes > 0
  }

  search(query: string, limit = 8): MemoryEntry[] {
    pruneExpired()
    if (!getSettingsRow().enabled) return []
    const terms = query
      .slice(0, MAX_SEARCH_CHARS)
      .match(/[\p{L}\p{N}_-]+/gu)
      ?.slice(0, 12)
    if (!terms?.length) return []
    const ftsQuery = terms
      .map((term) => `"${term.replaceAll('"', '""')}"*`)
      .join(' AND ')
    const rows = getDbHandle()
      .sqlite.query<MemoryRow, [string, number]>(
        `SELECT m.id, m.content, m.source, m.source_url, m.created_at, m.updated_at, m.expires_at
         FROM memories_fts f JOIN memories m ON m.id = f.memory_id
         WHERE memories_fts MATCH ? AND (m.expires_at IS NULL OR m.expires_at > ?)
         ORDER BY bm25(memories_fts), m.updated_at DESC LIMIT ${Math.max(1, Math.min(20, limit))}`,
      )
      .all(ftsQuery, Date.now())
    return rows.map(mapRow)
  }
}

export const dbMemoryStore = new DbMemoryStore()
