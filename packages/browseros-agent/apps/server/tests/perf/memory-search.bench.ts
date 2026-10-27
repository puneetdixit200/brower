import { mkdtempSync, rmSync } from 'node:fs'
import { cpus, freemem, release, tmpdir, totalmem } from 'node:os'
import { join } from 'node:path'
import { closeDb, initializeDb } from '../../src/lib/db'
import { DbMemoryStore } from '../../src/lib/memory/memory-store'

const COUNTS = [10_000, 50_000]
const ITERATIONS = 120
const WARMUP = 20

async function run() {
  const results = []
  for (const count of COUNTS) {
    const dir = mkdtempSync(join(tmpdir(), 'aster-memory-bench-'))
    try {
      const { sqlite } = initializeDb({ dbPath: join(dir, 'aster.sqlite') })
      const store = new DbMemoryStore()
      store.updateSettings({ enabled: true, retentionDays: null })
      const insert = sqlite.prepare(
        `INSERT INTO memories (id, content, source, source_url, created_at, updated_at, expires_at)
         VALUES (?, ?, 'user', NULL, ?, ?, NULL)`,
      )
      const insertAll = sqlite.transaction(() => {
        const now = Date.now()
        for (let index = 0; index < count; index++) {
          const content =
            index % 100 === 0
              ? `Aster benchmarkproject commonterm record ${index} stores a deterministic sample note for local FTS search latency measurements.`
              : `Aster synthetic record ${index} stores a deterministic sample note for local FTS search latency measurements.`
          insert.run(`memory-${count}-${index}`, content, now, now)
        }
      })
      const insertStarted = performance.now()
      insertAll()
      const indexBuildMs = performance.now() - insertStarted

      for (let index = 0; index < WARMUP; index++) {
        store.search('benchmarkproject commonterm')
      }
      const samplesMs: number[] = []
      for (let index = 0; index < ITERATIONS; index++) {
        const started = performance.now()
        const matches = store.search('benchmarkproject commonterm')
        if (matches.length !== 8) {
          throw new Error(`Expected 8 search results, got ${matches.length}`)
        }
        samplesMs.push(performance.now() - started)
      }
      const sortedSamplesMs = [...samplesMs].sort((left, right) => left - right)
      results.push({
        entries: count,
        iterations: ITERATIONS,
        warmup: WARMUP,
        resultLimit: 8,
        matchingEntries: count / 100,
        indexBuildMs: Number(indexBuildMs.toFixed(2)),
        medianMs: Number(
          sortedSamplesMs[Math.floor(sortedSamplesMs.length / 2)].toFixed(3),
        ),
        p95Ms: Number(
          sortedSamplesMs[Math.ceil(sortedSamplesMs.length * 0.95) - 1].toFixed(
            3,
          ),
        ),
        maxMs: Number(sortedSamplesMs.at(-1)?.toFixed(3)),
        samplesMs,
      })
      closeDb()
    } finally {
      closeDb()
      rmSync(dir, { recursive: true, force: true })
    }
  }
  console.log(
    JSON.stringify(
      {
        benchmark: 'Aster local memory SQLite FTS search',
        query: 'benchmarkproject commonterm',
        database:
          'temporary SQLite database with production migrations/triggers',
        cache: 'warm; first 20 queries discarded',
        host: {
          platform: process.platform,
          architecture: process.arch,
          kernel: release(),
          cpu: cpus()[0]?.model,
          logicalCpus: cpus().length,
          ramBytes: totalmem(),
          freeRamAtEndBytes: freemem(),
          temporaryDirectory: tmpdir(),
        },
        generatedAt: new Date().toISOString(),
        results,
      },
      null,
      2,
    ),
  )
}

await run()
