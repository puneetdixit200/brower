import { afterEach, beforeEach, describe, expect, it } from 'bun:test'
import {
  chmod,
  copyFile,
  mkdir,
  readFile,
  rm,
  writeFile,
} from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createBashTool } from '../../../src/tools/filesystem/bash'
import type { FilesystemToolResult } from '../../../src/tools/filesystem/utils'

let tmpDir: string
let exec: (params: Record<string, unknown>) => Promise<FilesystemToolResult>

beforeEach(async () => {
  tmpDir = join(
    tmpdir(),
    `fs-bash-test-${Date.now()}-${Math.random().toString(36).slice(2)}`,
  )
  await mkdir(tmpDir, { recursive: true })
  const tool = createBashTool(tmpDir)
  // biome-ignore lint/suspicious/noExplicitAny: test helper
  exec = (params) => (tool as any).execute(params)
})

afterEach(async () => {
  await rm(tmpDir, { recursive: true, force: true })
})

describe('filesystem_bash', () => {
  it('executes a simple command', async () => {
    const result = await exec({ command: 'echo hello' })
    expect(result.isError).toBeUndefined()
    expect(result.text.trim()).toBe('hello')
  })

  it('returns output from pwd', async () => {
    const result = await exec({ command: 'pwd' })
    expect(result.isError).toBeUndefined()
    expect(result.text.trim()).toContain(tmpDir)
  })

  it('captures stderr on failure', async () => {
    const result = await exec({ command: 'ls /nonexistent_directory_xyz' })
    expect(result.isError).toBe(true)
    expect(result.text).toContain('Exit code:')
  })

  it('returns exit code for failed commands', async () => {
    const result = await exec({ command: 'exit 42' })
    expect(result.isError).toBe(true)
    expect(result.text).toContain('[Exit code: 42]')
  })

  it('handles piped commands', async () => {
    const result = await exec({ command: 'echo "a b c" | wc -w' })
    expect(result.isError).toBeUndefined()
    expect(result.text.trim()).toBe('3')
  })

  it('times out long-running commands', async () => {
    const result = await exec({ command: 'exec sleep 30', timeout: 1 })
    expect(result.isError).toBe(true)
    expect(result.text).toContain('timed out')
  }, 10_000)

  it('can create files', async () => {
    await exec({ command: 'echo "created" > testfile.txt' })
    const content = await readFile(join(tmpDir, 'testfile.txt'), 'utf-8')
    expect(content.trim()).toBe('created')
  })

  it('handles empty output commands', async () => {
    const result = await exec({ command: 'true' })
    expect(result.isError).toBeUndefined()
    expect(result.text).toBe('(no output)')
  })

  it('handles multiline output', async () => {
    const result = await exec({
      command: 'echo "line1"; echo "line2"; echo "line3"',
    })
    expect(result.text).toContain('line1')
    expect(result.text).toContain('line2')
    expect(result.text).toContain('line3')
  })

  it('uses cwd as working directory', async () => {
    await mkdir(join(tmpDir, 'subdir'))
    const subTool = createBashTool(join(tmpDir, 'subdir'))
    const subExec = (params: Record<string, unknown>) =>
      // biome-ignore lint/suspicious/noExplicitAny: test helper
      (subTool as any).execute(params)

    const result = await subExec({ command: 'pwd' })
    expect(result.text.trim()).toContain('subdir')
  })

  it('passes environment variables through', async () => {
    const result = await exec({ command: 'echo $HOME' })
    expect(result.isError).toBeUndefined()
    expect(result.text.trim()).toBe(tmpDir)
  })

  it('cannot read or modify a sibling of the selected workspace', async () => {
    const sibling = `${tmpDir}-sibling-secret`
    await writeFile(sibling, 'host-only-secret')
    try {
      const read = await exec({ command: `cat '${sibling}'` })
      expect(read.isError).toBe(true)
      expect(read.text).not.toContain('host-only-secret')

      const write = await exec({ command: `echo changed > '${sibling}'` })
      expect(write.isError).toBeUndefined()
      expect(await readFile(sibling, 'utf-8')).toBe('host-only-secret')
    } finally {
      await rm(sibling, { force: true })
    }
  })

  it('does not pass unrelated host environment variables into the shell', async () => {
    const previous = process.env.ASTER_BASH_TEST_SECRET
    process.env.ASTER_BASH_TEST_SECRET = 'host-secret-value'
    try {
      const result = await exec({
        command: 'printenv ASTER_BASH_TEST_SECRET || echo unset',
      })
      expect(result.isError).toBeUndefined()
      expect(result.text.trim()).toBe('unset')
    } finally {
      if (previous === undefined) delete process.env.ASTER_BASH_TEST_SECRET
      else process.env.ASTER_BASH_TEST_SECRET = previous
    }
  })

  it('does not expose host credential files from /etc', async () => {
    const result = await exec({ command: 'test ! -e /etc/shadow' })
    expect(result.isError).toBeUndefined()
  })

  it('keeps the server Bun runtime available inside the sandbox', async () => {
    if (process.platform !== 'linux' || process.getuid?.() === 0) return
    const result = await exec({ command: 'bun --version' })
    expect(result.isError).toBeUndefined()
    expect(result.text.trim()).toMatch(/^\d+\.\d+\.\d+/)
  })

  it('uses the bundled Bun runtime when the server executable is compiled', async () => {
    if (process.platform !== 'linux' || process.getuid?.() === 0) return
    const resourcesDir = join(tmpDir, 'resources')
    const bunDir = join(resourcesDir, 'bin', 'third_party')
    await mkdir(bunDir, { recursive: true })
    const bundledBun = join(bunDir, 'bun')
    await copyFile(process.execPath, bundledBun)
    await chmod(bundledBun, 0o755)

    // Compile a small Bun executable to model the packaged server's distinct
    // process.execPath, then exercise the real tool factory and Bubblewrap
    // invocation from that compiled process.
    const harnessSource = join(tmpDir, 'compiled-server-fixture.ts')
    const harnessExecutable = join(tmpDir, 'compiled-server-fixture')
    const bashModule = join(
      import.meta.dir,
      '../../../src/tools/filesystem/bash.ts',
    )
    await writeFile(
      harnessSource,
      `import { createBashTool } from ${JSON.stringify(bashModule)}
const tool = createBashTool(process.argv[2]!, { resourcesDir: process.argv[3] })
// biome-ignore lint/suspicious/noExplicitAny: compiled fixture
const result = await (tool as any).execute({ command: "bun -e 'console.log(process.cwd())'" })
console.log(JSON.stringify(result))
process.exitCode = result.isError ? 1 : 0
`,
    )
    const build = await Bun.build({
      entrypoints: [harnessSource],
      compile: { outfile: harnessExecutable },
      target: 'bun',
    })
    expect(build.success).toBe(true)
    const fixture = Bun.spawn([harnessExecutable, tmpDir, resourcesDir], {
      stdout: 'pipe',
      stderr: 'pipe',
    })
    const [stdout, stderr, exitCode] = await Promise.all([
      new Response(fixture.stdout).text(),
      new Response(fixture.stderr).text(),
      fixture.exited,
    ])
    expect(exitCode).toBe(0)
    expect(stderr).toBe('')
    expect(JSON.parse(stdout.trim()).text.trim()).toBe(tmpDir)
  })

  it('fails closed when Bubblewrap is unavailable', async () => {
    if (process.platform !== 'linux') return
    const previous = process.env.BWRAP_PATH
    process.env.BWRAP_PATH = '/aster-test/missing-bwrap'
    try {
      const result = await exec({ command: 'echo must-not-run' })
      expect(result.isError).toBe(true)
      expect(result.text).toContain('refusing to run unsandboxed')
      expect(result.text).not.toContain('must-not-run')
    } finally {
      if (previous === undefined) delete process.env.BWRAP_PATH
      else process.env.BWRAP_PATH = previous
    }
  })

  it('rejects a filesystem-root workspace', async () => {
    if (process.platform !== 'linux') return
    const rootTool = createBashTool('/')
    // biome-ignore lint/suspicious/noExplicitAny: test helper
    const result = await (rootTool as any).execute({
      command: 'echo must-not-run',
    })
    expect(result.isError).toBe(true)
    expect(result.text).toContain('filesystem root')
    expect(result.text).not.toContain('must-not-run')
  })
})
