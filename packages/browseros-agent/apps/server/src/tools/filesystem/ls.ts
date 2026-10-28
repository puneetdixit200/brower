import { type Tool, tool } from 'ai'
import { z } from 'zod/v4'
import {
  listDirectoryBeneath,
  openWorkspaceRoot,
  type PinnedWorkspaceRoot,
} from './safe-file'
import {
  DEFAULT_LS_LIMIT,
  executeWithMetrics,
  resolveWorkspacePathFromRoot,
  resolveWorkspaceRoot,
  toModelOutput,
} from './utils'

const TOOL_NAME = 'filesystem_ls'

function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes}B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)}KB`
  return `${(bytes / (1024 * 1024)).toFixed(1)}MB`
}

function collectVisibleEntries(
  entries: Awaited<ReturnType<typeof listDirectoryBeneath>>,
): { dirs: string[]; files: Array<{ name: string; size: number }> } {
  const dirs: string[] = []
  const files: Array<{ name: string; size: number }> = []

  for (const entry of entries) {
    if (entry.isDirectory && !entry.isSymbolicLink) {
      dirs.push(entry.name)
      continue
    }
    files.push({ name: entry.name, size: entry.size })
  }

  return { dirs, files }
}

function formatEntries(
  dirs: string[],
  files: Array<{ name: string; size: number }>,
  limit: number,
): string {
  dirs.sort((a, b) => a.localeCompare(b, undefined, { sensitivity: 'base' }))
  files.sort((a, b) =>
    a.name.localeCompare(b.name, undefined, { sensitivity: 'base' }),
  )

  const lines: string[] = []
  for (const dir of dirs) {
    if (lines.length >= limit) break
    lines.push(`${dir}/`)
  }
  for (const file of files) {
    if (lines.length >= limit) break
    lines.push(`${file.name} (${formatSize(file.size)})`)
  }

  if (lines.length === 0) return '(empty directory)'

  let result = lines.join('\n')
  const total = dirs.length + files.length
  if (total > limit) {
    result += `\n\n(Showing ${limit} of ${total} entries. Use limit=${limit * 2} to see more.)`
  }
  return result
}

export function createLsTool(
  cwd: string,
  workspaceRoot?: PinnedWorkspaceRoot,
): Tool {
  return tool({
    description:
      'List directory contents. Shows directories (with trailing /) first, then files with sizes. Entries are sorted alphabetically.',
    inputSchema: z.object({
      path: z
        .string()
        .optional()
        .describe('Directory path relative to the selected workspace'),
      limit: z
        .number()
        .optional()
        .describe(`Maximum entries to return (default: ${DEFAULT_LS_LIMIT})`),
    }),
    execute: (params) =>
      executeWithMetrics(
        TOOL_NAME,
        async () => {
          const inputPath = params.path || '.'
          const root = workspaceRoot?.path ?? (await resolveWorkspaceRoot(cwd))
          const rootHandle =
            workspaceRoot?.handle ?? (await openWorkspaceRoot(root))
          try {
            const resolved = await resolveWorkspacePathFromRoot(
              root,
              inputPath,
              Boolean(workspaceRoot),
            )
            const limit = params.limit || DEFAULT_LS_LIMIT
            const entries = await listDirectoryBeneath(
              root,
              resolved,
              rootHandle,
            )
            const { dirs, files } = collectVisibleEntries(entries)
            return { text: formatEntries(dirs, files, limit) }
          } finally {
            if (!workspaceRoot) await rootHandle.close()
          }
        },
        workspaceRoot,
      ),
    toModelOutput,
  })
}
