import type { ToolSet } from 'ai'
import { createBashTool } from './bash'
import { createEditTool } from './edit'
import { createFindTool } from './find'
import { createGrepTool } from './grep'
import { createLsTool } from './ls'
import { createReadTool, type ReadToolOptions } from './read'
import type { PinnedWorkspaceRoot } from './safe-file'
import { createWriteTool } from './write'

export interface FilesystemToolSetOptions {
  read?: ReadToolOptions
  resourcesDir?: string | null
  workspaceRoot?: PinnedWorkspaceRoot
  readOnly?: boolean
}

export function buildFilesystemToolSet(
  cwd: string,
  options: FilesystemToolSetOptions = {},
): ToolSet {
  const readTools = {
    filesystem_read: createReadTool(cwd, {
      ...options.read,
      workspaceRoot: options.workspaceRoot,
    }),
    filesystem_grep: createGrepTool(cwd, options.workspaceRoot),
    filesystem_find: createFindTool(cwd, options.workspaceRoot),
    filesystem_ls: createLsTool(cwd, options.workspaceRoot),
  }
  if (options.readOnly) return readTools
  return {
    ...readTools,
    filesystem_write: createWriteTool(cwd, options.workspaceRoot),
    filesystem_edit: createEditTool(cwd, options.workspaceRoot),
    filesystem_bash: createBashTool(cwd, {
      resourcesDir: options.resourcesDir,
      // Keep the pinned workspace descriptor alive through Bash execution;
      // Linux Bubblewrap binds the selected inode through inherited fd 3.
      workspaceRoot: options.workspaceRoot,
    }),
  }
}
