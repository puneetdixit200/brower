import { type Tool, tool } from 'ai'
import { z } from 'zod/v4'
import {
  openWorkspaceRoot,
  type PinnedWorkspaceRoot,
  writeFileBeneath,
} from './safe-file'
import {
  executeWithMetrics,
  resolveWorkspaceRoot,
  resolveWorkspaceWritePathFromRoot,
  toModelOutput,
} from './utils'

const TOOL_NAME = 'filesystem_write'

export function createWriteTool(
  cwd: string,
  workspaceRoot?: PinnedWorkspaceRoot,
): Tool {
  return tool({
    description:
      "Create or overwrite a file. Automatically creates parent directories if they don't exist. Use this to create new files or completely replace file contents.",
    inputSchema: z.object({
      path: z.string().describe('File path relative to the selected workspace'),
      content: z.string().describe('Complete file content to write'),
    }),
    execute: (params) =>
      executeWithMetrics(
        TOOL_NAME,
        async () => {
          const root = workspaceRoot?.path ?? (await resolveWorkspaceRoot(cwd))
          const rootHandle =
            workspaceRoot?.handle ?? (await openWorkspaceRoot(root))
          try {
            const resolved = await resolveWorkspaceWritePathFromRoot(
              root,
              params.path,
              Boolean(workspaceRoot),
            )
            await writeFileBeneath(root, resolved, params.content, rootHandle)
          } finally {
            if (!workspaceRoot) await rootHandle.close()
          }
          const bytes = Buffer.byteLength(params.content, 'utf-8')
          return { text: `Wrote ${bytes} bytes to ${params.path}` }
        },
        workspaceRoot,
      ),
    toModelOutput,
  })
}
