export type DownloadProgressRow = {
  id: number
  filename: string
  state: string
  receivedBytes: number
  totalBytes: number
  paused: boolean
  canResume: boolean
  error?: string
  incognito: boolean
}

export type DownloadAction = 'pause' | 'resume' | 'cancel'

type DownloadControlItem = {
  id: number
  filename?: string
  state?: string
  bytesReceived?: number
  totalBytes?: number
  paused?: boolean
  canResume?: boolean
  error?: string
  incognito?: boolean
}

export async function performDownloadAction(
  api: {
    search: (query: { id: number }) => Promise<DownloadControlItem[]>
    pause: (id: number) => Promise<void>
    resume: (id: number) => Promise<void>
    cancel: (id: number) => Promise<void>
  },
  getCurrentWindow: () => Promise<{ incognito?: boolean }>,
  privateWindow: boolean,
  id: number,
  action: DownloadAction,
): Promise<DownloadControlItem | null> {
  if (privateWindow) throw new Error('Downloads are hidden in private windows.')
  let currentWindow: { incognito?: boolean }
  try {
    currentWindow = await getCurrentWindow()
  } catch {
    throw new Error(
      'Could not verify the active window. Reopen Downloads from a regular window and retry.',
    )
  }
  if (currentWindow.incognito !== false)
    throw new Error('Downloads are hidden in private windows.')
  let item: DownloadControlItem | undefined
  try {
    ;[item] = await api.search({ id })
  } catch {
    throw new Error(
      'Could not verify this download. Refresh Downloads and retry.',
    )
  }
  if (!item) throw new Error('This download is no longer available.')
  if (item.incognito !== false)
    throw new Error('Private-window downloads cannot be controlled here.')
  if (
    !canControlDownload(
      {
        state: item.state || 'in_progress',
        paused: Boolean(item.paused),
        canResume: Boolean(item.canResume),
        incognito: Boolean(item.incognito),
      },
      action,
    )
  ) {
    throw new Error(
      action === 'pause'
        ? 'This download is no longer running.'
        : action === 'resume'
          ? 'This download cannot be resumed by the browser.'
          : 'This download can no longer be canceled.',
    )
  }
  try {
    await api[action](id)
  } catch {
    throw new Error(
      `The browser could not ${action} this download. Refresh Downloads to check its current state.`,
    )
  }
  let updated: DownloadControlItem | undefined
  try {
    ;[updated] = await api.search({ id })
  } catch {
    throw new Error(
      'The browser could not confirm the download update. Refresh Downloads to check its current state.',
    )
  }
  if (!updated && action === 'cancel') return null
  if (updated?.incognito !== false)
    throw new Error('The download ended or became unavailable.')
  return updated
}

export function canControlDownload(
  item: Pick<
    DownloadProgressRow,
    'state' | 'paused' | 'canResume' | 'incognito'
  >,
  action: DownloadAction,
): boolean {
  if (item.incognito !== false) return false
  if (action === 'pause') return item.state === 'in_progress' && !item.paused
  if (action === 'resume')
    return (
      (item.state === 'in_progress' && item.paused) ||
      (item.state === 'interrupted' && item.canResume)
    )
  return item.state === 'in_progress'
}

export function downloadFailureMessage(error?: string): string | undefined {
  if (!error) return undefined
  const known: Record<string, string> = {
    FILE_ACCESS_DENIED: 'The browser cannot access the download file.',
    FILE_BLOCKED: 'The browser blocked this download.',
    FILE_FAILED: 'The browser could not save this file.',
    FILE_TRANSIENT_ERROR: 'A temporary file error stopped this download.',
    FILE_NO_SPACE: 'There is not enough disk space to continue this download.',
    FILE_NAME_TOO_LONG: 'The download filename is too long.',
    FILE_TOO_LARGE: 'The download is too large for this file system.',
    FILE_VIRUS_INFECTED: 'The browser blocked this file as unsafe.',
    NETWORK_FAILED: 'The network connection failed.',
    NETWORK_TIMEOUT: 'The download timed out.',
    SERVER_FAILED: 'The server failed while sending this download.',
    SERVER_UNAUTHORIZED: 'The server no longer authorizes this download.',
    SERVER_FORBIDDEN: 'The server denied this download.',
    SERVER_CERT_PROBLEM: 'The server certificate prevented this download.',
    USER_CANCELED: 'This download was canceled.',
    USER_SHUTDOWN: 'The browser closed before this download finished.',
  }
  return known[error] || 'The browser reported a download error.'
}

export type DownloadProgressUpdate = Partial<DownloadProgressRow> & {
  id: number
}

const MAX_DOWNLOAD_ROWS = 8

export function createPendingDownloadUpdates() {
  let pending = true
  const updates = new Map<number, DownloadProgressUpdate>()
  return {
    add(update: DownloadProgressUpdate) {
      if (!pending) return
      const previous = updates.get(update.id)
      updates.delete(update.id)
      updates.set(update.id, { ...previous, ...update })
      if (updates.size > MAX_DOWNLOAD_ROWS) {
        const oldestId = updates.keys().next().value
        if (oldestId !== undefined) updates.delete(oldestId)
      }
    },
    settle() {
      if (!pending) return []
      pending = false
      const settledUpdates = [...updates.values()]
      updates.clear()
      return settledUpdates
    },
    get size() {
      return updates.size
    },
  }
}

type DeltaValue<T> = { current?: T }

export function downloadUpdateFromDelta(delta: {
  id: number
  filename?: DeltaValue<string>
  state?: DeltaValue<string>
  totalBytes?: DeltaValue<number>
  bytesReceived?: DeltaValue<number>
}): DownloadProgressUpdate {
  return {
    id: delta.id,
    ...(delta.filename?.current !== undefined && {
      filename: delta.filename.current,
    }),
    ...(delta.state?.current !== undefined && { state: delta.state.current }),
    ...(delta.totalBytes?.current !== undefined && {
      totalBytes: delta.totalBytes.current,
    }),
    ...(delta.bytesReceived?.current !== undefined && {
      receivedBytes: delta.bytesReceived.current,
    }),
  }
}

export function downloadBasename(path: string | undefined): string {
  const basename = (path || '').split(/[\\/]/).filter(Boolean).at(-1)
  return basename && basename !== '.' && basename !== '..'
    ? basename
    : 'Download'
}

export function downloadRowFromItem(item: {
  id: number
  filename?: string
  state?: string
  bytesReceived?: number
  totalBytes?: number
  paused?: boolean
  canResume?: boolean
  error?: string
  incognito?: boolean
}): DownloadProgressRow {
  return {
    id: item.id,
    filename: downloadBasename(item.filename),
    state: item.state || 'in_progress',
    receivedBytes: item.bytesReceived || 0,
    totalBytes: item.totalBytes || 0,
    paused: Boolean(item.paused),
    canResume: Boolean(item.canResume),
    error: item.error,
    incognito: item.incognito !== false,
  }
}

export function mergeDownloadUpdate(
  rows: DownloadProgressRow[],
  update: DownloadProgressUpdate,
): DownloadProgressRow[] {
  const existing = rows.find((row) => row.id === update.id)
  const next: DownloadProgressRow = {
    ...existing,
    ...update,
    id: update.id,
    filename: update.filename
      ? downloadBasename(update.filename)
      : existing?.filename || 'Download',
    state: update.state || existing?.state || 'in_progress',
    receivedBytes: update.receivedBytes ?? existing?.receivedBytes ?? 0,
    totalBytes: update.totalBytes ?? existing?.totalBytes ?? 0,
    paused: update.paused ?? existing?.paused ?? false,
    canResume: update.canResume ?? existing?.canResume ?? false,
    error: Object.hasOwn(update, 'error') ? update.error : existing?.error,
    incognito:
      update.incognito === false ? false : (existing?.incognito ?? true),
  }
  if (existing) {
    return rows.map((row) => (row.id === update.id ? next : row))
  }
  return [next, ...rows].slice(0, MAX_DOWNLOAD_ROWS)
}

export function mergeDownloadSnapshot(
  snapshot: DownloadProgressRow[],
  updates: DownloadProgressUpdate[],
): DownloadProgressRow[] {
  const rows = snapshot.slice(0, MAX_DOWNLOAD_ROWS)
  for (const update of updates) {
    const index = rows.findIndex((row) => row.id === update.id)
    const existing = index < 0 ? undefined : rows[index]
    const next = {
      ...existing,
      ...update,
      id: update.id,
      filename: update.filename
        ? downloadBasename(update.filename)
        : existing?.filename || 'Download',
      state: update.state || existing?.state || 'in_progress',
      receivedBytes: update.receivedBytes ?? existing?.receivedBytes ?? 0,
      totalBytes: update.totalBytes ?? existing?.totalBytes ?? 0,
      paused: update.paused ?? existing?.paused ?? false,
      canResume: update.canResume ?? existing?.canResume ?? false,
      error: Object.hasOwn(update, 'error') ? update.error : existing?.error,
      incognito:
        update.incognito === false ? false : (existing?.incognito ?? true),
    }
    if (index < 0) rows.unshift(next)
    else rows[index] = next
    rows.length = Math.min(rows.length, MAX_DOWNLOAD_ROWS)
  }
  return rows
}
