import {
  accessSync,
  constants,
  existsSync,
  realpathSync,
  statSync,
} from 'node:fs'
import { basename, dirname, resolve, sep } from 'node:path'
import { type Tool, tool } from 'ai'
import { z } from 'zod/v4'
import { resolveBundledBun } from '../../lib/agents/host-acp/bundled-bun'
import type { SafeFileHandle } from './safe-file'
import { openWorkspaceRoot, type PinnedWorkspaceRoot } from './safe-file'
import {
  DEFAULT_BASH_TIMEOUT,
  executeWithMetrics,
  type FilesystemToolResult,
  toModelOutput,
  truncateTail,
} from './utils'

const TOOL_NAME = 'filesystem_bash'

function resolveBashRuntime(resourcesDir?: string | null): string {
  // Packaged servers are compiled native executables. Their process.execPath
  // is the Aster ELF, not Bun, so only the explicitly configured resources
  // directory can provide the script runtime in that case.
  if (resourcesDir?.trim()) {
    const bunPath = resolveBundledBun({ resourcesDir })
    if (!bunPath) {
      throw new Error(
        'filesystem_bash requires the bundled Bun runtime in the configured resources directory.',
      )
    }
    try {
      const resourcesRoot = realpathSync(resolve(resourcesDir))
      const runtimePath = realpathSync(bunPath)
      const runtimeStat = statSync(runtimePath)
      if (
        (runtimePath !== resourcesRoot &&
          !runtimePath.startsWith(`${resourcesRoot}${sep}`)) ||
        !runtimeStat.isFile() ||
        (runtimeStat.mode & 0o022) !== 0
      ) {
        throw new Error(
          'Bundled Bun runtime has unsafe location or permissions.',
        )
      }
      accessSync(runtimePath, constants.X_OK)
      return runtimePath
    } catch {
      throw new Error(
        'filesystem_bash could not verify the bundled Bun runtime.',
      )
    }
  }

  // Source/development runs use Bun directly. Do not expose a compiled server
  // executable under a misleading /tmp/bin/bun name.
  if (basename(process.execPath).toLowerCase() !== 'bun') {
    throw new Error(
      'filesystem_bash requires a configured bundled Bun runtime; refusing to expose the server executable as Bun.',
    )
  }
  try {
    const runtimeStat = statSync(process.execPath)
    if (
      !runtimeStat.isFile() ||
      (process.getuid && runtimeStat.uid !== process.getuid()) ||
      (runtimeStat.mode & 0o022) !== 0
    ) {
      throw new Error('Bun runtime has unsafe ownership or permissions.')
    }
    accessSync(process.execPath, constants.X_OK)
    return process.execPath
  } catch {
    throw new Error(
      'filesystem_bash could not verify the development Bun runtime.',
    )
  }
}

function getLinuxSandboxArgs(
  cwd: string,
  resourcesDir?: string | null,
): string[] {
  // For a pinned workspace, cwd may have been renamed or replaced since the
  // session opened. Use its canonical display path only as the sandbox
  // destination; the inherited descriptor is the bind source.
  const root = resolve(cwd)
  if (root === '/' || root === '/tmp')
    throw new Error('Shell workspace cannot be a filesystem root.')
  for (const restricted of [
    '/proc',
    '/dev',
    '/sys',
    '/usr',
    '/bin',
    '/sbin',
    '/lib',
    '/lib64',
    '/etc',
  ]) {
    if (root === restricted || root.startsWith(`${restricted}${sep}`)) {
      throw new Error(
        `Shell workspace cannot be inside restricted system path: ${restricted}`,
      )
    }
  }

  const args = [
    '--die-with-parent',
    '--new-session',
    '--unshare-user',
    '--unshare-pid',
    '--ro-bind',
    '/usr',
    '/usr',
    '--ro-bind',
    '/bin',
    '/bin',
  ]
  for (const path of ['/sbin', '/lib', '/lib64']) {
    if (existsSync(path)) args.push('--ro-bind', path, path)
  }
  args.push('--dir', '/etc')
  for (const path of [
    '/etc/ssl',
    '/etc/ca-certificates',
    '/etc/passwd',
    '/etc/group',
    '/etc/nsswitch.conf',
    '/etc/hosts',
    '/etc/resolv.conf',
    '/etc/localtime',
    '/etc/locale.conf',
  ]) {
    if (existsSync(path)) args.push('--ro-bind', path, path)
  }
  args.push(
    '--proc',
    '/proc',
    '--dev',
    '/dev',
    '--tmpfs',
    '/tmp',
    '--dir',
    '/tmp/bin',
  )

  // Make only the selected workspace visible beneath otherwise empty ancestors.
  const ancestors: string[] = []
  for (let parent = dirname(root); parent !== '/'; parent = dirname(parent))
    ancestors.unshift(parent)
  for (const parent of ancestors) {
    if (
      parent === '/tmp' ||
      parent === '/usr' ||
      parent === '/bin' ||
      parent === '/sbin' ||
      parent === '/lib' ||
      parent === '/lib64' ||
      parent === '/etc'
    )
      continue
    args.push('--dir', parent)
  }
  // FD 3 is inherited directly by bwrap. This keeps the bind tied to the
  // selected directory inode even if its host pathname is replaced.
  args.push('--dir', root, '--bind', '/proc/self/fd/3', root, '--chdir', root)

  // Expose only a verified Bun executable, never the compiled server ELF,
  // the user's home directory, or host PATH entries.
  args.push('--ro-bind', resolveBashRuntime(resourcesDir), '/tmp/bin/bun')
  args.push(
    '--setenv',
    'PATH',
    '/tmp/bin:/usr/bin:/bin',
    '--setenv',
    'HOME',
    root,
    '--setenv',
    'PWD',
    root,
    '--setenv',
    'TMPDIR',
    '/tmp',
    '--setenv',
    'SHELL',
    '/bin/sh',
  )
  if (process.env.LANG) args.push('--setenv', 'LANG', process.env.LANG)
  if (process.env.TERM) args.push('--setenv', 'TERM', process.env.TERM)
  return args
}

function getShellInvocation(
  cwd: string,
  command: string,
  workspaceFd?: number,
  resourcesDir?: string | null,
): {
  command: string[]
  cwd?: string
  env?: Record<string, string>
  workspaceFd?: number
} {
  if (process.platform === 'win32') {
    return {
      command: ['cmd.exe', '/c', command],
      cwd,
      env: { PATH: process.env.PATH || '', HOME: cwd },
    }
  }
  if (process.platform === 'linux') {
    const bwrap = process.env.BWRAP_PATH || '/usr/bin/bwrap'
    if (!existsSync(bwrap))
      throw new Error(
        'filesystem_bash requires Bubblewrap (bwrap) on Linux; refusing to run unsandboxed.',
      )
    if (workspaceFd === undefined)
      throw new Error('filesystem_bash requires a pinned workspace descriptor.')
    return {
      command: [
        bwrap,
        ...getLinuxSandboxArgs(cwd, resourcesDir),
        '--',
        '/bin/sh',
        '-c',
        command,
      ],
      env: {},
      workspaceFd,
    }
  }
  return {
    command: ['/bin/sh', '-c', command],
    cwd,
    env: {
      PATH: process.env.PATH || '/usr/bin:/bin',
      HOME: cwd,
      TMPDIR: '/tmp',
    },
  }
}

function formatBashResult(
  stdoutText: string,
  stderrText: string,
  exitCode: number,
  timedOut: boolean,
  timeoutSeconds: number,
): FilesystemToolResult {
  let output = stdoutText
  if (stderrText) output += (output ? '\n' : '') + stderrText
  const truncated = truncateTail(output)
  if (timedOut) {
    return {
      text: `Command timed out after ${timeoutSeconds}s\n\n${truncated.content}`,
      isError: true,
    }
  }

  let result = truncated.content
  if (truncated.truncated) {
    result = `(Output truncated. Showing last ${truncated.keptLines} of ${truncated.totalLines} lines)\n${result}`
  }
  if (exitCode !== 0)
    return { text: `${result}\n\n[Exit code: ${exitCode}]`, isError: true }
  return { text: result || '(no output)' }
}

export function createBashTool(
  cwd: string,
  options: {
    resourcesDir?: string | null
    workspaceRoot?: PinnedWorkspaceRoot
  } = {},
): Tool {
  return tool({
    description:
      'Execute a shell command and return its output. Commands run in a shell (sh/bash on Unix, cmd on Windows). Output is truncated to the last 2000 lines if too large.',
    inputSchema: z.object({
      command: z.string().describe('Shell command to execute'),
      timeout: z
        .number()
        .optional()
        .describe(`Timeout in seconds (default: ${DEFAULT_BASH_TIMEOUT})`),
    }),
    execute: (params) =>
      executeWithMetrics(
        TOOL_NAME,
        async () => {
          const timeoutMs = (params.timeout || DEFAULT_BASH_TIMEOUT) * 1000
          const resolvedCwd = options.workspaceRoot?.path ?? resolve(cwd)
          let invocation: ReturnType<typeof getShellInvocation>
          let ownedWorkspaceHandle: SafeFileHandle | undefined
          try {
            let workspaceFd: number | undefined
            let invocationCwd = resolvedCwd
            if (process.platform === 'linux') {
              if (options.workspaceRoot) {
                workspaceFd = options.workspaceRoot.handle.fd
              } else {
                invocationCwd = realpathSync(resolve(resolvedCwd))
                ownedWorkspaceHandle = await openWorkspaceRoot(invocationCwd)
                workspaceFd = ownedWorkspaceHandle.fd
              }
            }
            invocation = getShellInvocation(
              invocationCwd,
              params.command,
              workspaceFd,
              options.resourcesDir,
            )
          } catch (error) {
            await ownedWorkspaceHandle?.close()
            return {
              text: error instanceof Error ? error.message : String(error),
              isError: true,
            }
          }

          try {
            const proc = Bun.spawn(invocation.command, {
              cwd: invocation.cwd,
              stdout: 'pipe',
              stderr: 'pipe',
              stdio:
                invocation.workspaceFd === undefined
                  ? ['ignore', 'pipe', 'pipe']
                  : ['ignore', 'pipe', 'pipe', invocation.workspaceFd],
              env: invocation.env,
            })

            let timedOut = false
            const timer = setTimeout(() => {
              timedOut = true
              proc.kill()
            }, timeoutMs)

            try {
              const [stdoutText, stderrText] = await Promise.all([
                new Response(proc.stdout).text(),
                new Response(proc.stderr).text(),
              ])

              const exitCode = await proc.exited

              return formatBashResult(
                stdoutText,
                stderrText,
                exitCode,
                timedOut,
                params.timeout || DEFAULT_BASH_TIMEOUT,
              )
            } finally {
              clearTimeout(timer)
            }
          } finally {
            await ownedWorkspaceHandle?.close()
          }
        },
        options.workspaceRoot,
      ),
    toModelOutput,
  })
}
