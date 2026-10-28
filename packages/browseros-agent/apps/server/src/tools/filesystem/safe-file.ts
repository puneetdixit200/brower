import { dlopen, FFIType, type Pointer, ptr, toArrayBuffer } from 'bun:ffi'
import type { Dirent } from 'node:fs'
import { constants } from 'node:fs'
import {
  type FileHandle,
  mkdir,
  open,
  readdir,
  realpath,
  stat,
  writeFile,
} from 'node:fs/promises'
import { dirname, isAbsolute, join, relative, sep } from 'node:path'
import { isPathInside } from './path-boundary'

const RESOLVE_NO_MAGICLINKS = 0x02n
const RESOLVE_NO_SYMLINKS = 0x04n
const RESOLVE_BENEATH = 0x08n
const OPEN_HOW_SIZE = 24n
const LINUX_OPENAT2_SYSCALL = 437n
const LINUX_O_CLOEXEC = 0x80000
const LINUX_O_PATH = 0x200000
const IO_CHUNK_SIZE = 64 * 1024

type LinuxLibc = {
  symbols: {
    syscall: (
      number: bigint,
      rootFd: bigint,
      path: Pointer,
      how: Pointer,
      size: bigint,
    ) => bigint
    mkdirat: (directoryFd: number, path: Pointer, mode: number) => number
    close: (fd: number) => number
    read: (fd: number, buffer: Pointer, size: bigint) => bigint
    write: (fd: number, buffer: Pointer, size: bigint) => bigint
    lseek: (fd: number, offset: bigint, whence: number) => bigint
    ftruncate: (fd: number, length: bigint) => number
    __errno_location: () => Pointer | null
  }
}

const linuxLibcSymbols = {
  syscall: {
    args: [FFIType.i64, FFIType.i64, FFIType.ptr, FFIType.ptr, FFIType.i64],
    returns: FFIType.i64,
  },
  mkdirat: {
    args: [FFIType.i32, FFIType.ptr, FFIType.u32],
    returns: FFIType.i32,
  },
  close: { args: [FFIType.i32], returns: FFIType.i32 },
  read: { args: [FFIType.i32, FFIType.ptr, FFIType.u64], returns: FFIType.i64 },
  write: {
    args: [FFIType.i32, FFIType.ptr, FFIType.u64],
    returns: FFIType.i64,
  },
  lseek: {
    args: [FFIType.i32, FFIType.i64, FFIType.i32],
    returns: FFIType.i64,
  },
  ftruncate: { args: [FFIType.i32, FFIType.i64], returns: FFIType.i32 },
  __errno_location: { args: [], returns: FFIType.ptr },
} as const

let libc: LinuxLibc | undefined

function getLibc(): LinuxLibc {
  if (!libc) {
    libc = dlopen('libc.so.6', linuxLibcSymbols) as unknown as LinuxLibc
  }
  return libc
}

function getErrno(): number {
  const ptr = getLibc().symbols.__errno_location()
  if (ptr === null) throw new Error('Unable to read Linux errno.')
  return new DataView(toArrayBuffer(ptr, 0, 4)).getInt32(0, true)
}

const errnoCodes: Record<number, string> = {
  2: 'ENOENT',
  4: 'EINTR',
  5: 'EIO',
  9: 'EBADF',
  11: 'EAGAIN',
  12: 'ENOMEM',
  13: 'EACCES',
  17: 'EEXIST',
  18: 'EXDEV',
  20: 'ENOTDIR',
  21: 'EISDIR',
  22: 'EINVAL',
  24: 'EMFILE',
  28: 'ENOSPC',
  30: 'EROFS',
  36: 'ENAMETOOLONG',
  40: 'ELOOP',
  95: 'EOPNOTSUPP',
  116: 'ESTALE',
  125: 'ECANCELED',
}

function syscallError(
  operation: string,
  path?: string,
  observedErrno = getErrno(),
): NodeJS.ErrnoException {
  const errno = observedErrno
  const code = errnoCodes[errno] ?? `ERRNO_${errno}`
  const error = new Error(
    `${operation}${path ? ` '${path}'` : ''} failed: ${code}`,
  ) as NodeJS.ErrnoException
  error.code = code
  error.errno = -errno
  error.syscall = operation
  error.path = path
  return error
}

function assertLinux(): void {
  if (process.platform !== 'linux') {
    throw new Error('openat2 filesystem access is only available on Linux.')
  }
}

function relativeTarget(root: string, target: string): string {
  const path = relative(root, target)
  if (path === '') return '.'
  if (
    path === '' ||
    isAbsolute(path) ||
    path === '..' ||
    path.startsWith(`..${sep}`)
  ) {
    throw new Error('Path is outside the selected workspace.')
  }
  return path
}

function openAt2(
  rootFd: number,
  path: string,
  flags: number,
  mode = 0,
): number {
  assertLinux()
  const pathBytes = Buffer.from(`${path}\0`)
  const how = new BigUint64Array([
    BigInt(flags),
    BigInt(mode),
    RESOLVE_BENEATH | RESOLVE_NO_SYMLINKS | RESOLVE_NO_MAGICLINKS,
  ])
  let result: bigint
  while (true) {
    result = getLibc().symbols.syscall(
      LINUX_OPENAT2_SYSCALL,
      BigInt(rootFd),
      ptr(pathBytes),
      ptr(how),
      OPEN_HOW_SIZE,
    )
    if (result >= 0n) break
    const errno = getErrno()
    if (errno !== 4) throw syscallError('openat2', path, errno)
  }
  return Number(result)
}

function closeFd(fd: number): void {
  if (getLibc().symbols.close(fd) !== 0) {
    throw syscallError('close')
  }
}

export interface SafeFileHandle {
  readonly fd: number
  readFile(maxBytes?: number): Promise<Buffer>
  truncate(length?: number): Promise<void>
  writeAtStart(content: string): Promise<void>
  close(): Promise<void>
}

/** A workspace directory captured when an agent session is created. */
export interface PinnedWorkspaceRoot {
  readonly path: string
  readonly handle: SafeFileHandle
  run<T>(operation: () => Promise<T>): Promise<T>
  close(): Promise<void>
}

class WorkspaceRootPin implements PinnedWorkspaceRoot {
  private activeOperations = 0
  private closing = false
  private drained: Promise<void> | undefined
  private drain: (() => void) | undefined
  private closePromise: Promise<void> | undefined

  constructor(
    readonly path: string,
    readonly handle: SafeFileHandle,
  ) {}

  async run<T>(operation: () => Promise<T>): Promise<T> {
    if (this.closing) throw new Error('Workspace session is closing.')
    this.activeOperations++
    try {
      return await operation()
    } finally {
      this.activeOperations--
      if (this.closing && this.activeOperations === 0) this.drain?.()
    }
  }

  close(): Promise<void> {
    this.closePromise ??= this.closeWhenDrained()
    return this.closePromise
  }

  private async closeWhenDrained(): Promise<void> {
    this.closing = true
    if (this.activeOperations > 0) {
      this.drained ??= new Promise<void>((resolve) => {
        this.drain = resolve
      })
      await this.drained
    }
    await this.handle.close()
  }
}

class LinuxFileHandle implements SafeFileHandle {
  constructor(readonly fd: number) {}

  async readFile(maxBytes?: number): Promise<Buffer> {
    const chunks: Buffer[] = []
    let totalBytes = 0
    while (true) {
      const buffer = Buffer.allocUnsafe(IO_CHUNK_SIZE)
      const bytesRead = getLibc().symbols.read(
        this.fd,
        ptr(buffer),
        BigInt(buffer.byteLength),
      )
      if (bytesRead < 0n) {
        const errno = getErrno()
        if (errno === 4) continue
        throw syscallError('read', undefined, errno)
      }
      if (bytesRead === 0n) break
      totalBytes += Number(bytesRead)
      if (maxBytes !== undefined && totalBytes > maxBytes) {
        throw new Error('File exceeds the permitted read size.')
      }
      chunks.push(buffer.subarray(0, Number(bytesRead)))
    }
    return Buffer.concat(chunks)
  }

  async truncate(length = 0): Promise<void> {
    while (getLibc().symbols.ftruncate(this.fd, BigInt(length)) !== 0) {
      const errno = getErrno()
      if (errno !== 4) throw syscallError('ftruncate', undefined, errno)
    }
  }

  async writeAtStart(content: string): Promise<void> {
    const buffer = Buffer.from(content, 'utf-8')
    let position = getLibc().symbols.lseek(this.fd, 0n, 0)
    while (position < 0n) {
      const errno = getErrno()
      if (errno !== 4) throw syscallError('lseek', undefined, errno)
      position = getLibc().symbols.lseek(this.fd, 0n, 0)
    }

    let offset = 0
    while (offset < buffer.byteLength) {
      const chunk = buffer.subarray(offset, offset + IO_CHUNK_SIZE)
      const bytesWritten = getLibc().symbols.write(
        this.fd,
        ptr(chunk),
        BigInt(chunk.byteLength),
      )
      if (bytesWritten < 0n) {
        const errno = getErrno()
        if (errno === 4) continue
        throw syscallError('write', undefined, errno)
      }
      if (bytesWritten === 0n)
        throw new Error('Unable to finish filesystem write.')
      offset += Number(bytesWritten)
    }
  }

  async close(): Promise<void> {
    closeFd(this.fd)
  }
}

class NodeFileHandle implements SafeFileHandle {
  constructor(private readonly file: FileHandle) {}

  get fd(): number {
    return this.file.fd
  }

  async readFile(maxBytes?: number): Promise<Buffer> {
    if (maxBytes !== undefined) {
      const chunks: Buffer[] = []
      let totalBytes = 0
      while (true) {
        const buffer = Buffer.allocUnsafe(
          Math.min(IO_CHUNK_SIZE, maxBytes + 1 - totalBytes),
        )
        const { bytesRead } = await this.file.read(
          buffer,
          0,
          buffer.byteLength,
          null,
        )
        if (bytesRead === 0) break
        totalBytes += bytesRead
        if (totalBytes > maxBytes) {
          throw new Error('File exceeds the permitted read size.')
        }
        chunks.push(buffer.subarray(0, bytesRead))
      }
      return Buffer.concat(chunks)
    }
    return await this.file.readFile()
  }

  async truncate(length = 0): Promise<void> {
    await this.file.truncate(length)
  }

  async writeAtStart(content: string): Promise<void> {
    const buffer = Buffer.from(content, 'utf-8')
    let offset = 0
    while (offset < buffer.byteLength) {
      const { bytesWritten } = await this.file.write(
        buffer,
        offset,
        buffer.byteLength - offset,
        offset,
      )
      if (bytesWritten === 0) {
        throw new Error('Unable to finish filesystem write.')
      }
      offset += bytesWritten
    }
  }

  async close(): Promise<void> {
    await this.file.close()
  }
}

/** Opens one canonical workspace-relative path with a single atomic openat2 resolution on Linux. */
export function openRelativeWithOpenAt2(
  rootFd: number,
  relativePath: string,
  flags: number,
  mode = 0,
): SafeFileHandle {
  return new LinuxFileHandle(openAt2(rootFd, relativePath, flags, mode))
}

async function openRoot(root: string): Promise<SafeFileHandle> {
  const filesystemRoot = await open(
    '/',
    constants.O_RDONLY | constants.O_DIRECTORY | constants.O_NOFOLLOW,
  )
  try {
    const rootPath = relative('/', root) || '.'
    return openRelativeWithOpenAt2(
      filesystemRoot.fd,
      rootPath,
      constants.O_RDONLY | constants.O_DIRECTORY | LINUX_O_CLOEXEC,
    )
  } finally {
    await filesystemRoot.close()
  }
}

/** Pins a canonical workspace directory for the lifetime of one tool operation. */
export async function openWorkspaceRoot(root: string): Promise<SafeFileHandle> {
  if (process.platform === 'linux') return await openRoot(root)
  return new NodeFileHandle(
    await open(root, constants.O_RDONLY | constants.O_DIRECTORY),
  )
}

/** Opens the selected directory itself and derives its display path from that descriptor. */
export async function pinWorkspaceRoot(
  cwd: string,
): Promise<PinnedWorkspaceRoot> {
  if (process.platform !== 'linux') {
    const canonical = await realpath(cwd)
    return new WorkspaceRootPin(canonical, await openWorkspaceRoot(canonical))
  }

  const handle = new NodeFileHandle(
    await open(cwd, constants.O_RDONLY | constants.O_DIRECTORY),
  )
  try {
    const canonical = await realpath(`/proc/self/fd/${handle.fd}`)
    return new WorkspaceRootPin(canonical, handle)
  } catch (error) {
    await handle.close()
    throw error
  }
}

async function openRootRelative(
  root: string,
  target: string,
  flags: number,
  mode = 0,
  pinnedRoot?: SafeFileHandle,
): Promise<SafeFileHandle> {
  const relativePath = relativeTarget(root, target)
  if (pinnedRoot) {
    if (process.platform !== 'linux') {
      throw new Error('Pinned descriptor access is only available on Linux.')
    }
    return openRelativeWithOpenAt2(pinnedRoot.fd, relativePath, flags, mode)
  }
  const rootHandle = await openRoot(root)
  try {
    return openRelativeWithOpenAt2(rootHandle.fd, relativePath, flags, mode)
  } finally {
    await rootHandle.close()
  }
}

export async function statBeneath(
  root: string,
  target: string,
  pinnedRoot?: SafeFileHandle,
) {
  if (!isPathInside(root, target)) return null
  if (process.platform !== 'linux') {
    return await stat(target).catch(() => null)
  }
  let handle: SafeFileHandle | undefined
  try {
    handle = await openRootRelative(
      root,
      target,
      LINUX_O_PATH | LINUX_O_CLOEXEC,
      0,
      pinnedRoot,
    )
    return await stat(`/proc/self/fd/${handle.fd}`)
  } catch {
    return null
  } finally {
    await handle?.close()
  }
}

export interface WorkspaceDirectoryEntry {
  name: string
  isDirectory: boolean
  isSymbolicLink: boolean
  size: number
}

/** Enumerates one pinned directory and validates each reported entry by descriptor. */
export async function listDirectoryBeneath(
  root: string,
  target: string,
  pinnedRoot?: SafeFileHandle,
): Promise<WorkspaceDirectoryEntry[]> {
  if (!isPathInside(root, target)) {
    throw new Error('Path is outside the selected workspace.')
  }
  if (process.platform !== 'linux') {
    const entries = (await readdir(target, { withFileTypes: true })) as Dirent[]
    const visible: WorkspaceDirectoryEntry[] = []
    for (const entry of entries) {
      const path = join(target, entry.name)
      const info = await stat(path).catch(() => null)
      if (!info) continue
      visible.push({
        name: entry.name,
        isDirectory: info.isDirectory(),
        isSymbolicLink: entry.isSymbolicLink(),
        size: info.size,
      })
    }
    return visible
  }

  const directory = await openRootRelative(
    root,
    target,
    constants.O_RDONLY | constants.O_DIRECTORY | LINUX_O_CLOEXEC,
    0,
    pinnedRoot,
  )
  try {
    const entries = (await readdir(`/proc/self/fd/${directory.fd}`, {
      withFileTypes: true,
    })) as Dirent[]
    const visible: WorkspaceDirectoryEntry[] = []
    for (const entry of entries) {
      const child = join(target, entry.name)
      const canonical = entry.isSymbolicLink()
        ? await realpath(child).catch(() => null)
        : child
      if (!canonical || !isPathInside(root, canonical)) continue
      const info = await statBeneath(root, canonical, pinnedRoot)
      if (!info || (!info.isDirectory() && !info.isFile())) continue
      visible.push({
        name: entry.name,
        isDirectory: info.isDirectory(),
        isSymbolicLink: entry.isSymbolicLink(),
        size: info.size,
      })
    }
    return visible
  } finally {
    await directory.close()
  }
}

// biome-ignore lint/complexity/noExcessiveCognitiveComplexity: securely creates each directory through the pinned root descriptor
async function mkdirParentsBeneath(
  root: string,
  target: string,
  pinnedRoot?: SafeFileHandle,
): Promise<void> {
  const parentRel = relative(root, dirname(target))
  if (parentRel === '' || parentRel === '.') return
  const components = parentRel.split(sep)
  const rootHandle = pinnedRoot ?? (await openRoot(root))
  const ownsRoot = !pinnedRoot
  try {
    for (let index = 0; index < components.length; index++) {
      const prefix = components.slice(0, index + 1).join(sep)
      let directory: SafeFileHandle | undefined
      try {
        directory = openRelativeWithOpenAt2(
          rootHandle.fd,
          prefix,
          constants.O_RDONLY | constants.O_DIRECTORY | LINUX_O_CLOEXEC,
        )
      } catch (error) {
        if (
          !(error instanceof Error) ||
          !('code' in error) ||
          (error as NodeJS.ErrnoException).code !== 'ENOENT'
        ) {
          throw error
        }

        const parentPrefix = components.slice(0, index).join(sep) || '.'
        const parent =
          parentPrefix === '.'
            ? rootHandle
            : openRelativeWithOpenAt2(
                rootHandle.fd,
                parentPrefix,
                constants.O_RDONLY | constants.O_DIRECTORY | LINUX_O_CLOEXEC,
              )
        try {
          const leafBytes = Buffer.from(`${components[index]}\0`)
          while (
            getLibc().symbols.mkdirat(parent.fd, ptr(leafBytes), 0o777) !== 0
          ) {
            const errno = getErrno()
            if (errno === 4) continue
            const mkdirError = syscallError('mkdirat', prefix, errno)
            if (mkdirError.code !== 'EEXIST') throw mkdirError
            break
          }
        } finally {
          if (parent !== rootHandle) await parent.close()
        }
        directory = openRelativeWithOpenAt2(
          rootHandle.fd,
          prefix,
          constants.O_RDONLY | constants.O_DIRECTORY | LINUX_O_CLOEXEC,
        )
      } finally {
        await directory?.close()
      }
    }
  } finally {
    if (ownsRoot) await rootHandle.close()
  }
}

export async function readFileBeneath(
  root: string,
  target: string,
  maxBytes?: number,
  pinnedRoot?: SafeFileHandle,
): Promise<Buffer> {
  if (!isPathInside(root, target)) {
    throw new Error('Path is outside the selected workspace.')
  }
  const file = await openExistingFileBeneath(
    root,
    target,
    constants.O_RDONLY |
      constants.O_NONBLOCK |
      (process.platform === 'linux' ? LINUX_O_CLOEXEC : 0),
    maxBytes,
    pinnedRoot,
  )
  try {
    return await file.readFile(maxBytes)
  } finally {
    await file.close()
  }
}

/** Opens an existing regular file. Linux path resolution is one openat2 syscall. */
export async function openExistingFileBeneath(
  root: string,
  target: string,
  flags: number,
  maxBytes?: number,
  pinnedRoot?: SafeFileHandle,
): Promise<SafeFileHandle> {
  if (!isPathInside(root, target)) {
    throw new Error('Path is outside the selected workspace.')
  }
  if (process.platform !== 'linux') {
    const file = await open(target, flags)
    try {
      const fileStat = await file.stat()
      if (!fileStat.isFile()) {
        throw new Error('Path does not identify a regular file.')
      }
      if (maxBytes !== undefined && fileStat.size > maxBytes) {
        throw new Error('File exceeds the permitted read size.')
      }
      return new NodeFileHandle(file)
    } catch (error) {
      await file.close()
      throw error
    }
  }
  const file = await openRootRelative(
    root,
    target,
    flags | LINUX_O_CLOEXEC,
    0,
    pinnedRoot,
  )
  try {
    const descriptorStat = await stat(`/proc/self/fd/${file.fd}`)
    if (!descriptorStat.isFile()) {
      throw new Error('Path does not identify a regular file.')
    }
    if (maxBytes !== undefined && descriptorStat.size > maxBytes) {
      throw new Error('File exceeds the permitted read size.')
    }
    return file
  } catch (error) {
    await file.close()
    throw error
  }
}

export async function writeFileBeneath(
  root: string,
  target: string,
  content: string,
  pinnedRoot?: SafeFileHandle,
): Promise<void> {
  if (!isPathInside(root, target)) {
    throw new Error('Path is outside the selected workspace.')
  }
  if (process.platform !== 'linux') {
    await mkdir(dirname(target), { recursive: true })
    await writeFile(target, content, 'utf-8')
    return
  }

  await mkdirParentsBeneath(root, target, pinnedRoot)
  let file: SafeFileHandle
  try {
    file = await openRootRelative(
      root,
      target,
      constants.O_WRONLY | constants.O_NONBLOCK | LINUX_O_CLOEXEC,
      0,
      pinnedRoot,
    )
  } catch (error) {
    if (
      !(error instanceof Error) ||
      !('code' in error) ||
      (error as NodeJS.ErrnoException).code !== 'ENOENT'
    ) {
      throw error
    }
    file = await openRootRelative(
      root,
      target,
      constants.O_WRONLY |
        constants.O_CREAT |
        constants.O_EXCL |
        LINUX_O_CLOEXEC,
      0o666,
      pinnedRoot,
    )
  }
  try {
    if (!(await stat(`/proc/self/fd/${file.fd}`)).isFile()) {
      throw new Error('Path does not identify a regular file.')
    }
    await file.truncate(0)
    await file.writeAtStart(content)
  } finally {
    await file.close()
  }
}

export async function writeAtStart(
  file: SafeFileHandle,
  content: string,
): Promise<void> {
  await file.writeAtStart(content)
}
