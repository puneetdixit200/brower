import { describe, expect, it } from 'bun:test'
import {
  createPendingDownloadUpdates,
  downloadBasename,
  downloadRowFromItem,
  downloadUpdateFromDelta,
  mergeDownloadSnapshot,
  mergeDownloadUpdate,
} from './downloads-progress'

describe('downloads progress helpers', () => {
  it('inserts newest rows first, deduplicates IDs, and trims to eight', () => {
    let rows = Array.from({ length: 8 }, (_, index) => ({
      id: 8 - index,
      filename: `file-${8 - index}`,
      state: 'complete',
      receivedBytes: 1,
      totalBytes: 1,
    }))
    rows = mergeDownloadUpdate(rows, {
      id: 10,
      filename: '/tmp/new.txt',
      state: 'in_progress',
    })
    rows = mergeDownloadUpdate(rows, { id: 10, receivedBytes: 2 })
    rows = mergeDownloadUpdate(rows, { id: 8, receivedBytes: 3 })
    expect(rows).toHaveLength(8)
    expect(rows[0]).toMatchObject({
      id: 10,
      filename: 'new.txt',
      receivedBytes: 2,
      state: 'in_progress',
    })
    expect(rows.filter((row) => row.id === 10)).toHaveLength(1)
    expect(rows[1]).toMatchObject({ id: 8, receivedBytes: 3 })
    expect(rows.some((row) => row.id === 1)).toBe(false)
  })

  it('merges partial updates while preserving completed and interrupted states', () => {
    const base = downloadRowFromItem({
      id: 3,
      filename: 'C:\\Users\\person\\archive.zip',
      state: 'in_progress',
      bytesReceived: 5,
      totalBytes: 10,
    })
    const completed = mergeDownloadUpdate([base], {
      id: 3,
      state: 'complete',
      receivedBytes: 10,
    })
    expect(completed[0]).toMatchObject({
      filename: 'archive.zip',
      state: 'complete',
      receivedBytes: 10,
      totalBytes: 10,
    })
    expect(
      mergeDownloadUpdate(completed, { id: 3, state: 'interrupted' })[0]?.state,
    ).toBe('interrupted')
  })

  it('keeps event updates newer than an initial search snapshot', () => {
    const snapshot = [
      downloadRowFromItem({
        id: 22,
        filename: '/old/name.zip',
        state: 'in_progress',
        bytesReceived: 1,
        totalBytes: 100,
      }),
    ]
    const updates = [
      { id: 22, receivedBytes: 75 },
      {
        id: 23,
        filename: '/private/location/new.txt',
        state: 'complete',
      },
    ]
    expect(mergeDownloadSnapshot(snapshot, updates)).toEqual([
      {
        id: 23,
        filename: 'new.txt',
        state: 'complete',
        receivedBytes: 0,
        totalBytes: 0,
      },
      {
        id: 22,
        filename: 'name.zip',
        state: 'in_progress',
        receivedBytes: 75,
        totalBytes: 100,
      },
    ])
  })

  it('coalesces and caps pending updates, then clears and stops buffering', () => {
    const buffer = createPendingDownloadUpdates()
    buffer.add({ id: 1, filename: '/tmp/first.zip' })
    buffer.add({ id: 1, receivedBytes: 12 })
    for (let id = 2; id <= 8; id++) buffer.add({ id, state: 'in_progress' })
    expect(buffer.size).toBe(8)
    const settled = buffer.settle()
    expect(buffer.size).toBe(0)
    expect(settled).toHaveLength(8)
    expect(settled[0]).toEqual({
      id: 1,
      filename: '/tmp/first.zip',
      receivedBytes: 12,
    })
    expect(buffer.settle()).toEqual([])
    buffer.add({ id: 13, receivedBytes: 99 })
    expect(buffer.size).toBe(0)

    const bounded = createPendingDownloadUpdates()
    for (let id = 1; id <= 12; id++) bounded.add({ id, state: 'in_progress' })
    expect(bounded.size).toBe(8)
    expect(bounded.settle().map((update) => update.id)).toEqual([
      5, 6, 7, 8, 9, 10, 11, 12,
    ])
  })

  it('maps bytesReceived directly from a change delta', () => {
    expect(
      downloadUpdateFromDelta({
        id: 9,
        bytesReceived: { current: 4096 },
        state: { current: 'in_progress' },
      }),
    ).toEqual({ id: 9, receivedBytes: 4096, state: 'in_progress' })
  })

  it('exposes basenames only, including for Windows and POSIX paths', () => {
    expect(downloadBasename('C:\\Users\\person\\secret.txt')).toBe('secret.txt')
    expect(downloadBasename('/home/person/secret.txt')).toBe('secret.txt')
    expect(downloadBasename(undefined)).toBe('Download')
    expect(
      downloadRowFromItem({ id: 1, filename: '/home/person/secret.txt' })
        .filename,
    ).toBe('secret.txt')
  })
})
