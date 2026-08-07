import { Tree } from '@/services/background-tree'
import {
  captureSessionSnapshot,
  createSessionSnapshotExport,
} from '@/services/session-snapshot-codec'
import {
  IndexedDbSessionSnapshotRepository,
  type SessionSnapshotRepository,
} from '@/services/session-snapshot-repository'
import { snapshotIdsToRetain } from '@/services/session-snapshot-retention'
import { projectSnapshotForRestore } from '@/services/session-snapshot-restore'
import { Settings } from '@/services/settings'
import type {
  SessionSnapshotCounts,
  SessionSnapshotExport,
  SessionSnapshotListResult,
  SessionSnapshotMetadata,
  SessionSnapshotRecord,
  SessionSnapshotRestoreMode,
  SessionSnapshotRequest,
  SessionSnapshotResponse,
  SessionSnapshotTrigger,
} from '@/types/session-snapshots'
import type { TopLevelTreeItem } from '@/types/session-tree'

export const SNAPSHOT_ALARM_NAME = 'session-flow-periodic-snapshot'

interface SessionSnapshotServiceOptions {
  repository: SessionSnapshotRepository
  getTreeItems: () => readonly TopLevelTreeItem[]
  now?: () => number
  createId?: () => string
  persistRestoreItems?: (
    restoredItems: TopLevelTreeItem[],
    expectedCurrentItems: readonly TopLevelTreeItem[],
  ) => Promise<void>
}

interface RestoreOptions {
  snapshotId: string
  mode: SessionSnapshotRestoreMode
  selectedUids: UID[]
  allowWithoutSafetySnapshot: boolean
}

export class SessionSnapshotService {
  private static readonly MAX_RESTORE_COMMIT_ATTEMPTS = 3
  private operationQueue = Promise.resolve()
  private treeInitialized = false
  private pruneRetryPending = false
  private readonly treeInitializedPromise: Promise<void>
  private resolveTreeInitialized!: () => void
  private alarmListenerRegistered = false
  private runtimeListenerRegistered = false
  private readonly repository: SessionSnapshotRepository
  private readonly getTreeItems: () => readonly TopLevelTreeItem[]
  private readonly now: () => number
  private readonly createId: () => string
  private readonly persistRestoreItems: (
    restoredItems: TopLevelTreeItem[],
    expectedCurrentItems: readonly TopLevelTreeItem[],
  ) => Promise<void>

  constructor(options: SessionSnapshotServiceOptions) {
    this.treeInitializedPromise = new Promise<void>((resolve) => {
      this.resolveTreeInitialized = resolve
    })
    this.repository = options.repository
    this.getTreeItems = options.getTreeItems
    this.now = options.now ?? Date.now
    this.createId = options.createId ?? (() => crypto.randomUUID())
    this.persistRestoreItems =
      options.persistRestoreItems ??
      ((restoredItems, expectedCurrentItems) =>
        Tree.appendTreeItemsAfterPersist(restoredItems, expectedCurrentItems))
  }

  async initialize(): Promise<void> {
    if (!this.runtimeListenerRegistered) {
      browser.runtime.onMessage.addListener(this.handleRuntimeMessage)
      this.runtimeListenerRegistered = true
    }
    if (!this.alarmListenerRegistered) {
      browser.alarms.onAlarm.addListener(this.handleAlarm)
      this.alarmListenerRegistered = true
    }
    await this.repository.initialize()
    await this.rescheduleAlarm()
  }

  async handleSettingsUpdated(): Promise<void> {
    await this.rescheduleAlarm()
  }

  markTreeInitialized(): void {
    if (this.treeInitialized) return
    this.treeInitialized = true
    this.resolveTreeInitialized()
  }

  capture(
    trigger: SessionSnapshotTrigger,
    sourceItems: readonly TopLevelTreeItem[] = this.getTreeItems(),
  ): Promise<SessionSnapshotMetadata | undefined> {
    return this.serialize(() => this.captureNow(trigger, sourceItems))
  }

  async listMetadata(): Promise<SessionSnapshotMetadata[]> {
    return this.repository.listMetadata()
  }

  readonly handleRuntimeMessage = async (
    message: unknown,
  ): Promise<SessionSnapshotResponse | undefined> => {
    if (!isSnapshotRequest(message)) return undefined
    try {
      if (message.action === 'listSessionSnapshots') {
        return { ok: true, data: await this.list() }
      }
      if (message.action === 'getSessionSnapshot') {
        return { ok: true, data: await this.get(message.snapshotId) }
      }
      if (message.action === 'createSessionSnapshot') {
        return { ok: true, data: await this.capture('manual') }
      }
      if (message.action === 'setSessionSnapshotProtected') {
        await this.setProtected(message.snapshotId, message.protected)
        return { ok: true, data: {} }
      }
      if (message.action === 'deleteSessionSnapshot') {
        await this.delete(message.snapshotId)
        return { ok: true, data: {} }
      }
      if (message.action === 'clearSessionSnapshots') {
        await this.clear()
        return { ok: true, data: {} }
      }
      if (message.action === 'getSessionSnapshotExport') {
        return {
          ok: true,
          data: await this.exportSnapshot(message.snapshotId),
        }
      }
      if (message.action === 'getSessionSnapshotRestoreSummary') {
        return { ok: true, data: await this.restoreSummary(message) }
      }
      return { ok: true, data: await this.restore(message) }
    } catch (error) {
      return {
        ok: false,
        error: error instanceof Error ? error.message : String(error),
        code:
          error instanceof SafetySnapshotError
            ? 'safety-snapshot-failed'
            : undefined,
      }
    }
  }

  async capturePersistedStartupTree(): Promise<
    SessionSnapshotMetadata | undefined
  > {
    const stored = await browser.storage.local.get('sessionTree')
    if (!Array.isArray(stored.sessionTree)) return undefined
    return this.capture(
      'startup',
      stored.sessionTree as unknown as TopLevelTreeItem[],
    )
  }

  async list(): Promise<SessionSnapshotListResult> {
    return {
      snapshots: await this.repository.listMetadata(),
      totalBytes: await this.repository.approximateBytes(),
      activeTreeEmpty: this.getTreeItems().length === 0,
    }
  }

  async get(id: string): Promise<SessionSnapshotRecord> {
    return this.repository.get(id)
  }

  setProtected(id: string, value: boolean): Promise<void> {
    return this.serialize(async () => {
      await this.repository.setProtected(id, value)
      this.pruneRetryPending = true
      await this.retryPendingPrune()
    })
  }

  delete(id: string): Promise<void> {
    return this.serialize(() => this.repository.delete(id))
  }

  clear(): Promise<void> {
    return this.serialize(() => this.repository.clear())
  }

  async exportSnapshot(id: string): Promise<SessionSnapshotExport> {
    const record = await this.repository.get(id)
    return createSessionSnapshotExport(record.metadata, record.payload)
  }

  restore(options: RestoreOptions): Promise<SessionSnapshotCounts> {
    return this.waitForTreeInitialized().then(() =>
      this.serialize(() => this.restoreNow(options)),
    )
  }

  async restoreSummary(
    options: Omit<RestoreOptions, 'allowWithoutSafetySnapshot'>,
  ): Promise<SessionSnapshotCounts> {
    const record = await this.repository.get(options.snapshotId)
    return projectSnapshotForRestore({
      payload: record.payload,
      mode: options.mode,
      selectedUids: new Set(options.selectedUids),
      existingUids: collectUids(this.getTreeItems()),
    }).counts
  }

  private readonly handleAlarm = (alarm: browser.alarms.Alarm): void => {
    if (
      alarm.name !== SNAPSHOT_ALARM_NAME ||
      !Settings.values.automaticSessionSnapshots
    ) {
      return
    }
    void this.capture('periodic').catch((error) => {
      console.error('Failed to create periodic session snapshot:', error)
    })
  }

  private async rescheduleAlarm(): Promise<void> {
    await browser.alarms.clear(SNAPSHOT_ALARM_NAME)
    if (!Settings.values.automaticSessionSnapshots) return
    await browser.alarms.create(SNAPSHOT_ALARM_NAME, {
      periodInMinutes: snapshotIntervalMinutes(),
    })
  }

  private async captureNow(
    trigger: SessionSnapshotTrigger,
    sourceItems: readonly TopLevelTreeItem[],
  ): Promise<SessionSnapshotMetadata | undefined> {
    const capture = await captureSessionSnapshot(sourceItems, {
      includePrivateWindows:
        Settings.values.includePrivateWindowsInSessionSnapshots,
    })
    const totalItems = Object.values(capture.counts).reduce(
      (total, count) => total + count,
      0,
    )
    if (totalItems === 0) {
      await this.retryPendingPrune()
      return undefined
    }

    const currentMetadata = await this.repository.listMetadata()
    if (
      trigger !== 'manual' &&
      currentMetadata[0]?.available === true &&
      currentMetadata[0].digest === capture.digest
    ) {
      await this.retryPendingPrune(currentMetadata)
      return undefined
    }
    const metadata: SessionSnapshotMetadata = {
      id: this.createId(),
      schemaVersion: 1,
      createdAt: this.now(),
      trigger,
      protected:
        trigger === 'manual' && Settings.values.protectManualSessionSnapshots,
      digest: capture.digest,
      sizeBytes: capture.sizeBytes,
      counts: capture.counts,
      containsPrivateWindows: capture.containsPrivateWindows,
      available: true,
    }
    await this.repository.create(metadata, capture.payload)
    this.pruneRetryPending = true
    await this.retryPendingPrune(
      [...currentMetadata, metadata],
      metadata.createdAt,
    )
    return metadata
  }

  private async restoreNow(
    options: RestoreOptions,
  ): Promise<SessionSnapshotCounts> {
    const record = await this.repository.get(options.snapshotId)
    const itemsBeforeSafetySnapshot = structuredClone(this.getTreeItems())
    if (itemsBeforeSafetySnapshot.length > 0) {
      try {
        await this.captureNow('before-restore', itemsBeforeSafetySnapshot)
      } catch (error) {
        if (!options.allowWithoutSafetySnapshot) {
          throw new SafetySnapshotError(error)
        }
      }
    }
    for (
      let attempt = 0;
      attempt < SessionSnapshotService.MAX_RESTORE_COMMIT_ATTEMPTS;
      attempt += 1
    ) {
      const currentItems = structuredClone(this.getTreeItems())
      const projection = projectSnapshotForRestore({
        payload: record.payload,
        mode: options.mode,
        selectedUids: new Set(options.selectedUids),
        existingUids: collectUids(currentItems),
      })
      try {
        await this.persistRestoreItems(projection.items, currentItems)
        return projection.counts
      } catch (error) {
        if (!isTreeChangedDuringPersistError(error)) throw error
      }
    }

    throw new Error(
      'The active session tree changed repeatedly during restore; please try again.',
    )
  }

  private async prune(
    metadata?: SessionSnapshotMetadata[],
    now: number = this.now(),
  ): Promise<void> {
    const current = metadata ?? (await this.repository.listMetadata())
    await this.repository.deleteExcept(snapshotIdsToRetain(current, now))
  }

  private async retryPendingPrune(
    metadata?: SessionSnapshotMetadata[],
    now: number = this.now(),
  ): Promise<void> {
    if (!this.pruneRetryPending) return
    try {
      await this.prune(metadata, now)
      this.pruneRetryPending = false
    } catch (error) {
      console.error('Failed to prune session snapshots; will retry:', error)
    }
  }

  private serialize<T>(operation: () => Promise<T>): Promise<T> {
    const result = this.operationQueue.then(operation, operation)
    this.operationQueue = result.then(
      () => undefined,
      () => undefined,
    )
    return result
  }

  private waitForTreeInitialized(): Promise<void> {
    return this.treeInitialized
      ? Promise.resolve()
      : this.treeInitializedPromise
  }
}

export class SafetySnapshotError extends Error {
  constructor(cause: unknown) {
    super(`Failed to create safety snapshot: ${String(cause)}`, { cause })
    this.name = 'SafetySnapshotError'
  }
}

export const SessionSnapshots = new SessionSnapshotService({
  repository: new IndexedDbSessionSnapshotRepository(),
  getTreeItems: () => Tree.Items,
})

function snapshotIntervalMinutes(): number {
  const value = Settings.values.sessionSnapshotInterval
  const minutes =
    Settings.values.sessionSnapshotIntervalUnit === 'hours' ? value * 60 : value
  return Math.min(Math.max(minutes, 5), 24 * 60)
}

function collectUids(items: readonly TopLevelTreeItem[]): Set<UID> {
  const uids = new Set<UID>()
  for (const item of items) {
    uids.add(item.uid)
    if (item.type !== 0) continue
    for (const child of item.children) {
      uids.add(child.uid)
      if (child.type === 1 && child.tabGroup) uids.add(child.tabGroup.uid)
    }
  }
  return uids
}

function isSnapshotRequest(value: unknown): value is SessionSnapshotRequest {
  if (typeof value !== 'object' || value === null) return false
  const message = value as Record<string, unknown>
  if (
    message.action === 'listSessionSnapshots' ||
    message.action === 'createSessionSnapshot' ||
    message.action === 'clearSessionSnapshots'
  ) {
    return true
  }
  if (
    message.action === 'getSessionSnapshot' ||
    message.action === 'deleteSessionSnapshot' ||
    message.action === 'getSessionSnapshotExport'
  ) {
    return typeof message.snapshotId === 'string'
  }
  if (message.action === 'setSessionSnapshotProtected') {
    return (
      typeof message.snapshotId === 'string' &&
      typeof message.protected === 'boolean'
    )
  }
  if (
    message.action === 'getSessionSnapshotRestoreSummary' ||
    message.action === 'restoreSessionSnapshot'
  ) {
    return (
      typeof message.snapshotId === 'string' &&
      (message.mode === 'all' || message.mode === 'selected') &&
      Array.isArray(message.selectedUids) &&
      message.selectedUids.every((uid) => typeof uid === 'string') &&
      (message.action === 'getSessionSnapshotRestoreSummary' ||
        typeof message.allowWithoutSafetySnapshot === 'boolean')
    )
  }
  return false
}

function isTreeChangedDuringPersistError(error: unknown): boolean {
  return (
    error instanceof Error &&
    error.name === 'SessionTreeChangedDuringPersistError'
  )
}
