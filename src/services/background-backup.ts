import {
  countInvalidSettings,
  createSessionFlowBackup,
  parseSessionFlowBackup,
} from '@/services/backup-codec'
import {
  SafetySnapshotError,
  SessionSnapshots,
  type SessionSnapshotService,
} from '@/services/background-session-snapshots'
import { Tree } from '@/services/background-tree'
import { Favicons } from '@/services/favicons'
import { captureSessionSnapshot } from '@/services/session-snapshot-codec'
import { Settings } from '@/services/settings'
import { normalizeSettings } from '@/services/settings-actions'
import type {
  BackgroundRestoreSection,
  BackupPreview,
  BackupRequest,
  BackupResponse,
  BackupRestoreResult,
  CreateBackupOptions,
  SessionFlowBackup,
  SessionFlowBackupSections,
} from '@/types/backup'
import type { FaviconCacheEntry } from '@/types/favicons'
import type { TopLevelTreeItem } from '@/types/session-tree'

type BackupSnapshotSource = Pick<
  SessionSnapshotService,
  | 'exportAll'
  | 'importExports'
  | 'countNewSnapshots'
  | 'restorePayload'
  | 'restorePayloadSummary'
  | 'waitForTreeInitialized'
>

interface BackupFaviconSource {
  exportCacheEntries(): Promise<FaviconCacheEntry[]>
  mergeCacheEntries(entries: readonly FaviconCacheEntry[]): Promise<number>
}

interface BackupServiceOptions {
  snapshots: BackupSnapshotSource
  getTreeItems: () => readonly TopLevelTreeItem[]
  favicons: BackupFaviconSource
  now?: () => number
  extensionVersion?: () => string
}

const BACKGROUND_SECTIONS = new Set<BackgroundRestoreSection>([
  'sessionTree',
  'snapshots',
  'favicons',
])

export class BackupService {
  private readonly snapshots: BackupSnapshotSource
  private readonly getTreeItems: () => readonly TopLevelTreeItem[]
  private readonly favicons: BackupFaviconSource
  private readonly now: () => number
  private readonly extensionVersion: () => string
  private listening = false
  private ready = false
  private readyPromise: Promise<void> = Promise.resolve()
  private resolveReady: (() => void) | undefined

  constructor(options: BackupServiceOptions) {
    this.snapshots = options.snapshots
    this.getTreeItems = options.getTreeItems
    this.favicons = options.favicons
    this.now = options.now ?? Date.now
    this.extensionVersion =
      options.extensionVersion ?? (() => browser.runtime.getManifest().version)
  }

  /**
   * Answers backup requests from the moment the background starts; they wait
   * until markReady() so they never read settings or snapshots mid-startup.
   */
  listenForRequests(): void {
    if (this.listening) return
    if (!this.ready && !this.resolveReady) {
      this.readyPromise = new Promise<void>((resolve) => {
        this.resolveReady = resolve
      })
    }
    browser.runtime.onMessage.addListener(this.handleRuntimeMessage)
    this.listening = true
  }

  markReady(): void {
    this.ready = true
    this.resolveReady?.()
    this.resolveReady = undefined
  }

  readonly handleRuntimeMessage = (
    message: unknown,
  ): Promise<BackupResponse> | undefined => {
    if (!isBackupRequest(message)) return undefined
    return this.handleRequest(message)
  }

  async createBackup(options: CreateBackupOptions): Promise<SessionFlowBackup> {
    await this.snapshots.waitForTreeInitialized()
    const tree = await captureSessionSnapshot(this.getTreeItems(), {
      includePrivateWindows:
        Settings.values.includePrivateWindowsInSessionSnapshots,
    })
    const sections: SessionFlowBackupSections = {
      sessionTree: tree.payload,
      snapshots: await this.snapshots.exportAll(),
      settings: normalizeSettings(Settings.values),
    }
    if (options.includeFavicons) {
      sections.favicons = await this.favicons.exportCacheEntries()
    }
    return createSessionFlowBackup({
      exportedAt: this.now(),
      extensionVersion: this.extensionVersion(),
      sections,
    })
  }

  async preview(json: string): Promise<BackupPreview> {
    const { backup, invalidSections, skippedSnapshots } =
      parseSessionFlowBackup(json)
    const { sections } = backup
    const preview: BackupPreview = {
      exportedAt: backup.exportedAt,
      extensionVersion: backup.extensionVersion,
      invalidSections,
      skippedSnapshots,
    }
    if (sections.sessionTree) {
      await this.snapshots.waitForTreeInitialized()
      preview.sessionTree = {
        counts: this.snapshots.restorePayloadSummary(sections.sessionTree),
      }
    }
    if (sections.snapshots) {
      preview.snapshots = {
        total: sections.snapshots.length,
        new: await this.snapshots.countNewSnapshots(sections.snapshots),
      }
    }
    if (sections.settings) {
      preview.settings = {
        invalidKeys: countInvalidSettings(sections.settings),
      }
    }
    if (sections.favicons) {
      preview.favicons = { count: sections.favicons.length }
    }
    return preview
  }

  /**
   * Restores the tree first: it is the only step that can stop to ask about
   * a failed safety snapshot, and nothing else has changed at that point.
   */
  async restore(
    json: string,
    sections: readonly BackgroundRestoreSection[],
    allowWithoutSafetySnapshot: boolean,
  ): Promise<BackupRestoreResult> {
    const { backup } = parseSessionFlowBackup(json)
    const requested = new Set(sections)
    const result: BackupRestoreResult = {}

    // The settings page saves restored settings just before asking, so read
    // them now; snapshot retention then uses the restored policy.
    await Settings.loadSettingsFromStorage()

    if (requested.has('sessionTree') && backup.sections.sessionTree) {
      result.sessionTree = await this.snapshots.restorePayload(
        backup.sections.sessionTree,
        allowWithoutSafetySnapshot,
      )
    }
    if (requested.has('snapshots') && backup.sections.snapshots) {
      result.snapshots = await this.snapshots.importExports(
        backup.sections.snapshots,
      )
    }
    if (requested.has('favicons') && backup.sections.favicons) {
      const merged = await this.favicons.mergeCacheEntries(
        backup.sections.favicons,
      )
      result.favicons = { merged }
      if (merged > 0) {
        await browser.runtime
          .sendMessage({ type: 'FAVICON_CACHE_UPDATED' })
          .catch(() => undefined)
      }
    }
    return result
  }

  private async handleRequest(message: BackupRequest): Promise<BackupResponse> {
    try {
      await this.readyPromise
      if (message.action === 'createSessionFlowBackup') {
        return {
          ok: true,
          data: await this.createBackup({
            includeFavicons: message.includeFavicons,
          }),
        }
      }
      if (message.action === 'previewSessionFlowBackup') {
        return { ok: true, data: await this.preview(message.json) }
      }
      return {
        ok: true,
        data: await this.restore(
          message.json,
          message.sections,
          message.allowWithoutSafetySnapshot,
        ),
      }
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
}

export const Backups = new BackupService({
  snapshots: SessionSnapshots,
  getTreeItems: () => Tree.Items,
  favicons: Favicons,
})

function isBackupRequest(value: unknown): value is BackupRequest {
  if (typeof value !== 'object' || value === null) return false
  const message = value as Record<string, unknown>
  if (message.action === 'createSessionFlowBackup') {
    return typeof message.includeFavicons === 'boolean'
  }
  if (message.action === 'previewSessionFlowBackup') {
    return typeof message.json === 'string'
  }
  if (message.action === 'restoreSessionFlowBackup') {
    return (
      typeof message.json === 'string' &&
      Array.isArray(message.sections) &&
      message.sections.every((section) =>
        BACKGROUND_SECTIONS.has(section as BackgroundRestoreSection),
      ) &&
      typeof message.allowWithoutSafetySnapshot === 'boolean'
    )
  }
  return false
}
