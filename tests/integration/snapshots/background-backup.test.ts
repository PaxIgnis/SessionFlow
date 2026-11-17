import { beforeEach, describe, expect, it, vi } from 'vitest'
import { DEFAULT_SETTINGS } from '@/defaults/settings'
import { BackupService } from '@/services/background-backup'
import { SessionSnapshotService } from '@/services/background-session-snapshots'
import { Settings } from '@/services/settings'
import type { FaviconCacheEntry } from '@/types/favicons'
import type { TopLevelTreeItem } from '@/types/session-tree'
import { State, TreeItemType } from '@/types/session-tree'
import { installFakeBrowser } from '../../helpers/fake-browser'
import { MemoryRepository } from '../../helpers/memory-snapshot-repository'

describe('background backup service', () => {
  let fakeBrowser: ReturnType<typeof installFakeBrowser>
  let repository: MemoryRepository
  let treeItems: TopLevelTreeItem[]
  let appended: TopLevelTreeItem[][]
  let snapshots: SessionSnapshotService
  let faviconCache: Map<string, FaviconCacheEntry>
  let backups: BackupService
  let nextId: number
  let clock: number

  beforeEach(() => {
    fakeBrowser = installFakeBrowser()
    Object.assign(Settings.values, structuredClone(DEFAULT_SETTINGS))
    // Keep everything, so retention does not interfere with counts.
    Settings.values.pruneSessionSnapshots = false
    storedSettings({ pruneSessionSnapshots: false })
    repository = new MemoryRepository()
    treeItems = [window('window-1', ['tab-1', 'tab-2'])]
    appended = []
    nextId = 0
    clock = 0
    snapshots = new SessionSnapshotService({
      repository,
      getTreeItems: () => treeItems,
      now: () => (clock += 1_000),
      createId: () => `created-${++nextId}`,
      persistRestoreItems: async (items) => {
        appended.push(items)
      },
    })
    snapshots.markTreeInitialized()
    faviconCache = new Map()
    backups = new BackupService({
      snapshots,
      getTreeItems: () => treeItems,
      favicons: {
        exportCacheEntries: async () => [...faviconCache.values()],
        mergeCacheEntries: async (entries) => {
          let merged = 0
          for (const entry of entries) {
            const current = faviconCache.get(entry.url)
            if (current && current.timestamp >= entry.timestamp) continue
            faviconCache.set(entry.url, entry)
            merged += 1
          }
          return merged
        },
      },
      now: () => 5_000,
      extensionVersion: () => '9.9.9',
    })
    backups.markReady()
  })

  // The fake storage does not keep writes, so stub what settings reads back.
  function storedSettings(overrides: Partial<typeof DEFAULT_SETTINGS>) {
    fakeBrowser.storage.local.get.mockResolvedValue({
      settings: { ...structuredClone(DEFAULT_SETTINGS), ...overrides },
    })
  }

  async function seedSnapshots() {
    await snapshots.capture('manual')
    treeItems = [window('window-2', ['tab-3'])]
    await snapshots.capture('periodic')
  }

  it('backs up the live tree, every snapshot and the settings', async () => {
    await seedSnapshots()
    Settings.values.focusTabOnOpen = false
    faviconCache.set('example.test', favicon('example.test', 1))

    const backup = await backups.createBackup({ includeFavicons: false })

    expect(backup).toMatchObject({
      format: 'session-flow-backup',
      version: 1,
      exportedAt: 5_000,
      extensionVersion: '9.9.9',
    })
    expect(backup.sections.sessionTree?.items.map((item) => item.uid)).toEqual([
      'window-2',
    ])
    expect(
      backup.sections.snapshots?.map((entry) => entry.metadata.id),
    ).toEqual(['created-1', 'created-2'])
    expect(backup.sections.settings?.focusTabOnOpen).toBe(false)
    expect(backup.sections).not.toHaveProperty('favicons')

    const withFavicons = await backups.createBackup({ includeFavicons: true })
    expect(withFavicons.sections.favicons).toEqual([favicon('example.test', 1)])
  })

  it('leaves private windows out of the tree when snapshots exclude them', async () => {
    treeItems = [
      window('window-1', ['tab-1']),
      { ...window('private', ['tab-p']), incognito: true } as TopLevelTreeItem,
    ]
    Settings.values.includePrivateWindowsInSessionSnapshots = false

    const backup = await backups.createBackup({ includeFavicons: false })

    expect(backup.sections.sessionTree?.items.map((item) => item.uid)).toEqual([
      'window-1',
    ])
  })

  it('previews what a restore would change', async () => {
    await seedSnapshots()
    const json = JSON.stringify(
      await backups.createBackup({ includeFavicons: true }),
    )
    await repository.delete('created-1')

    const preview = await backups.preview(json)

    expect(preview).toMatchObject({
      exportedAt: 5_000,
      extensionVersion: '9.9.9',
      sessionTree: {
        counts: { windows: 1, tabs: 1, notes: 0, separators: 0 },
      },
      snapshots: { total: 2, new: 1 },
      settings: { invalidKeys: 0 },
      favicons: { count: 0 },
      invalidSections: [],
      skippedSnapshots: 0,
    })
  })

  it('restores snapshots with their ids, dates and protection, once', async () => {
    await seedSnapshots()
    const json = JSON.stringify(
      await backups.createBackup({ includeFavicons: false }),
    )
    const original = await repository.listMetadata()
    await repository.clear()

    const first = await backups.restore(json, ['snapshots'], false)
    const second = await backups.restore(json, ['snapshots'], false)

    expect(first.snapshots).toEqual({ added: 2, skipped: 0 })
    expect(second.snapshots).toEqual({ added: 0, skipped: 2 })
    const restored = await repository.listMetadata()
    expect(restored).toEqual(original)
    expect(appended).toEqual([])
  })

  it('appends the backed-up tree after taking a safety snapshot', async () => {
    const json = JSON.stringify(
      await backups.createBackup({ includeFavicons: false }),
    )
    treeItems = [window('window-now', ['tab-now'])]

    const result = await backups.restore(json, ['sessionTree'], false)

    expect(result.sessionTree).toEqual({
      windows: 1,
      tabs: 2,
      notes: 0,
      separators: 0,
    })
    expect(appended).toHaveLength(1)
    const safety = await repository.listMetadata()
    expect(safety.map((item) => item.trigger)).toEqual(['before-restore'])
  })

  it('reports a failed safety snapshot so the user can decide', async () => {
    const json = JSON.stringify(
      await backups.createBackup({ includeFavicons: false }),
    )
    vi.spyOn(repository, 'create').mockRejectedValueOnce(new Error('disk full'))

    const response = await backups.handleRuntimeMessage({
      action: 'restoreSessionFlowBackup',
      json,
      sections: ['sessionTree', 'snapshots'],
      allowWithoutSafetySnapshot: false,
    })

    expect(response).toMatchObject({
      ok: false,
      code: 'safety-snapshot-failed',
    })
    // The tree is restored first, so nothing else changed before asking.
    expect(appended).toEqual([])

    const retried = await backups.handleRuntimeMessage({
      action: 'restoreSessionFlowBackup',
      json,
      sections: ['sessionTree'],
      allowWithoutSafetySnapshot: true,
    })
    expect(retried).toMatchObject({ ok: true })
    expect(appended).toHaveLength(1)
  })

  it('restores only the sections asked for', async () => {
    await seedSnapshots()
    faviconCache.set('example.test', favicon('example.test', 5))
    const json = JSON.stringify(
      await backups.createBackup({ includeFavicons: true }),
    )
    await repository.clear()
    faviconCache.clear()

    const result = await backups.restore(json, ['favicons'], false)

    expect(result).toEqual({ favicons: { merged: 1 } })
    expect(await repository.listMetadata()).toEqual([])
    expect(appended).toEqual([])
    expect(browser.runtime.sendMessage).toHaveBeenCalledWith({
      type: 'FAVICON_CACHE_UPDATED',
    })
  })

  it('applies the stored retention policy to restored snapshots', async () => {
    await seedSnapshots()
    const json = JSON.stringify(
      await backups.createBackup({ includeFavicons: false }),
    )
    await repository.clear()
    // The settings page saved a stricter policy just before restoring.
    storedSettings({
      pruneSessionSnapshots: true,
      sessionSnapshotKeepRecentHours: 0,
      sessionSnapshotKeepNewest: 1,
      sessionSnapshotKeepDays: 0,
      sessionSnapshotKeepWeeks: 0,
      sessionSnapshotKeepMonths: 0,
      sessionSnapshotKeepYears: 0,
      protectManualSessionSnapshots: false,
    })

    await backups.restore(json, ['snapshots'], false)

    // The manual snapshot was protected when taken, so it stays.
    expect((await repository.listMetadata()).map((item) => item.id)).toEqual([
      'created-2',
      'created-1',
    ])
    await repository.setProtected('created-1', false)
    await snapshots.applyRetention()
    expect((await repository.listMetadata()).map((item) => item.id)).toEqual([
      'created-2',
    ])
  })

  it('answers only well-formed backup requests', async () => {
    expect(
      backups.handleRuntimeMessage({ action: 'listSessionSnapshots' }),
    ).toBeUndefined()
    expect(
      backups.handleRuntimeMessage({
        action: 'restoreSessionFlowBackup',
        json: '{}',
        sections: ['settings'],
        allowWithoutSafetySnapshot: false,
      }),
    ).toBeUndefined()
    await expect(
      backups.handleRuntimeMessage({
        action: 'previewSessionFlowBackup',
        json: 'not json',
      }),
    ).resolves.toMatchObject({ ok: false })
  })

  it('holds requests until the background is ready', async () => {
    const waiting = new BackupService({
      snapshots,
      getTreeItems: () => treeItems,
      favicons: {
        exportCacheEntries: async () => [],
        mergeCacheEntries: async () => 0,
      },
      extensionVersion: () => '1',
    })
    waiting.listenForRequests()
    let settled = false
    const response = waiting
      .handleRuntimeMessage({
        action: 'createSessionFlowBackup',
        includeFavicons: false,
      })!
      .then((value) => {
        settled = true
        return value
      })
    await Promise.resolve()
    expect(settled).toBe(false)

    waiting.markReady()

    await expect(response).resolves.toMatchObject({ ok: true })
    expect(fakeBrowser.runtime.onMessage.listeners).toContain(
      waiting.handleRuntimeMessage,
    )
  })
})

function window(uid: string, tabUids: string[]): TopLevelTreeItem {
  return {
    type: TreeItemType.WINDOW,
    uid: uid as UID,
    id: -1,
    incognito: false,
    state: State.SAVED,
    active: false,
    selected: false,
    collapsed: false,
    indentLevel: 0,
    isParent: false,
    isVisible: true,
    children: tabUids.map((tabUid) => ({
      type: TreeItemType.TAB,
      uid: tabUid as UID,
      id: -1,
      state: State.SAVED,
      title: tabUid,
      url: `https://example.test/${tabUid}`,
      windowUid: uid as UID,
      active: false,
      selected: false,
      collapsed: false,
      indentLevel: 1,
      isParent: false,
      isVisible: true,
      pinned: false,
      loadingStatus: undefined,
    })),
  } as unknown as TopLevelTreeItem
}

function favicon(url: string, timestamp: number): FaviconCacheEntry {
  return { url, dataUrl: 'data:image/png;base64,AAAA', timestamp }
}
