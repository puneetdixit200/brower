/**
 * @license
 * Copyright 2025 BrowserOS
 * SPDX-License-Identifier: AGPL-3.0-or-later
 */

import {
  chmodSync,
  existsSync,
  mkdirSync,
  readFileSync,
  renameSync,
  writeFileSync,
} from 'node:fs'
import { dirname, join } from 'node:path'
import { getDbHandle } from '../db'

const MAX_CONTENT_CHARS = 20_000
const MAX_SEARCH_CHARS = 300
const RETENTION_OPTIONS = [30, 90, null] as const

export interface MemoryEntry {
  id: string
  content: string
  source: 'user' | 'task'
  sourceUrl: string | null
  sourceId: string | null
  sourceTitle: string | null
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
  source_id: string | null
  source_title: string | null
  created_at: number
  updated_at: number
  expires_at: number | null
}

function mapRow(row: MemoryRow): MemoryEntry {
  return {
    id: row.id,
    content: row.content,
    source: row.source === 'task' ? 'task' : 'user',
    sourceUrl: row.source_url,
    sourceId: row.source_id,
    sourceTitle: row.source_title,
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

function renderMarkdownMirror(entries: MemoryRow[]): string {
  return [
    '# Aster Memory',
    '',
    '<!-- Generated from the local Aster memory database. Edit note content below each ID. -->',
    '',
    ...entries.flatMap((entry) => [
      `## ${entry.id}`,
      '',
      entry.content,
      '',
      entry.source === 'task'
        ? taskSourceMetadata(entry)
        : entry.source_url
          ? `Source: <${entry.source_url}>`
          : 'Source: user',
      `Updated: ${new Date(entry.updated_at).toISOString()}`,
      '',
    ]),
  ].join('\n')
}

function taskSourceMetadata(entry: MemoryRow): string {
  const title = (entry.source_title ?? 'Completed task').replaceAll(/\s+/g, ' ')
  return `Source task: ${title} (ID: ${entry.source_id ?? 'unknown'})`
}

function legacyTaskSourceMetadata(entry: MemoryRow): string {
  return `Source task: ${(entry.source_title ?? entry.source_id ?? 'Completed task').replaceAll(/\s+/g, ' ')}`
}

function readMemoryRows(): MemoryRow[] {
  return getDbHandle()
    .sqlite.query<MemoryRow, []>(
      'SELECT id, content, source, source_url, source_id, source_title, created_at, updated_at, expires_at FROM memories ORDER BY updated_at DESC',
    )
    .all()
}

function writeMarkdownMirror(): void {
  const entries = readMemoryRows()
  const path = mirrorPath()
  mkdirSync(dirname(path), { recursive: true, mode: 0o700 })
  chmodSync(dirname(path), 0o700)
  const body = renderMarkdownMirror(entries)
  const temporaryPath = `${path}.tmp-${crypto.randomUUID()}`
  writeFileSync(temporaryPath, body, { mode: 0o600 })
  renameSync(temporaryPath, path)
}

function calculateExpiry(createdAt: number, retentionDays: number | null) {
  return retentionDays === null
    ? null
    : createdAt + retentionDays * 24 * 60 * 60 * 1000
}

function containsCredentialShapedText(value: string): boolean {
  return (
    /\b(password|passwd|api[_ -]?key|secret[_ -]?key|access[_ -]?token)\s*[:=]/i.test(
      value,
    ) ||
    /\bBearer\s+[A-Za-z0-9._~+/-]{20,}/i.test(value) ||
    /\b(?:AKIA[0-9A-Z]{16}|sk-[A-Za-z0-9_-]{24,}|gh[pousr]_[A-Za-z0-9]{30,})\b/.test(
      value,
    )
  )
}

function expectedSourceMetadata(entry: MemoryRow): string {
  if (entry.source === 'task') {
    return taskSourceMetadata(entry)
  }
  return entry.source_url ? `Source: <${entry.source_url}>` : 'Source: user'
}

function extractEditedContent(section: string, entry: MemoryRow): string {
  const sourceLineStart = section.lastIndexOf('\n\nSource:')
  const taskSourceLineStart = section.lastIndexOf('\n\nSource task:')
  const metadataStart = Math.max(sourceLineStart, taskSourceLineStart)
  if (metadataStart < 0) {
    throw new Error(
      `Memory Markdown note ${entry.id} is missing source metadata`,
    )
  }
  const metadata = section.slice(metadataStart + 2).split('\n')
  if (metadata.length !== 2 || !metadata[1]?.startsWith('Updated: ')) {
    throw new Error(`Memory Markdown note ${entry.id} has malformed metadata`)
  }
  const expectedUpdated = `Updated: ${new Date(entry.updated_at).toISOString()}`
  if (
    metadata[0] !== expectedSourceMetadata(entry) &&
    !(
      entry.source === 'task' && metadata[0] === legacyTaskSourceMetadata(entry)
    )
  ) {
    throw new Error(
      `Memory Markdown note ${entry.id} metadata is read-only and was not imported`,
    )
  }
  const body = section.slice(0, metadataStart).replace(/^\n+/, '').trimEnd()
  if (metadata[1] !== expectedUpdated && body !== entry.content) {
    throw new Error(
      `Memory Markdown note ${entry.id} metadata is read-only and was not imported`,
    )
  }
  if (!body.trim()) {
    throw new Error(`Memory Markdown note ${entry.id} has empty content`)
  }
  return body
}

function parseEditedMirror(
  markdown: string,
  entries: MemoryRow[],
): Map<string, string> {
  const normalized = markdown.replaceAll('\r\n', '\n')
  if (!normalized.startsWith('# Aster Memory\n')) {
    throw new Error(
      'Memory Markdown mirror has an invalid header; it was not imported',
    )
  }

  const sections = new Map<string, string>()
  const heading = /^## ([0-9a-f-]{36})\n/gim
  const matches = [...normalized.matchAll(heading)]
  const prefix = normalized.slice(0, matches[0]?.index ?? normalized.length)
  if (
    !prefix.includes('Generated from the local Aster memory database.') ||
    (entries.length > 0 && matches.length === 0)
  ) {
    throw new Error('Memory Markdown mirror is malformed; it was not imported')
  }

  for (let index = 0; index < matches.length; index += 1) {
    const match = matches[index]
    const id = match[1]
    if (!id || sections.has(id) || match.index === undefined) {
      throw new Error(
        'Memory Markdown mirror has duplicate or invalid note IDs',
      )
    }
    const start = match.index + match[0].length
    const end = matches[index + 1]?.index ?? normalized.length
    const entry = entries.find((candidate) => candidate.id === id)
    if (!entry) {
      throw new Error(
        'Memory Markdown note IDs changed; add and delete notes in Aster settings instead',
      )
    }
    const section = normalized.slice(start, end).replace(/\n+$/, '')
    sections.set(id, extractEditedContent(section, entry))
  }

  if (
    sections.size !== entries.length ||
    entries.some((entry) => !sections.has(entry.id))
  ) {
    throw new Error(
      'Memory Markdown note IDs changed; add and delete notes in Aster settings instead',
    )
  }
  return sections
}

/** Imports content-only edits from the Markdown mirror, failing closed on structure or secret-like text. */
function reconcileMarkdownMirror(): void {
  const path = mirrorPath()
  if (!existsSync(path)) {
    writeMarkdownMirror()
    return
  }

  const entries = readMemoryRows()
  const markdown = readFileSync(path, 'utf8')
  const edited = parseEditedMirror(markdown, entries)
  const changes = entries.flatMap((entry) => {
    const content = edited.get(entry.id)?.trim()
    if (content === undefined || content === entry.content) return []
    if (content.length > MAX_CONTENT_CHARS) {
      throw new Error(
        `Memory Markdown note ${entry.id} exceeds the content limit`,
      )
    }
    if (containsCredentialShapedText(content)) {
      throw new Error(
        `Memory Markdown note ${entry.id} looks like it contains a credential; the edit was not imported`,
      )
    }
    return [{ id: entry.id, content }]
  })
  if (changes.length === 0) {
    if (markdown !== renderMarkdownMirror(entries)) writeMarkdownMirror()
    return
  }

  const sqlite = getDbHandle().sqlite
  sqlite.exec('BEGIN IMMEDIATE')
  try {
    const update = sqlite.prepare(
      'UPDATE memories SET content = ?, updated_at = ? WHERE id = ?',
    )
    const now = Date.now()
    for (const change of changes) update.run(change.content, now, change.id)
    sqlite.exec('COMMIT')
  } catch (error) {
    sqlite.exec('ROLLBACK')
    throw error
  }
  writeMarkdownMirror()
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
    reconcileMarkdownMirror()
    pruneExpired()
    const rows = getDbHandle()
      .sqlite.query<MemoryRow, []>(
        'SELECT id, content, source, source_url, source_id, source_title, created_at, updated_at, expires_at FROM memories ORDER BY updated_at DESC',
      )
      .all()
    return { settings: getSettingsRow(), memories: rows.map(mapRow) }
  }

  settings(): MemorySettings {
    reconcileMarkdownMirror()
    pruneExpired()
    return getSettingsRow()
  }

  updateSettings(input: {
    enabled: boolean
    retentionDays: 30 | 90 | null
  }): MemorySettings {
    reconcileMarkdownMirror()
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
    sourceId?: string | null
    sourceTitle?: string | null
  }): MemoryEntry {
    reconcileMarkdownMirror()
    const content = input.content.trim()
    if (!content) throw new Error('Memory content is required')
    if (content.length > MAX_CONTENT_CHARS)
      throw new Error('Memory is too long')
    if (containsCredentialShapedText(content)) {
      throw new Error(
        'This note looks like it contains a credential. Remove the secret before saving.',
      )
    }
    const sourceUrl = input.sourceUrl?.trim() || null
    const sourceId = input.sourceId?.trim() || null
    const sourceTitle = input.sourceTitle?.trim() || null
    if (sourceId && !/^[0-9a-f-]{36}$/i.test(sourceId)) {
      throw new Error('Source task ID is invalid')
    }
    if (sourceTitle && sourceTitle.length > 300) {
      throw new Error('Source task title is too long')
    }
    if (Boolean(sourceId) !== Boolean(sourceTitle)) {
      throw new Error('Task provenance requires both a task ID and title')
    }
    if (sourceTitle && containsCredentialShapedText(sourceTitle)) {
      throw new Error(
        'The source task title looks like it contains a credential. Remove the secret before saving.',
      )
    }
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
          .sqlite.query<
            {
              created_at: number
              source: string
              source_id: string | null
              source_title: string | null
            },
            [string]
          >(
            'SELECT created_at, source, source_id, source_title FROM memories WHERE id = ?',
          )
          .get(input.id)
      : null
    const createdAt = existing?.created_at ?? now
    const savedSourceId = sourceId ?? existing?.source_id ?? null
    const savedSourceTitle = sourceTitle ?? existing?.source_title ?? null
    const source =
      savedSourceId || existing?.source === 'task' ? 'task' : 'user'
    getDbHandle()
      .sqlite.prepare(
        `INSERT INTO memories (id, content, source, source_url, source_id, source_title, created_at, updated_at, expires_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT(id) DO UPDATE SET content = excluded.content, source = excluded.source, source_url = excluded.source_url, source_id = excluded.source_id, source_title = excluded.source_title, updated_at = excluded.updated_at, expires_at = excluded.expires_at`,
      )
      .run(
        id,
        content,
        source,
        sourceUrl,
        savedSourceId,
        savedSourceTitle,
        createdAt,
        now,
        calculateExpiry(createdAt, settings.retentionDays),
      )
    writeMarkdownMirror()
    const row = getDbHandle()
      .sqlite.query<MemoryRow, [string]>(
        'SELECT id, content, source, source_url, source_id, source_title, created_at, updated_at, expires_at FROM memories WHERE id = ?',
      )
      .get(id)
    if (!row) throw new Error('Memory could not be saved')
    return mapRow(row)
  }

  remove(id: string): boolean {
    reconcileMarkdownMirror()
    const result = getDbHandle()
      .sqlite.prepare('DELETE FROM memories WHERE id = ?')
      .run(id)
    if (result.changes > 0) writeMarkdownMirror()
    return result.changes > 0
  }

  search(query: string, limit = 8): MemoryEntry[] {
    reconcileMarkdownMirror()
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
        `SELECT m.id, m.content, m.source, m.source_url, m.source_id, m.source_title, m.created_at, m.updated_at, m.expires_at
         FROM memories_fts f JOIN memories m ON m.id = f.memory_id
         WHERE memories_fts MATCH ? AND (m.expires_at IS NULL OR m.expires_at > ?)
         ORDER BY bm25(memories_fts), m.updated_at DESC LIMIT ${Math.max(1, Math.min(20, limit))}`,
      )
      .all(ftsQuery, Date.now())
    return rows.map(mapRow)
  }
}

export const dbMemoryStore = new DbMemoryStore()
