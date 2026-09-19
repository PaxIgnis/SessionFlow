import { beforeEach, describe, expect, it, vi } from 'vitest'
import { DEFAULT_SETTINGS } from '@/defaults/settings'
import { SessionSnapshotService } from '@/services/background-session-snapshots'
import type { SessionSnapshotRepository } from '@/services/session-snapshot-repository'
import { Settings } from '@/services/settings'
import type {
  SessionSnapshotMetadata,
  SessionSnapshotPayload,
  SessionSnapshotRecord,
} from '@/types/session-snapshots'
import type { TopLevelTreeItem } from '@/types/session-tree'
import { State, TreeItemType } from '@/types/session-tree'
import { installFakeBrowser } from '../../helpers/fake-browser'
import tabsOutlinerBackup from '../../fixtures/tabs-outliner-backup.json'
import sessionBuddyExport from '../../fixtures/session-buddy-export.json'
import tabSessionManagerExport from '../../fixtures/tab-session-manager-export.json'

describe('background session snapshots', () => {
  let repository: MemoryRepository
  let treeItems: TopLevelTreeItem[]
  let service: SessionSnapshotService
  let fakeBrowser: ReturnType<typeof installFakeBrowser>

  beforeEach(() => {
    fakeBrowser = installFakeBrowser()
    Object.assign(Settings.values, structuredClone(DEFAULT_SETTINGS))
    repository = new MemoryRepository()
    treeItems = [note('note-1')]
    service = new SessionSnapshotService({
      repository,
      getTreeItems: () => treeItems,
      now: () => 1_000,
      createId: () => `snapshot-${repository.records.size + 1}`,
    })
    service.markTreeInitialized()
  })

  it('initializes storage and schedules the configured Firefox alarm', async () => {
    await service.initialize()

    expect(repository.initialized).toBe(true)
    expect(browser.alarms.clear).toHaveBeenCalledWith(
      'session-flow-periodic-snapshot',
    )
    expect(browser.alarms.create).toHaveBeenCalledWith(
      'session-flow-periodic-snapshot',
      { periodInMinutes: 30 },
    )
  })

  it('registers its runtime listener before repository initialization can fail', async () => {
    vi.spyOn(repository, 'initialize').mockRejectedValue(new Error('db failed'))

    await expect(service.initialize()).rejects.toThrow('db failed')

    expect(fakeBrowser.runtime.onMessage.listeners).toContain(
      service.handleRuntimeMessage,
    )
  })

  it('reschedules hours and clears the alarm when automatic snapshots are disabled', async () => {
    Settings.values.sessionSnapshotInterval = 2
    Settings.values.sessionSnapshotIntervalUnit = 'hours'
    await service.initialize()
    expect(browser.alarms.create).toHaveBeenLastCalledWith(
      'session-flow-periodic-snapshot',
      { periodInMinutes: 120 },
    )

    Settings.values.automaticSessionSnapshots = false
    await service.handleSettingsUpdated()

    expect(browser.alarms.clear).toHaveBeenLastCalledWith(
      'session-flow-periodic-snapshot',
    )
    expect(browser.alarms.create).toHaveBeenCalledTimes(1)
  })

  it('captures only when the periodic snapshot alarm fires while enabled', async () => {
    await service.initialize()

    fakeBrowser.alarms.onAlarm.emit({
      name: 'unrelated-alarm',
      scheduledTime: 0,
    })
    await Promise.resolve()
    expect(repository.records.size).toBe(0)

    fakeBrowser.alarms.onAlarm.emit({
      name: 'session-flow-periodic-snapshot',
      scheduledTime: 0,
    })
    await vi.waitFor(() => expect(repository.records.size).toBe(1))

    Settings.values.automaticSessionSnapshots = false
    treeItems = [note('changed-note')]
    fakeBrowser.alarms.onAlarm.emit({
      name: 'session-flow-periodic-snapshot',
      scheduledTime: 0,
    })
    await Promise.resolve()
    expect(repository.records.size).toBe(1)
  })

  it('skips empty and unchanged automatic captures but retains identical manual captures', async () => {
    treeItems = []
    expect(await service.capture('periodic')).toBeUndefined()
    treeItems = [note('note-1')]

    const first = await service.capture('periodic')
    const skipped = await service.capture('periodic')
    const manual = await service.capture('manual')

    expect(first).toBeDefined()
    expect(skipped).toBeUndefined()
    expect(manual).toMatchObject({ trigger: 'manual', protected: true })
    expect(repository.records.size).toBe(2)
  })

  it('creates a fresh automatic snapshot when the matching latest snapshot is unavailable', async () => {
    const existing = await service.capture('periodic')
    repository.records.get(existing!.id)!.metadata.available = false

    const replacement = await service.capture('before-restore')

    expect(replacement).toMatchObject({
      trigger: 'before-restore',
      available: true,
    })
    expect(repository.records.size).toBe(2)
  })

  it('returns a created snapshot when pruning fails after the write', async () => {
    vi.spyOn(repository, 'deleteExcept').mockRejectedValue(
      new Error('prune failed'),
    )

    await expect(service.capture('manual')).resolves.toMatchObject({
      id: 'snapshot-1',
      trigger: 'manual',
    })
    expect(repository.records.has('snapshot-1')).toBe(true)
  })

  it('retries a failed prune on an unchanged periodic capture', async () => {
    const prune = vi.spyOn(repository, 'deleteExcept')
    prune.mockRejectedValueOnce(new Error('prune failed'))
    prune.mockResolvedValue(undefined)

    await expect(service.capture('periodic')).resolves.toBeDefined()
    await expect(service.capture('periodic')).resolves.toBeUndefined()

    expect(prune).toHaveBeenCalledTimes(2)
  })

  it('keeps protection changes successful and retries a failed prune', async () => {
    const created = await service.capture('manual')
    const prune = vi.spyOn(repository, 'deleteExcept')
    prune.mockRejectedValueOnce(new Error('prune failed'))
    prune.mockResolvedValue(undefined)

    await expect(
      service.setProtected(created!.id, false),
    ).resolves.toBeUndefined()
    expect((await repository.get(created!.id)).metadata.protected).toBe(false)

    await expect(service.capture('periodic')).resolves.toBeUndefined()
    expect(prune).toHaveBeenCalledTimes(2)
  })

  it('filters private windows according to settings', async () => {
    Settings.values.includePrivateWindowsInSessionSnapshots = false
    treeItems = [
      {
        type: TreeItemType.WINDOW,
        uid: 'private-window' as UID,
        id: 20,
        incognito: true,
        selected: false,
        state: State.OPEN,
        children: [],
        indentLevel: 0,
      },
      note('note-1'),
    ]

    const metadata = await service.capture('manual')

    expect(metadata?.containsPrivateWindows).toBe(false)
    expect(repository.records.get(metadata!.id)?.payload.items).toHaveLength(1)
  })

  it('lists, protects, exports, deletes, and clears snapshots', async () => {
    const created = await service.capture('manual')

    expect(await service.list()).toMatchObject({
      snapshots: [expect.objectContaining({ id: created!.id })],
      activeTreeEmpty: false,
    })
    await service.setProtected(created!.id, false)
    expect((await repository.get(created!.id)).metadata.protected).toBe(false)
    expect(await service.exportSnapshot(created!.id)).toMatchObject({
      format: 'session-flow-snapshot',
      metadata: { id: created!.id },
    })
    await service.delete(created!.id)
    expect(await service.listMetadata()).toEqual([])
    await service.capture('manual')
    await service.clear()
    expect(await service.listMetadata()).toEqual([])
  })

  it('does not replace the active tree when restore persistence fails', async () => {
    const created = await service.capture('manual')
    const persistRestoreItems = vi.fn().mockRejectedValue(new Error('quota'))
    service = new SessionSnapshotService({
      repository,
      getTreeItems: () => treeItems,
      persistRestoreItems,
      now: () => 2_000,
      createId: () => 'safety-snapshot',
    })
    service.markTreeInitialized()

    await expect(
      service.restore({
        snapshotId: created!.id,
        mode: 'all',
        selectedUids: [],
        allowWithoutSafetySnapshot: false,
      }),
    ).rejects.toThrow('quota')

    expect(treeItems).toEqual([note('note-1')])
    expect(persistRestoreItems).toHaveBeenCalledTimes(1)
  })

  it('queues restore requests until the active tree is initialized', async () => {
    const created = await service.capture('manual')
    const persistRestoreItems = vi.fn().mockResolvedValue(undefined)
    service = new SessionSnapshotService({
      repository,
      getTreeItems: () => treeItems,
      persistRestoreItems,
      now: () => 2_000,
      createId: () => 'queued-restore-snapshot',
    })

    const restore = service.restore({
      snapshotId: created!.id,
      mode: 'all',
      selectedUids: [],
      allowWithoutSafetySnapshot: false,
    })

    await Promise.resolve()
    expect(persistRestoreItems).not.toHaveBeenCalled()

    service.markTreeInitialized()

    await expect(restore).resolves.toEqual({
      windows: 0,
      tabs: 0,
      notes: 1,
      separators: 0,
    })
    expect(persistRestoreItems).toHaveBeenCalledOnce()
  })

  it('reconciles live tree changes made while creating the safety snapshot', async () => {
    const created = await service.capture('manual')
    treeItems = [note('current-tree')]
    let releaseCreate!: () => void
    let signalCreateStarted!: () => void
    const createStarted = new Promise<void>((resolve) => {
      signalCreateStarted = resolve
    })
    const originalCreate = repository.create.bind(repository)
    vi.spyOn(repository, 'create').mockImplementationOnce(
      async (metadata, payload) => {
        signalCreateStarted()
        await new Promise<void>((resolve) => {
          releaseCreate = resolve
        })
        await originalCreate(metadata, payload)
      },
    )
    const persistRestoreItems = vi.fn().mockResolvedValue(undefined)
    service = new SessionSnapshotService({
      repository,
      getTreeItems: () => treeItems,
      persistRestoreItems,
      now: () => 2_000,
      createId: () => 'reconciled-restore-snapshot',
    })
    service.markTreeInitialized()

    const restore = service.restore({
      snapshotId: created!.id,
      mode: 'all',
      selectedUids: [],
      allowWithoutSafetySnapshot: false,
    })
    await createStarted

    treeItems.push(note('live-change'))
    releaseCreate()
    await restore

    const replacement = persistRestoreItems.mock.calls[0]?.[1] as
      | TopLevelTreeItem[]
      | undefined
    expect(replacement?.some((item) => item.uid === 'live-change')).toBe(true)
  })

  it('rebases the restore when the live tree changes during persistence', async () => {
    const created = await service.capture('manual')
    treeItems = [note('current-tree')]
    const persistRestoreItems = vi.fn(
      async (
        _restoredItems: TopLevelTreeItem[],
        _expectedCurrentItems: readonly TopLevelTreeItem[],
      ) => {
        if (persistRestoreItems.mock.calls.length !== 1) return
        treeItems.push(note('live-during-commit'))
        const error = new Error('Session tree changed during persistence')
        error.name = 'SessionTreeChangedDuringPersistError'
        throw error
      },
    )
    service = new SessionSnapshotService({
      repository,
      getTreeItems: () => treeItems,
      persistRestoreItems,
      now: () => 2_000,
      createId: () => 'rebased-restore-snapshot',
    })
    service.markTreeInitialized()

    await expect(
      service.restore({
        snapshotId: created!.id,
        mode: 'all',
        selectedUids: [],
        allowWithoutSafetySnapshot: false,
      }),
    ).resolves.toEqual({
      windows: 0,
      tabs: 0,
      notes: 1,
      separators: 0,
    })

    expect(persistRestoreItems).toHaveBeenCalledTimes(2)
    const rebasedItems = persistRestoreItems.mock.calls[1]?.[1] as
      | TopLevelTreeItem[]
      | undefined
    expect(
      rebasedItems?.some((item) => item.uid === 'live-during-commit'),
    ).toBe(true)
  })

  it('imports a fresh protected snapshot through runtime messaging without changing the active tree', async () => {
    Settings.values.protectManualSessionSnapshots = false
    const original = await service.capture('manual')
    const exported = await service.exportSnapshot(original!.id)
    const originalTree = structuredClone(treeItems)
    exported.metadata.digest = 'untrusted'
    exported.metadata.counts.notes = 999
    exported.metadata.sizeBytes = 0
    exported.metadata.available = false
    exported.metadata.importSummary = {
      source: 'tabs-outliner',
      counts: { windows: 999, tabs: 999, notes: 999, separators: 999 },
      warnings: [],
    }

    const response = await service.handleRuntimeMessage({
      action: 'importSessionSnapshot',
      json: JSON.stringify(exported),
    })

    expect(response).toMatchObject({
      ok: true,
      data: {
        id: 'snapshot-2',
        trigger: 'import',
        protected: true,
        createdAt: 1_000,
        available: true,
        counts: { windows: 0, tabs: 0, notes: 1, separators: 0 },
        importSummary: {
          source: 'session-flow',
          sourceCreatedAt: 1_000,
          counts: { windows: 0, tabs: 0, notes: 1, separators: 0 },
          warnings: [],
        },
      },
    })
    const imported = await service.get('snapshot-2')
    expect(imported.payload).toEqual(exported.payload)
    expect(imported.metadata.digest).toBe(original!.digest)
    expect(imported.metadata.sizeBytes).toBe(original!.sizeBytes)
    expect(treeItems).toEqual(originalTree)
    expect(repository.records.size).toBe(2)
    expect(browser.tabs.create).not.toHaveBeenCalled()
    expect(browser.windows.create).not.toHaveBeenCalled()

    // Reimporting a file creates another record instead of replacing one.
    await service.importSnapshot(JSON.stringify(exported))
    expect(repository.records.size).toBe(3)
  })

  it('persists Tabs Outliner conversion details and rejects incomplete backups atomically', async () => {
    const originalTree = structuredClone(treeItems)
    await expect(
      service.importSnapshot(
        JSON.stringify(tabsOutlinerBackup.data.slice(0, -1)),
      ),
    ).rejects.toThrow('Tabs Outliner')
    expect(repository.records.size).toBe(0)
    const imported = await service.importSnapshot(
      JSON.stringify(tabsOutlinerBackup),
    )
    expect(imported).toMatchObject({
      trigger: 'import',
      protected: true,
      createdAt: 1_000,
      counts: { windows: 3, tabs: 4, notes: 4, separators: 1 },
      importSummary: {
        source: 'tabs-outliner',
        sourceCreatedAt: 1700000000000,
        warnings: expect.arrayContaining([
          expect.objectContaining({ code: 'nested-windows', count: 2 }),
        ]),
      },
    })
    expect((await service.get(imported.id)).metadata.importSummary).toEqual(
      imported.importSummary,
    )
    expect(
      (await service.exportSnapshot(imported.id)).metadata.importSummary,
    ).toEqual(imported.importSummary)
    expect(
      await service.restoreSummary({
        snapshotId: imported.id,
        mode: 'all',
        selectedUids: [],
      }),
    ).toEqual(imported.counts)
    expect(treeItems).toEqual(originalTree)
    expect(browser.tabs.create).not.toHaveBeenCalled()
    expect(browser.windows.create).not.toHaveBeenCalled()
  })

  it('imports Session Buddy through runtime messaging without touching the active tree', async () => {
    const originalTree = structuredClone(treeItems)
    const response = await service.handleRuntimeMessage({
      action: 'importSessionSnapshot',
      json: JSON.stringify(sessionBuddyExport),
    })
    expect(response).toMatchObject({
      ok: true,
      data: {
        id: 'snapshot-1',
        protected: true,
        trigger: 'import',
        containsPrivateWindows: true,
        counts: { windows: 3, tabs: 4, notes: 2, separators: 0 },
        importSummary: { source: 'session-buddy' },
      },
    })
    const record = await service.get('snapshot-1')
    expect(record.metadata.importSummary?.counts).toEqual(
      record.metadata.counts,
    )
    expect(
      await service.restoreSummary({
        snapshotId: 'snapshot-1',
        mode: 'all',
        selectedUids: [],
      }),
    ).toEqual(record.metadata.counts)
    expect((await service.exportSnapshot('snapshot-1')).payload).toEqual(
      record.payload,
    )
    expect(treeItems).toEqual(originalTree)
    expect(browser.tabs.create).not.toHaveBeenCalled()
    expect(browser.windows.create).not.toHaveBeenCalled()

    await expect(
      service.importSnapshot(
        JSON.stringify({
          collections: [
            { folders: [{ links: [{ url: 'https://example.com' }, null] }] },
          ],
        }),
      ),
    ).rejects.toThrow('Session Buddy')
    expect(repository.records.size).toBe(1)
  })

  it('imports Tab Session Manager atomically as a protected snapshot through runtime messaging', async () => {
    const originalTree = structuredClone(treeItems)
    const response = await service.handleRuntimeMessage({
      action: 'importSessionSnapshot',
      json: JSON.stringify(tabSessionManagerExport),
    })
    expect(response).toMatchObject({
      ok: true,
      data: {
        id: 'snapshot-1',
        protected: true,
        trigger: 'import',
        containsPrivateWindows: true,
        counts: { windows: 2, tabs: 4, notes: 3, separators: 0 },
        importSummary: { source: 'tab-session-manager' },
      },
    })
    const record = await service.get('snapshot-1')
    expect(record.metadata.importSummary?.counts).toEqual(
      record.metadata.counts,
    )
    expect(
      await service.restoreSummary({
        snapshotId: 'snapshot-1',
        mode: 'all',
        selectedUids: [],
      }),
    ).toEqual(record.metadata.counts)
    expect((await service.exportSnapshot('snapshot-1')).payload).toEqual(
      record.payload,
    )
    expect(treeItems).toEqual(originalTree)
    expect(browser.tabs.create).not.toHaveBeenCalled()
    expect(browser.windows.create).not.toHaveBeenCalled()
    await expect(
      service.importSnapshot(
        JSON.stringify([
          ...tabSessionManagerExport,
          { ...tabSessionManagerExport[0], windows: { '1': { '1': {} } } },
        ]),
      ),
    ).rejects.toThrow('Tab Session Manager')
    expect(repository.records.size).toBe(1)
  })

  it('rejects invalid imports without writing and allows a subsequent valid import', async () => {
    const create = vi.spyOn(repository, 'create')
    await expect(
      service.handleRuntimeMessage({
        action: 'importSessionSnapshot',
        json: '{',
      }),
    ).resolves.toMatchObject({
      ok: false,
      error: expect.stringContaining('not a valid snapshot file'),
    })
    expect(create).not.toHaveBeenCalled()
    expect(repository.records.size).toBe(0)

    await expect(
      service.importSnapshot(JSON.stringify(treeItems)),
    ).resolves.toMatchObject({
      protected: true,
      trigger: 'import',
    })
  })

  it('reports import storage failures without reporting success', async () => {
    vi.spyOn(repository, 'create').mockRejectedValueOnce(
      new Error('storage full'),
    )
    await expect(
      service.handleRuntimeMessage({
        action: 'importSessionSnapshot',
        json: JSON.stringify(treeItems),
      }),
    ).resolves.toMatchObject({ ok: false, error: 'storage full' })
    expect(repository.records.size).toBe(0)
  })

  it('preserves private windows during explicit import even when automatic capture excludes them', async () => {
    Settings.values.includePrivateWindowsInSessionSnapshots = false
    const imported = await service.importSnapshot(
      JSON.stringify([
        {
          type: TreeItemType.WINDOW,
          uid: 'private-window',
          incognito: true,
          state: State.SAVED,
          indentLevel: 0,
          children: [],
        },
      ]),
    )
    expect(imported).toMatchObject({
      protected: true,
      containsPrivateWindows: true,
      counts: { windows: 1 },
    })
  })

  it('routes typed runtime requests and ignores unrelated messages', async () => {
    const created = await service.capture('manual')

    await expect(
      service.handleRuntimeMessage({ action: 'listSessionSnapshots' }),
    ).resolves.toMatchObject({
      ok: true,
      data: { snapshots: [expect.objectContaining({ id: 'snapshot-1' })] },
    })
    await expect(
      service.handleRuntimeMessage({
        action: 'getSessionSnapshotRestoreSummary',
        snapshotId: created!.id,
        mode: 'selected',
        selectedUids: ['note-1'],
      }),
    ).resolves.toEqual({
      ok: true,
      data: { windows: 0, tabs: 0, notes: 1, separators: 0 },
    })
    await expect(
      service.handleRuntimeMessage({ type: 'settingsUpdated' }),
    ).resolves.toBeUndefined()
    await expect(
      service.handleRuntimeMessage({ action: 'getSessionSnapshot' }),
    ).resolves.toBeUndefined()
    await expect(
      service.handleRuntimeMessage({
        action: 'restoreSessionSnapshot',
        snapshotId: created!.id,
        mode: 'selected',
        selectedUids: 'note-1',
        allowWithoutSafetySnapshot: false,
      }),
    ).resolves.toBeUndefined()
  })
})

function note(uid: string): TopLevelTreeItem {
  return {
    type: TreeItemType.NOTE,
    uid: uid as UID,
    text: uid,
    selected: false,
    collapsed: false,
    indentLevel: 0,
    isParent: false,
  }
}

class MemoryRepository implements SessionSnapshotRepository {
  initialized = false
  records = new Map<string, SessionSnapshotRecord>()

  async initialize() {
    this.initialized = true
  }
  async create(
    metadata: SessionSnapshotMetadata,
    payload: SessionSnapshotPayload,
  ) {
    this.records.set(metadata.id, { metadata, payload })
  }
  async listMetadata() {
    return [...this.records.values()]
      .map((record) => record.metadata)
      .sort((a, b) => b.createdAt - a.createdAt)
  }
  async get(id: string) {
    const record = this.records.get(id)
    if (!record) throw new Error('missing')
    return record
  }
  async setProtected(id: string, value: boolean) {
    const record = await this.get(id)
    record.metadata.protected = value
  }
  async delete(id: string) {
    this.records.delete(id)
  }
  async clear() {
    this.records.clear()
  }
  async deleteExcept(retainedIds: ReadonlySet<string>) {
    for (const id of this.records.keys()) {
      if (!retainedIds.has(id)) this.records.delete(id)
    }
  }
  async approximateBytes() {
    return [...this.records.values()].reduce(
      (sum, record) => sum + record.metadata.sizeBytes,
      0,
    )
  }
}
