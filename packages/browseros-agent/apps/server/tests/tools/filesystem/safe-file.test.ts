import { afterEach, beforeEach, describe, expect, it } from 'bun:test'
import { constants } from 'node:fs'
import {
  mkdir,
  open,
  readFile,
  rename,
  rm,
  symlink,
  writeFile,
} from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { resolveWorkspacePath } from '../../../src/tools/filesystem/path-boundary'
import {
  openExistingFileBeneath,
  openRelativeWithOpenAt2,
  openWorkspaceRoot,
  pinWorkspaceRoot,
  readFileBeneath,
  writeAtStart,
  writeFileBeneath,
} from '../../../src/tools/filesystem/safe-file'

let root: string
let outside: string

beforeEach(async () => {
  const suffix = `${Date.now()}-${Math.random().toString(36).slice(2)}`
  root = join(tmpdir(), `safe-file-root-${suffix}`)
  outside = join(tmpdir(), `safe-file-outside-${suffix}`)
  await mkdir(root, { recursive: true })
  await mkdir(outside, { recursive: true })
})

afterEach(async () => {
  await rm(root, { recursive: true, force: true })
  await rm(outside, { recursive: true, force: true })
})

describe('descriptor-anchored filesystem access', () => {
  if (process.platform === 'linux') {
    it('keeps the selected workspace inode after its pathname is replaced', async () => {
      const selectedPath = root
      const movedPath = `${root}-selected-inode`
      await writeFile(join(selectedPath, 'value.txt'), 'selected inode')
      const pinned = await pinWorkspaceRoot(selectedPath)

      try {
        await rename(selectedPath, movedPath)
        await mkdir(selectedPath)
        await writeFile(join(selectedPath, 'value.txt'), 'replacement inode')

        const original = await readFileBeneath(
          pinned.path,
          join(pinned.path, 'value.txt'),
          undefined,
          pinned.handle,
        )
        expect(original.toString('utf-8')).toBe('selected inode')
        expect(await readFile(join(selectedPath, 'value.txt'), 'utf-8')).toBe(
          'replacement inode',
        )
      } finally {
        await pinned.close()
        await rm(movedPath, { recursive: true, force: true })
      }
    })

    it('waits for active tool work before closing the pinned descriptor', async () => {
      const pinned = await pinWorkspaceRoot(root)
      let finishOperation: (() => void) | undefined
      const operation = pinned.run(
        () => new Promise<void>((resolve) => (finishOperation = resolve)),
      )
      let closed = false
      const closing = pinned.close().then(() => {
        closed = true
      })
      await Promise.resolve()
      expect(closed).toBe(false)
      finishOperation?.()
      await Promise.all([operation, closing])
      expect(closed).toBe(true)
      await expect(pinned.run(async () => undefined)).rejects.toThrow(
        'Workspace session is closing',
      )
    })

    it('rejects a parent moved outside before the atomic leaf open', async () => {
      const checkedDir = join(root, 'checked')
      await mkdir(checkedDir)
      await writeFile(join(checkedDir, 'file.txt'), 'inside')
      await writeFile(join(outside, 'file.txt'), 'outside')
      const rootHandle = await open(
        root,
        constants.O_RDONLY | constants.O_DIRECTORY,
      )
      try {
        const validated = await resolveWorkspacePath(root, 'checked/file.txt')
        await rename(checkedDir, join(outside, 'moved'))
        await symlink(join(outside, 'moved'), checkedDir)

        expect(() =>
          openRelativeWithOpenAt2(
            rootHandle.fd,
            'checked/file.txt',
            constants.O_RDONLY,
          ),
        ).toThrow()
        await expect(readFileBeneath(root, validated)).rejects.toThrow()
        expect(
          await readFile(join(outside, 'moved', 'file.txt'), 'utf-8'),
        ).toBe('inside')
        expect(await readFile(join(outside, 'file.txt'), 'utf-8')).toBe(
          'outside',
        )
      } finally {
        await rootHandle.close()
      }
    })

    it('rejects an intermediate root parent replaced by an outside symlink', async () => {
      const parent = join(
        tmpdir(),
        `safe-file-parent-${Date.now()}-${Math.random()}`,
      )
      const movedParent = `${parent}-moved`
      const workspace = join(parent, 'workspace')
      const outsideWorkspace = join(outside, 'workspace')
      await mkdir(workspace, { recursive: true })
      await mkdir(outsideWorkspace)
      await writeFile(join(workspace, 'secret.txt'), 'inside')
      await writeFile(join(outsideWorkspace, 'secret.txt'), 'outside')
      root = workspace

      try {
        await rename(parent, movedParent)
        await symlink(outside, parent)

        await expect(
          readFileBeneath(root, join(root, 'secret.txt')),
        ).rejects.toThrow()
        await expect(
          writeFileBeneath(root, join(root, 'secret.txt'), 'changed'),
        ).rejects.toThrow()
        expect(
          await readFile(join(outsideWorkspace, 'secret.txt'), 'utf-8'),
        ).toBe('outside')
      } finally {
        await rm(parent, { recursive: true, force: true })
        await rename(movedParent, parent)
        await rm(parent, { recursive: true, force: true })
      }
    })

    it('keeps descriptor I/O attached to the inode opened while in-root', async () => {
      const dir = join(root, 'pinned')
      const filePath = join(dir, 'file.txt')
      await mkdir(dir)
      await writeFile(filePath, 'original')
      const validated = await resolveWorkspacePath(root, 'pinned/file.txt')
      const file = await openExistingFileBeneath(
        root,
        validated,
        constants.O_RDWR,
      )

      await rename(dir, join(outside, 'moved'))
      try {
        expect((await file.readFile()).toString('utf-8')).toBe('original')
        await file.truncate(0)
        await writeAtStart(file, 'changed through pinned fd')
      } finally {
        await file.close()
      }
      expect(await readFile(join(outside, 'moved', 'file.txt'), 'utf-8')).toBe(
        'changed through pinned fd',
      )
    })

    it('keeps root-relative access attached to the pinned workspace after rename', async () => {
      await writeFile(join(root, 'file.txt'), 'authorized workspace')
      const rootHandle = await openWorkspaceRoot(root)
      try {
        await rename(root, join(outside, 'moved-root'))
        await symlink(outside, root)
        expect(
          (
            await readFileBeneath(
              root,
              join(root, 'file.txt'),
              undefined,
              rootHandle,
            )
          ).toString('utf-8'),
        ).toBe('authorized workspace')
      } finally {
        await rootHandle.close()
      }
    })

    it('rejects a final symlink before writing and leaves its target unchanged', async () => {
      const target = join(outside, 'secret.txt')
      await writeFile(target, 'secret')
      await symlink(target, join(root, 'victim.txt'))

      await expect(
        writeFileBeneath(root, join(root, 'victim.txt'), 'changed'),
      ).rejects.toThrow()
      expect(await readFile(target, 'utf-8')).toBe('secret')
    })

    it('rejects a parent replaced after path validation without writing outside', async () => {
      const checkedDir = join(root, 'checked')
      const target = join(checkedDir, 'file.txt')
      await mkdir(checkedDir)
      await writeFile(target, 'inside')
      await writeFile(join(outside, 'file.txt'), 'outside')
      const validated = await resolveWorkspacePath(root, 'checked/file.txt')

      await rename(checkedDir, join(root, 'moved'))
      await symlink(outside, checkedDir)

      await expect(readFileBeneath(root, validated)).rejects.toThrow()
      await expect(
        writeFileBeneath(root, validated, 'changed'),
      ).rejects.toThrow()
      expect(await readFile(join(outside, 'file.txt'), 'utf-8')).toBe('outside')
    })
  }

  it('creates nested files through the pinned workspace directory', async () => {
    const target = join(root, 'nested', 'deeper', 'file.txt')
    await writeFileBeneath(root, target, 'safe')
    expect(await readFile(target, 'utf-8')).toBe('safe')
    expect((await readFileBeneath(root, target)).toString('utf-8')).toBe('safe')
  })

  it('reads and writes content larger than one syscall chunk', async () => {
    const target = join(root, 'large.bin')
    const content = 'λ'.repeat(150_000)
    await writeFileBeneath(root, target, content)
    expect((await readFileBeneath(root, target)).toString('utf-8')).toBe(
      content,
    )
  })

  if (process.platform === 'linux') {
    it('enforces maxBytes when the opened file grows before the descriptor read', async () => {
      const target = join(root, 'growing.bin')
      await writeFile(target, 'small')
      const file = await openExistingFileBeneath(
        root,
        target,
        constants.O_RDONLY,
        8,
      )
      try {
        await writeFile(target, 'this file grew beyond the read limit')
        await expect(file.readFile(8)).rejects.toThrow(
          'File exceeds the permitted read size.',
        )
      } finally {
        await file.close()
      }
    })
  }
})
