import { describe, expect, it } from 'bun:test'
import {
  canControlDownload,
  createPendingDownloadUpdates,
  downloadBasename,
  downloadFailureMessage,
  downloadRowFromItem,
  downloadUpdateFromDelta,
  mergeDownloadSnapshot,
  mergeDownloadUpdate,
  performDownloadAction,
} from './downloads-progress'

describe('downloads progress helpers', () => {
  it('inserts newest rows first, deduplicates IDs, and trims to eight', () => {
    let rows = Array.from({ length: 8 }, (_, index) => ({
      id: 8 - index,
      filename: `file-${8 - index}`,
      state: 'complete',
      receivedBytes: 1,
      totalBytes: 1,
      paused: false,
      canResume: false,
      incognito: false,
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
        incognito: false,
      }),
    ]
    const updates = [
      { id: 22, receivedBytes: 75 },
      {
        id: 23,
        filename: '/private/location/new.txt',
        state: 'complete',
        incognito: false,
      },
    ]
    expect(mergeDownloadSnapshot(snapshot, updates)).toEqual([
      {
        id: 23,
        filename: 'new.txt',
        state: 'complete',
        receivedBytes: 0,
        totalBytes: 0,
        paused: false,
        canResume: false,
        incognito: false,
        error: undefined,
      },
      {
        id: 22,
        filename: 'name.zip',
        state: 'in_progress',
        receivedBytes: 75,
        totalBytes: 100,
        paused: false,
        canResume: false,
        incognito: false,
        error: undefined,
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
    expect(downloadRowFromItem({ id: 2, incognito: undefined }).incognito).toBe(
      true,
    )
  })

  it('offers lifecycle actions only for fresh actionable states', () => {
    const running = {
      state: 'in_progress',
      paused: false,
      canResume: false,
      incognito: false,
    }
    expect(canControlDownload(running, 'pause')).toBe(true)
    expect(canControlDownload(running, 'cancel')).toBe(true)
    expect(canControlDownload(running, 'resume')).toBe(false)
    expect(canControlDownload({ ...running, paused: true }, 'resume')).toBe(
      true,
    )
    expect(
      canControlDownload(
        { ...running, state: 'interrupted', canResume: true },
        'resume',
      ),
    ).toBe(true)
    expect(
      canControlDownload(
        { ...running, state: 'interrupted', canResume: true },
        'cancel',
      ),
    ).toBe(false)
    expect(canControlDownload({ ...running, incognito: true }, 'cancel')).toBe(
      false,
    )
    expect(
      canControlDownload({ ...running, state: 'complete' }, 'cancel'),
    ).toBe(false)
  })

  it('maps browser download errors to actionable, safe messages', () => {
    expect(downloadFailureMessage('NETWORK_TIMEOUT')).toContain('timed out')
    expect(downloadFailureMessage('FILE_NO_SPACE')).toContain('disk space')
    expect(downloadFailureMessage('UNRECOGNIZED_ERROR')).toBe(
      'The browser reported a download error.',
    )
    expect(downloadFailureMessage(undefined)).toBeUndefined()
  })

  it('revalidates window, download identity, and state before controlling it', async () => {
    const calls: string[] = []
    let searches = 0
    const api = {
      search: async ({ id }: { id: number }) => {
        calls.push(`search:${id}`)
        searches += 1
        return searches === 1
          ? [{ id, state: 'in_progress', paused: false, incognito: false }]
          : [{ id, state: 'in_progress', paused: true, incognito: false }]
      },
      pause: async (id: number) => void calls.push(`pause:${id}`),
      resume: async (id: number) => void calls.push(`resume:${id}`),
      cancel: async (id: number) => void calls.push(`cancel:${id}`),
    }
    const result = await performDownloadAction(
      api,
      async () => ({ incognito: false }),
      false,
      42,
      'pause',
    )
    expect(result).toMatchObject({ id: 42, paused: true })
    expect(calls).toEqual(['search:42', 'pause:42', 'search:42'])
  })

  it('rejects private windows, private downloads, stale state, and unavailable IDs', async () => {
    const running: {
      id: number
      state: string
      incognito: boolean | undefined
      paused: boolean
    } = {
      id: 1,
      state: 'in_progress',
      incognito: false,
      paused: false,
    }
    const api = (item: typeof running | undefined) => ({
      search: async () => (item ? [item] : []),
      pause: async () => undefined,
      resume: async () => undefined,
      cancel: async () => undefined,
    })
    await expect(
      performDownloadAction(
        api(running),
        async () => ({ incognito: false }),
        true,
        1,
        'pause',
      ),
    ).rejects.toThrow('hidden in private windows')
    await expect(
      performDownloadAction(
        api({ ...running, incognito: true }),
        async () => ({ incognito: false }),
        false,
        1,
        'pause',
      ),
    ).rejects.toThrow('Private-window downloads')
    await expect(
      performDownloadAction(
        api({ ...running, state: 'complete' }),
        async () => ({ incognito: false }),
        false,
        1,
        'pause',
      ),
    ).rejects.toThrow('no longer running')
    await expect(
      performDownloadAction(
        api(undefined),
        async () => ({ incognito: false }),
        false,
        1,
        'cancel',
      ),
    ).rejects.toThrow('no longer available')
    await expect(
      performDownloadAction(api(running), async () => ({}), false, 1, 'pause'),
    ).rejects.toThrow('hidden in private windows')
    await expect(
      performDownloadAction(
        api({ ...running, incognito: undefined }),
        async () => ({ incognito: false }),
        false,
        1,
        'pause',
      ),
    ).rejects.toThrow('Private-window downloads')
  })

  it('replaces unexpected browser API errors with a safe action message', async () => {
    const api = {
      search: async () => [
        { id: 5, state: 'in_progress', paused: false, incognito: false },
      ],
      pause: async () => {
        throw new Error('sensitive native implementation detail')
      },
      resume: async () => undefined,
      cancel: async () => undefined,
    }
    await expect(
      performDownloadAction(
        api,
        async () => ({ incognito: false }),
        false,
        5,
        'pause',
      ),
    ).rejects.toThrow(
      'The browser could not pause this download. Refresh Downloads to check its current state.',
    )
  })

  it('does not query downloads when the window is private or uncertain', async () => {
    let searches = 0
    const api = {
      search: async () => {
        searches += 1
        return []
      },
      pause: async () => undefined,
      resume: async () => undefined,
      cancel: async () => undefined,
    }
    await expect(
      performDownloadAction(
        api,
        async () => ({ incognito: false }),
        true,
        9,
        'pause',
      ),
    ).rejects.toThrow('hidden in private windows')
    await expect(
      performDownloadAction(api, async () => ({}), false, 9, 'pause'),
    ).rejects.toThrow('hidden in private windows')
    expect(searches).toBe(0)
  })
})
