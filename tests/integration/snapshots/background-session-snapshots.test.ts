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
