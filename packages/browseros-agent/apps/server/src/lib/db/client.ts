/**
 * @license
 * Copyright 2025 BrowserOS
 * SPDX-License-Identifier: AGPL-3.0-or-later
 */

import { Database as BunDatabase } from 'bun:sqlite'
import { existsSync, mkdirSync, readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { type BunSQLiteDatabase, drizzle } from 'drizzle-orm/bun-sqlite'
import { migrate } from 'drizzle-orm/bun-sqlite/migrator'
import { logger } from '../logger'
import * as schema from './schema'

export type BrowserOsDatabase = BunSQLiteDatabase<typeof schema>

interface DrizzleJournalEntry {
  tag: string
}

export interface DbHandle {
  path: string
  migrationsDir: string | null
  sqlite: BunDatabase
  db: BrowserOsDatabase
}

export interface OpenDbOptions {
  dbPath: string
  resourcesDir?: string
  migrationsDir?: string
  runMigrations?: boolean
}

const sourceMigrationsDir = fileURLToPath(
  new URL('./migrations', import.meta.url),
)

/** Opens BrowserOS SQLite and applies checked-in Drizzle migrations before callers use the DB. */
export function openBrowserOsDatabase(options: OpenDbOptions): DbHandle {
  const migrationsDir = resolveMigrationsDir(options)
  mkdirSync(dirname(options.dbPath), { recursive: true })

  const sqlite = new BunDatabase(options.dbPath)
  sqlite.exec('PRAGMA journal_mode = WAL')
  sqlite.exec('PRAGMA foreign_keys = ON')

  const db = drizzle(sqlite, { schema })
  if (options.runMigrations !== false) {
    if (migrationsDir) {
      migrate(db, { migrationsFolder: migrationsDir })
    } else {
      logger.warn(
        'Drizzle migrations unavailable; bootstrapping current schema',
        {
          dbPath: options.dbPath,
        },
      )
      bootstrapCurrentSchema(sqlite)
    }
  }

  return {
    path: options.dbPath,
    migrationsDir,
    sqlite,
    db,
  }
}

/** Resolves migrations from explicit test paths, packaged resources, or the source tree. */
export function resolveMigrationsDir(
  options: Pick<OpenDbOptions, 'migrationsDir' | 'resourcesDir'> = {},
): string | null {
  if (options.migrationsDir) {
    if (hasCompleteMigrationSet(options.migrationsDir)) {
      return options.migrationsDir
    }
    logger.warn(
      'Configured Drizzle migrations directory is missing or incomplete; bootstrapping current schema',
      { migrationsDir: options.migrationsDir },
    )
    return null
  }

  const candidates = [
    options.resourcesDir
      ? join(options.resourcesDir, 'db', 'migrations')
      : null,
    sourceMigrationsDir,
  ].filter((candidate): candidate is string => Boolean(candidate))

  for (const candidate of candidates) {
    if (hasCompleteMigrationSet(candidate)) return candidate
  }

  return null
}

/** Accepts only migration folders Drizzle can read without filesystem errors. */
function hasCompleteMigrationSet(migrationsDir: string): boolean {
  const journal = readDrizzleJournal(
    join(migrationsDir, 'meta', '_journal.json'),
  )
  if (!journal) return false

  const journalTags = new Set(journal.entries.map((entry) => entry.tag))
  if (
    !currentMigrationHistory.every((migration) =>
      journalTags.has(migration.tag),
    )
  ) {
    return false
  }

  return journal.entries.every((entry) =>
    existsSync(join(migrationsDir, `${entry.tag}.sql`)),
  )
}

function readDrizzleJournal(
  journalPath: string,
): { entries: DrizzleJournalEntry[] } | null {
  if (!existsSync(journalPath)) return null

  try {
    const journal = JSON.parse(readFileSync(journalPath, 'utf8')) as unknown
    if (!isDrizzleJournal(journal)) return null
    return journal
  } catch {
    return null
  }
}

function isDrizzleJournal(
  value: unknown,
): value is { entries: DrizzleJournalEntry[] } {
  return (
    typeof value === 'object' &&
    value !== null &&
    'entries' in value &&
    Array.isArray(value.entries) &&
    value.entries.every(
      (entry) =>
        typeof entry === 'object' &&
        entry !== null &&
        'tag' in entry &&
        typeof entry.tag === 'string',
    )
  )
}

/** Creates the current schema when packaged builds lack migration files, and marks those migrations applied. */
function bootstrapCurrentSchema(sqlite: BunDatabase): void {
  sqlite.exec('BEGIN')
  try {
    for (const statement of currentSchemaStatements) {
      sqlite.exec(statement)
    }
    const providerColumns = sqlite
      .query<{ name: string }, []>('PRAGMA table_info(providers)')
      .all()
    if (!providerColumns.some((column) => column.name === 'headers')) {
      sqlite.exec('ALTER TABLE providers ADD COLUMN headers text')
    }
    const memoryColumns = sqlite
      .query<{ name: string }, []>('PRAGMA table_info(memories)')
      .all()
    if (!memoryColumns.some((column) => column.name === 'source_id')) {
      sqlite.exec('ALTER TABLE memories ADD COLUMN source_id text')
    }
    if (!memoryColumns.some((column) => column.name === 'source_title')) {
      sqlite.exec('ALTER TABLE memories ADD COLUMN source_title text')
    }
    const conversationRunColumns = sqlite
      .query<{ name: string }, []>('PRAGMA table_info(conversation_run_state)')
      .all()
    if (
      !conversationRunColumns.some(
        (column) => column.name === 'trace_persistence_degraded',
      )
    ) {
      sqlite.exec(
        'ALTER TABLE conversation_run_state ADD COLUMN trace_persistence_degraded integer NOT NULL DEFAULT 0',
      )
    }
    const scheduledJobColumns = sqlite
      .query<{ name: string }, []>('PRAGMA table_info(scheduled_jobs)')
      .all()
    if (!scheduledJobColumns.some((column) => column.name === 'mode')) {
      sqlite.exec(
        "ALTER TABLE scheduled_jobs ADD COLUMN mode text NOT NULL DEFAULT 'task'",
      )
    }
    if (
      !scheduledJobColumns.some((column) => column.name === 'conversation_id')
    ) {
      sqlite.exec('ALTER TABLE scheduled_jobs ADD COLUMN conversation_id text')
    }
    const scheduledRunColumns = sqlite
      .query<{ name: string }, []>('PRAGMA table_info(scheduled_job_runs)')
      .all()
    if (
      !scheduledRunColumns.some((column) => column.name === 'conversation_id')
    ) {
      sqlite.exec(
        'ALTER TABLE scheduled_job_runs ADD COLUMN conversation_id text',
      )
    }
    const insertMigration = sqlite.prepare(`
      INSERT INTO __drizzle_migrations ("hash", "created_at")
      SELECT ?, ?
      WHERE NOT EXISTS (
        SELECT 1 FROM __drizzle_migrations
        WHERE created_at = ?
      )
    `)
    for (const migration of currentMigrationHistory) {
      insertMigration.run(
        migration.hash,
        migration.createdAt,
        migration.createdAt,
      )
    }
    sqlite.exec('COMMIT')
  } catch (error) {
    sqlite.exec('ROLLBACK')
    throw error
  }
}

const currentMigrationHistory = [
  {
    tag: '0000_zippy_psylocke',
    hash: 'aadfc2e86410febb11a974d25d99d5f7196aa797d9635ced9a18cd4eeb503b61',
    createdAt: 1777750582590,
  },
  {
    tag: '0001_lazy_orphan',
    hash: '19e693f7b1adcd1d932fa6cf5638b5b158c66ea5de4f154bc59311f4d6f71261',
    createdAt: 1777752799806,
  },
  {
    tag: '0002_chemical_whirlwind',
    hash: '02b11bf1dc34a5a289efd216233a48f0b7b950cfc33eaa7ebe6dcbb15d07f75c',
    createdAt: 1777902205667,
  },
  {
    tag: '0003_scrub_hermes_credentials',
    hash: '34387e59aa1f0d6dc44c95836d2363b72982663c50d05d0c67ee58c211209f52',
    createdAt: 1781916712443,
  },
  {
    tag: '0004_sparkling_carnage',
    hash: '76d3a9d6c383995df79b6d8f66ae1bedd0b97b1f44e90c047d8853666bbcc9fd',
    createdAt: 1785893663690,
  },
  {
    tag: '0005_yellow_riptide',
    hash: '44a8d4afc62cc58f0f958f633e5262331370d1e1538981b69c1ec2cb807a3154',
    createdAt: 1785900211901,
  },
  {
    tag: '0006_add_conversations',
    hash: 'e9a01f94d41f7718c66039a8483302f6db7c7de946f99987a6dd2e78613bce90',
    createdAt: 1786538823114,
  },
  {
    tag: '0007_add_custom_acp_agents',
    hash: '561eb1075d7487ffe0394e587eef7ba35ccd892e3e3b53acace579cb0477576b',
    createdAt: 1787580067090,
  },
  {
    tag: '0008_add_llm_providers_and_scheduled_jobs',
    hash: '1e36c60be880a222ae150858c5248a433556bd974c52164c42d1955e84ba6606',
    createdAt: 1788319873053,
  },
  {
    tag: '0009_add_scheduled_job_runs',
    hash: '188a9503d889be46926bd6d4d660a1c016c90fac71447c25eec73e421b90fc96',
    createdAt: 1788413695569,
  },
  {
    tag: '0010_add_unified_providers_table',
    hash: '9e5731582228e0de16bb28f5465cfd62ec2662822f43122f84b8039dd2c0cf0b',
    createdAt: 1788426799725,
  },
  {
    tag: '0011_drop_split_provider_tables',
    hash: 'eb0fa2687c80caf919248f28cda5cd955e01a671b2104308b4d04ec55d450611',
    createdAt: 1788426855683,
  },
  {
    tag: '0012_add_provider_headers',
    hash: '5e1894d0aebf4a5b708425f565795b01e4efdb997a1e1e6fc6479f229bd022da',
    createdAt: 1788724664440,
  },
  {
    tag: '0013_drop_browseros_provider',
    hash: 'a56bd0e97b0297bf0933b9b06d7e3862957727999762f0834f30e7b42da69a09',
    createdAt: 1790095966768,
  },
  {
    tag: '0014_drop_profile_id',
    hash: 'bc71831be007936b7d04aa24c4496a06517e204a78d35af93935f3fc97eb49f9',
    createdAt: 1790235209541,
  },
  {
    tag: '0015_chilly_fenris',
    hash: '70d9ce564b793e41b1822e12eade14cb82e8ef6d51106e47ab7b25fa82ac0043',
    createdAt: 1793092661248,
  },
  {
    tag: '0016_aspiring_squirrel_girl',
    hash: 'b3382c523175a9c55056e475c871dc76e4e8e30165220fecc55ca6a4c3cb5f13',
    createdAt: 1793092674395,
  },
  {
    tag: '0017_memory_search',
    hash: 'e5c20f24a9f1073dc6b026084628a061209d71926c48bd731caa6f9e0dbc6fba',
    createdAt: 1793092800000,
  },
  {
    tag: '0018_memory_task_provenance',
    hash: 'a81b3155883222281a811ea4184289084722cfe60985c7ea69330064cf8f288d',
    createdAt: 1793101052721,
  },
  {
    tag: '0019_add_heartbeat_continuation',
    hash: '9c67ccbb30ba65ee390ebc41fdd5e7738ad2876c2d6814904c8e3d0522038c5c',
    createdAt: 1793200000000,
  },
  {
    tag: '0020_add_conversation_run_state',
    hash: '8457cf0c9efbc63f77bca3976e310f7286c712071eda86e7c03b2a237ef7d6d5',
    createdAt: 1793232000000,
  },
  {
    tag: '0021_add_action_policy_rules',
    hash: '3e9373d40392c2ddb78577a8844911dfb81fde94a755197778079be45e7862db',
    createdAt: 1793318400000,
  },
  {
    tag: '0022_one_running_scheduled_job_per_job',
    hash: '4b230c05ae30bd32ef121f9443eb067b104132397ec1b8a162c4c66c4f749b20',
    createdAt: 1793404800000,
  },
  {
    tag: '0023_add_conversation_run_trace_events',
    hash: '05a0cc7220c88a36608bc5985c8a93eb23623ac3b41672b7531bf81d9fcd8737',
    createdAt: 1793491200000,
  },
  {
    tag: '0024_add_conversation_run_trace_degradation',
    hash: '442ff475c47478ff982bb4296e1a97c3e489835274a49528857c61210e1e12b4',
    createdAt: 1793577600000,
  },
]

// TODO(nikhil): Remove this fallback once Windows/Linux packaging always includes Drizzle migrations.
const currentSchemaStatements = [
  `
    CREATE TABLE IF NOT EXISTS providers (
      id text PRIMARY KEY NOT NULL,
      kind text NOT NULL,
      type text NOT NULL,
      name text NOT NULL,
      model_id text,
      reasoning_effort text,
      is_default integer DEFAULT false NOT NULL,
      created_at integer NOT NULL,
      updated_at integer NOT NULL,
      base_url text,
      headers text,
      supports_images integer DEFAULT true NOT NULL,
      context_window integer,
      temperature real DEFAULT 0.2 NOT NULL,
      api_key text,
      access_key_id text,
      secret_access_key text,
      session_token text,
      resource_name text,
      region text,
      reasoning_summary text,
      working_directory text,
      custom_config text,
      CONSTRAINT "providers_llm_requires_model_and_context" CHECK("providers"."kind" <> 'llm' OR ("providers"."model_id" IS NOT NULL AND "providers"."context_window" IS NOT NULL))
    )
  `,
  `
    CREATE INDEX IF NOT EXISTS providers_kind_updated_at_idx
    ON providers (kind, updated_at)
  `,
  `
    CREATE UNIQUE INDEX IF NOT EXISTS providers_one_default
    ON providers (is_default) WHERE "providers"."is_default" = 1
  `,
  `
    CREATE TABLE IF NOT EXISTS scheduled_jobs (
      id text PRIMARY KEY NOT NULL,
      name text NOT NULL,
      query text NOT NULL,
      mode text DEFAULT 'task' NOT NULL,
      conversation_id text,
      schedule_type text NOT NULL,
      schedule_time text,
      schedule_interval integer,
      enabled integer DEFAULT true NOT NULL,
      provider_id text,
      last_run_at integer,
      created_at integer NOT NULL,
      updated_at integer NOT NULL,
      FOREIGN KEY (provider_id) REFERENCES providers(id) ON UPDATE no action ON DELETE set null
    )
  `,
  `
    CREATE INDEX IF NOT EXISTS scheduled_jobs_enabled_idx
    ON scheduled_jobs (enabled)
  `,
  `
    CREATE TABLE IF NOT EXISTS scheduled_job_runs (
      id text PRIMARY KEY NOT NULL,
      job_id text NOT NULL,
      conversation_id text,
      status text NOT NULL,
      started_at integer NOT NULL,
      completed_at integer,
      result text,
      final_result text,
      execution_log text,
      tool_calls text,
      error text,
      created_at integer NOT NULL,
      updated_at integer NOT NULL,
      FOREIGN KEY (job_id) REFERENCES scheduled_jobs(id) ON UPDATE no action ON DELETE cascade
    )
  `,
  `
    CREATE INDEX IF NOT EXISTS scheduled_job_runs_job_id_idx
    ON scheduled_job_runs (job_id)
  `,
  `
    CREATE INDEX IF NOT EXISTS scheduled_job_runs_started_at_idx
    ON scheduled_job_runs (started_at)
  `,
  `
    UPDATE scheduled_job_runs
    SET status = 'failed',
        error = 'Execution state is uncertain after overlapping scheduled runs'
    WHERE status = 'running'
      AND job_id IN (
        SELECT job_id FROM scheduled_job_runs
        WHERE status = 'running' GROUP BY job_id HAVING COUNT(*) > 1
      )
  `,
  `
    CREATE UNIQUE INDEX IF NOT EXISTS scheduled_job_runs_one_running_per_job
    ON scheduled_job_runs (job_id) WHERE status = 'running'
  `,
  `
    CREATE TABLE IF NOT EXISTS oauth_tokens (
      browseros_id text NOT NULL,
      provider text NOT NULL,
      access_token text NOT NULL,
      refresh_token text NOT NULL,
      expires_at integer NOT NULL,
      email text,
      account_id text,
      updated_at integer NOT NULL,
      PRIMARY KEY (browseros_id, provider)
    )
  `,
  `
    CREATE INDEX IF NOT EXISTS oauth_tokens_browseros_id_idx
    ON oauth_tokens (browseros_id)
  `,
  `
    CREATE TABLE IF NOT EXISTS conversations (
      id text PRIMARY KEY NOT NULL,
      messages text NOT NULL,
      last_user_message text,
      origin text,
      target_type text NOT NULL,
      agent_id text,
      last_messaged_at integer NOT NULL,
      created_at integer NOT NULL,
      updated_at integer NOT NULL
    )
  `,
  `
    CREATE INDEX IF NOT EXISTS conversations_last_messaged_at_idx
    ON conversations (last_messaged_at)
  `,
  `
    CREATE TABLE IF NOT EXISTS conversation_run_state (
      conversation_id text PRIMARY KEY NOT NULL,
      run_id text NOT NULL,
      status text NOT NULL,
      started_at integer NOT NULL,
      finished_at integer,
      trace_persistence_degraded integer NOT NULL DEFAULT 0
    )
  `,
  `CREATE INDEX IF NOT EXISTS conversation_run_state_status_idx ON conversation_run_state (status)`,
  `CREATE TABLE IF NOT EXISTS conversation_run_trace_events (sequence integer PRIMARY KEY AUTOINCREMENT NOT NULL, conversation_id text NOT NULL, run_id text NOT NULL, event_id text NOT NULL UNIQUE, event_json text NOT NULL)`,
  `CREATE INDEX IF NOT EXISTS conversation_run_trace_events_scope_idx ON conversation_run_trace_events (conversation_id, run_id, sequence)`,
  `CREATE TABLE IF NOT EXISTS action_policy_rules (action_id text PRIMARY KEY NOT NULL, decision text NOT NULL CHECK (decision IN ('allow', 'ask', 'deny')), expires_at integer, updated_at integer NOT NULL)`,
  `
    CREATE TABLE IF NOT EXISTS memories (
      id text PRIMARY KEY NOT NULL,
      content text NOT NULL,
      source text DEFAULT 'user' NOT NULL,
      source_url text,
      source_id text,
      source_title text,
      created_at integer NOT NULL,
      updated_at integer NOT NULL,
      expires_at integer
    )
  `,
  `CREATE INDEX IF NOT EXISTS memories_updated_at_idx ON memories (updated_at)`,
  `
    CREATE TABLE IF NOT EXISTS memory_settings (
      id integer PRIMARY KEY DEFAULT 1 NOT NULL,
      enabled integer DEFAULT false NOT NULL,
      retention_days integer,
      updated_at integer NOT NULL
    )
  `,
  `CREATE VIRTUAL TABLE IF NOT EXISTS memories_fts USING fts5(memory_id UNINDEXED, content, source_url, tokenize='unicode61')`,
  `CREATE TRIGGER IF NOT EXISTS memories_fts_insert AFTER INSERT ON memories BEGIN INSERT INTO memories_fts (memory_id, content, source_url) VALUES (new.id, new.content, coalesce(new.source_url, '')); END`,
  `CREATE TRIGGER IF NOT EXISTS memories_fts_update AFTER UPDATE ON memories BEGIN DELETE FROM memories_fts WHERE memory_id = old.id; INSERT INTO memories_fts (memory_id, content, source_url) VALUES (new.id, new.content, coalesce(new.source_url, '')); END`,
  `CREATE TRIGGER IF NOT EXISTS memories_fts_delete AFTER DELETE ON memories BEGIN DELETE FROM memories_fts WHERE memory_id = old.id; END`,
  `
    CREATE TABLE IF NOT EXISTS __drizzle_migrations (
      id SERIAL PRIMARY KEY,
      hash text NOT NULL,
      created_at numeric
    )
  `,
]
