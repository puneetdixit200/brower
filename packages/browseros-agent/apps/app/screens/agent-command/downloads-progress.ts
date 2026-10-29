export type DownloadProgressRow = {
  id: number
  filename: string
  state: string
  receivedBytes: number
  totalBytes: number
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
}): DownloadProgressRow {
  return {
    id: item.id,
    filename: downloadBasename(item.filename),
    state: item.state || 'in_progress',
    receivedBytes: item.bytesReceived || 0,
    totalBytes: item.totalBytes || 0,
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
    }
    if (index < 0) rows.unshift(next)
    else rows[index] = next
    rows.length = Math.min(rows.length, MAX_DOWNLOAD_ROWS)
  }
  return rows
}
