import { dlopen, FFIType, type Pointer, ptr, toArrayBuffer } from 'bun:ffi'
import type { Dirent, Stats } from 'node:fs'
import { constants } from 'node:fs'
import {
  type FileHandle,
  lstat,
  mkdir,
  open,
  readdir,
  realpath,
  stat,
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

function assertDescriptorWalkSupported(): void {
  if (process.platform === 'win32' || constants.O_NOFOLLOW === undefined) {
    throw new Error(
      'Race-safe workspace access is unavailable on this platform.',
    )
  }
}

function fdPath(fd: number, child = ''): string {
  assertDescriptorWalkSupported()
  return child ? `/dev/fd/${fd}/${child}` : `/dev/fd/${fd}`
}

/** Walks every component from an open directory so renamed/replaced parents cannot redirect access. */
export async function openPosixRelative(
  root: SafeFileHandle,
  relativePath: string,
  flags: number,
  mode = 0,
  createParents = false,
): Promise<SafeFileHandle> {
  assertDescriptorWalkSupported()
  const components = relativePath
    .split(sep)
    .filter((part) => part && part !== '.')
  if (components.some((part) => part === '..')) {
    throw new Error('Path is outside the selected workspace.')
  }
  if (components.length === 0) {
    if (flags & constants.O_DIRECTORY) {
      return new NodeFileHandle(
        await open(fdPath(root.fd), constants.O_RDONLY | constants.O_DIRECTORY),
      )
    }
    throw new Error('Path does not identify a regular file.')
  }

  let directory = root
  const ownedDirectories: SafeFileHandle[] = []
  try {
    for (const component of components.slice(0, -1)) {
      const anchoredPath = fdPath(directory.fd, component)
      let next: FileHandle
      try {
        next = await open(
          anchoredPath,
          constants.O_RDONLY | constants.O_DIRECTORY | constants.O_NOFOLLOW,
        )
      } catch (error) {
        if (
          !createParents ||
          !(error instanceof Error) ||
          !('code' in error) ||
          (error as NodeJS.ErrnoException).code !== 'ENOENT'
        ) {
          throw error
        }
        try {
          await mkdir(anchoredPath)
        } catch (mkdirError) {
          if (
            !(mkdirError instanceof Error) ||
            !('code' in mkdirError) ||
            (mkdirError as NodeJS.ErrnoException).code !== 'EEXIST'
          ) {
            throw mkdirError
          }
        }
        next = await open(
          anchoredPath,
          constants.O_RDONLY | constants.O_DIRECTORY | constants.O_NOFOLLOW,
        )
      }
      directory = new NodeFileHandle(next)
      ownedDirectories.push(directory)
    }
    const leafPath = fdPath(directory.fd, components.at(-1))
    // O_NOFOLLOW prevents symlink substitution, but portable POSIX cannot
    // atomically require the opened inode to be regular. Keep fallback opens
    // nonblocking (and prevent a tty from becoming the process control tty)
    // so a raced FIFO cannot hang the caller. The descriptor is still checked
    // with fstat before any file contents are consumed or modified.
    return new NodeFileHandle(
      await open(
        leafPath,
        flags |
          constants.O_NOFOLLOW |
          constants.O_NONBLOCK |
          (constants.O_NOCTTY ?? 0),
        mode,
      ),
    )
  } finally {
    for (const handle of ownedDirectories.reverse()) await handle.close()
  }
}

async function openPosixDirectoryPath(path: string): Promise<SafeFileHandle> {
  assertDescriptorWalkSupported()
  if (!isAbsolute(path)) throw new Error('Workspace root must be absolute.')
  let directory = new NodeFileHandle(
    await open('/', constants.O_RDONLY | constants.O_DIRECTORY),
  )
  try {
    for (const component of path.split(sep).filter(Boolean)) {
      const next = new NodeFileHandle(
        await open(
          fdPath(directory.fd, component),
          constants.O_RDONLY | constants.O_DIRECTORY | constants.O_NOFOLLOW,
        ),
      )
      await directory.close()
      directory = next
    }
    return directory
  } catch (error) {
    await directory.close()
    throw error
  }
}

export async function lstatPosixRelative(
  root: SafeFileHandle,
  relativePath: string,
): Promise<Stats> {
  assertDescriptorWalkSupported()
  const components = relativePath
    .split(sep)
    .filter((part) => part && part !== '.')
  if (components.some((part) => part === '..')) {
    throw new Error('Path is outside the selected workspace.')
  }
  if (components.length === 0) return await stat(fdPath(root.fd))
  let directory = root
  const ownedDirectories: SafeFileHandle[] = []
  try {
    for (const component of components.slice(0, -1)) {
      directory = new NodeFileHandle(
        await open(
          fdPath(directory.fd, component),
          constants.O_RDONLY | constants.O_DIRECTORY | constants.O_NOFOLLOW,
        ),
      )
      ownedDirectories.push(directory)
    }
    return (await lstat(fdPath(directory.fd, components.at(-1)))) as Stats
  } finally {
    for (const handle of ownedDirectories.reverse()) await handle.close()
  }
}

async function assertPosixRegularEntry(
  root: SafeFileHandle,
  relativePath: string,
): Promise<void> {
  const info = await lstatPosixRelative(root, relativePath)
  if (!info.isFile()) {
    throw new Error('Path does not identify a regular file.')
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
  return await openPosixDirectoryPath(root)
}

/** Opens the selected directory itself and derives its display path from that descriptor. */
export async function pinWorkspaceRoot(
  cwd: string,
): Promise<PinnedWorkspaceRoot> {
  if (process.platform !== 'linux') {
    assertDescriptorWalkSupported()
    const canonical = await realpath(cwd)
    const handle = await openPosixDirectoryPath(canonical)
    try {
      return new WorkspaceRootPin(await realpath(fdPath(handle.fd)), handle)
    } catch (error) {
      await handle.close()
      throw error
    }
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
    if (process.platform === 'linux') {
      return openRelativeWithOpenAt2(pinnedRoot.fd, relativePath, flags, mode)
    }
    return await openPosixRelative(pinnedRoot, relativePath, flags, mode)
  }
  if (process.platform !== 'linux') {
    const rootHandle = await openWorkspaceRoot(root)
    try {
      return await openPosixRelative(rootHandle, relativePath, flags, mode)
    } finally {
      await rootHandle.close()
    }
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
    const rootHandle = pinnedRoot ?? (await openWorkspaceRoot(root))
    const ownsRoot = !pinnedRoot
    try {
      return await lstatPosixRelative(rootHandle, relativeTarget(root, target))
    } catch {
      return null
    } finally {
      if (ownsRoot) await rootHandle.close()
    }
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
    const directory = await openRootRelative(
      root,
      target,
      constants.O_RDONLY | constants.O_DIRECTORY,
      0,
      pinnedRoot,
    )
    try {
      const entries = (await readdir(fdPath(directory.fd), {
        withFileTypes: true,
      })) as Dirent[]
      const visible: WorkspaceDirectoryEntry[] = []
      for (const entry of entries) {
        const path = fdPath(directory.fd, entry.name)
        const info = await lstat(path).catch(() => null)
        if (!info) continue
        visible.push({
          name: entry.name,
          isDirectory: info.isDirectory(),
          isSymbolicLink: info.isSymbolicLink(),
          size: info.size,
        })
      }
      return visible
    } finally {
      await directory.close()
    }
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
    const relativePath = relativeTarget(root, target)
    const rootHandle = pinnedRoot ?? (await openWorkspaceRoot(root))
    const ownsRoot = !pinnedRoot
    let file: SafeFileHandle | undefined
    try {
      // This rejects existing special files before opening them. A portable
      // POSIX open-by-fd primitive cannot make this check atomic with open.
      await assertPosixRegularEntry(rootHandle, relativePath)
      file = await openPosixRelative(rootHandle, relativePath, flags)
      const fileStat = await stat(fdPath(file.fd))
      if (!fileStat.isFile()) {
        throw new Error('Path does not identify a regular file.')
      }
      if (maxBytes !== undefined && fileStat.size > maxBytes) {
        throw new Error('File exceeds the permitted read size.')
      }
      const result = file
      file = undefined
      return result
    } finally {
      await file?.close()
      if (ownsRoot) await rootHandle.close()
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
    const relativePath = relativeTarget(root, target)
    const rootHandle = pinnedRoot ?? (await openWorkspaceRoot(root))
    const ownsRoot = !pinnedRoot
    let file: SafeFileHandle | undefined
    try {
      try {
        await assertPosixRegularEntry(rootHandle, relativePath)
      } catch (error) {
        if (
          !(error instanceof Error) ||
          !('code' in error) ||
          (error as NodeJS.ErrnoException).code !== 'ENOENT'
        ) {
          throw error
        }
      }
      try {
        file = await openPosixRelative(
          rootHandle,
          relativePath,
          constants.O_WRONLY | constants.O_NONBLOCK,
          0,
          true,
        )
      } catch (error) {
        if (
          !(error instanceof Error) ||
          !('code' in error) ||
          (error as NodeJS.ErrnoException).code !== 'ENOENT'
        ) {
          throw error
        }
        file = await openPosixRelative(
          rootHandle,
          relativePath,
          constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL,
          0o666,
          true,
        )
      }
      const info = await stat(fdPath(file.fd))
      if (!info.isFile()) {
        throw new Error('Path does not identify a regular file.')
      }
      await file.truncate(0)
      await file.writeAtStart(content)
    } finally {
      await file?.close()
      if (ownsRoot) await rootHandle.close()
    }
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
