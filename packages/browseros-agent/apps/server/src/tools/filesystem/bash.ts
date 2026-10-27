import { existsSync, realpathSync } from 'node:fs'
import { dirname, resolve, sep } from 'node:path'
import { type Tool, tool } from 'ai'
import { z } from 'zod/v4'
import {
  DEFAULT_BASH_TIMEOUT,
  executeWithMetrics,
  type FilesystemToolResult,
  toModelOutput,
  truncateTail,
} from './utils'

const TOOL_NAME = 'filesystem_bash'

function getLinuxSandboxArgs(cwd: string): string[] {
  const root = realpathSync(resolve(cwd))
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
  args.push('--dir', root, '--bind', root, root, '--chdir', root)

  // Bun is commonly installed per-user rather than under /usr. Expose that one
  // executable explicitly without making the rest of the home directory visible.
  const home = process.env.HOME
  if (home) {
    for (const candidate of [
      resolve(home, '.local/bin/bun'),
      resolve(home, '.bun/bin/bun'),
    ]) {
      if (existsSync(candidate)) {
        args.push('--ro-bind', candidate, '/tmp/bin/bun')
        break
      }
    }
  }
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
): { command: string[]; cwd?: string; env?: Record<string, string> } {
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
    return {
      command: [
        bwrap,
        ...getLinuxSandboxArgs(cwd),
        '--',
        '/bin/sh',
        '-c',
        command,
      ],
      env: {},
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

export function createBashTool(cwd: string): Tool {
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
      executeWithMetrics(TOOL_NAME, async () => {
        const timeoutMs = (params.timeout || DEFAULT_BASH_TIMEOUT) * 1000
        const resolvedCwd = resolve(cwd)
        let invocation: ReturnType<typeof getShellInvocation>
        try {
          invocation = getShellInvocation(resolvedCwd, params.command)
        } catch (error) {
          return {
            text: error instanceof Error ? error.message : String(error),
            isError: true,
          }
        }

        const proc = Bun.spawn(invocation.command, {
          cwd: invocation.cwd,
          stdout: 'pipe',
          stderr: 'pipe',
          env: invocation.env,
        })

        let timedOut = false
        const timer = setTimeout(() => {
          timedOut = true
          proc.kill()
        }, timeoutMs)

        const [stdoutText, stderrText] = await Promise.all([
          new Response(proc.stdout).text(),
          new Response(proc.stderr).text(),
        ])

        const exitCode = await proc.exited
        clearTimeout(timer)

        return formatBashResult(
          stdoutText,
          stderrText,
          exitCode,
          timedOut,
          params.timeout || DEFAULT_BASH_TIMEOUT,
        )
      }),
    toModelOutput,
  })
}
