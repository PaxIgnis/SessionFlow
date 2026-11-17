import {
  automaticBackupFileName,
  currentSlot,
  nextAutomaticBackupAt,
  normalizeAutomaticBackupState,
  sanitizeBackupFolder,
  slotAfter,
} from '@/services/automatic-backup-schedule'
import { Backups } from '@/services/background-backup'
import { i18n } from '@/services/i18n'
import { Settings } from '@/services/settings'
import {
  AUTOMATIC_BACKUP_STATE_KEY,
  type AutomaticBackupRequest,
  type AutomaticBackupState,
  type BackupResponse,
  type CreateBackupOptions,
  type SessionFlowBackup,
} from '@/types/backup'

export const AUTOMATIC_BACKUP_ALARM_NAME = 'session-flow-automatic-backup'
export const DOWNLOADS_PERMISSION = 'downloads'

/** Startup is busy enough; an overdue backup can wait a minute. */
const STARTUP_DELAY_MS = 60_000
const DOWNLOAD_TIMEOUT_MS = 120_000

type DownloadDeltaListener = (
  delta: browser.downloads._OnChangedDownloadDelta,
) => void

/** The parts of browser.downloads that backups use. */
interface DownloadsApi {
  download(options: browser.downloads._DownloadOptions): Promise<number>
  erase(query: browser.downloads.DownloadQuery): Promise<number[]>
  cancel(downloadId: number): Promise<void>
  onChanged: {
    addListener(listener: DownloadDeltaListener): void
    removeListener(listener: DownloadDeltaListener): void
  }
}

interface DownloadOutcome {
  state: 'complete' | 'interrupted'
  error?: string
}

interface AutomaticBackupServiceOptions {
  createBackup: (options: CreateBackupOptions) => Promise<SessionFlowBackup>
  /** Firefox only exposes the API once the optional permission is granted. */
  downloads?: () => DownloadsApi | undefined
  now?: () => number
  downloadTimeoutMs?: number
}

type RunReason = 'scheduled' | 'manual'

export class AutomaticBackupService {
  private readonly createBackup: AutomaticBackupServiceOptions['createBackup']
  private readonly downloads: () => DownloadsApi | undefined
  private readonly now: () => number
  private readonly downloadTimeoutMs: number
  private queue: Promise<unknown> = Promise.resolve()
  private listenersRegistered = false
  private requestListenerRegistered = false
  private ready: Promise<void> = Promise.resolve()
  private resolveReady: (() => void) | undefined
  private initialized = false

  constructor(options: AutomaticBackupServiceOptions) {
    this.createBackup = options.createBackup
    this.downloads =
      options.downloads ??
      (() => (browser as unknown as { downloads?: DownloadsApi }).downloads)
    this.now = options.now ?? Date.now
    this.downloadTimeoutMs = options.downloadTimeoutMs ?? DOWNLOAD_TIMEOUT_MS
  }

  /** Answers requests from the start; they wait until initialize() is done. */
  listenForRequests(): void {
    if (this.requestListenerRegistered) return
    if (!this.initialized && !this.resolveReady) {
      this.ready = new Promise<void>((resolve) => {
        this.resolveReady = resolve
      })
    }
    browser.runtime.onMessage.addListener(this.handleRuntimeMessage)
    this.requestListenerRegistered = true
  }

  async initialize(): Promise<void> {
    try {
      this.listenForRequests()
      if (!this.listenersRegistered) {
        browser.alarms.onAlarm.addListener(this.handleAlarm)
        const permissions = browser.permissions as typeof browser.permissions
        permissions.onRemoved?.addListener(this.handlePermissionRemoved)
        this.listenersRegistered = true
      }
      await this.reschedule(STARTUP_DELAY_MS)
    } finally {
      this.initialized = true
      this.resolveReady?.()
      this.resolveReady = undefined
    }
  }

  async handleSettingsUpdated(): Promise<void> {
    await this.reschedule(0)
  }

  readonly handleRuntimeMessage = (
    message: unknown,
  ): Promise<BackupResponse<AutomaticBackupState>> | undefined => {
    if (!isAutomaticBackupRequest(message)) return undefined
    return this.ready.then(async () => {
      try {
        return { ok: true, data: await this.run('manual') }
      } catch (error) {
        return {
          ok: false,
          error: error instanceof Error ? error.message : String(error),
        }
      }
    })
  }

  /**
   * Writes the next backup file, unless a scheduled run finds nothing changed
   * since the last one. Runs one at a time. Failures are recorded in the
   * state; a manual run also rejects with them.
   */
  run(reason: RunReason): Promise<AutomaticBackupState> {
    const result = this.queue.then(() => this.runNow(reason))
    this.queue = result.catch(() => undefined)
    return result
  }

  async readState(): Promise<AutomaticBackupState> {
    const stored = await browser.storage.local.get(AUTOMATIC_BACKUP_STATE_KEY)
    return normalizeAutomaticBackupState(stored[AUTOMATIC_BACKUP_STATE_KEY])
  }

  private async runNow(reason: RunReason): Promise<AutomaticBackupState> {
    const settings = Settings.values
    if (!settings.automaticBackups) {
      if (reason === 'manual') throw new Error(i18n.t('automaticBackupsAreOff'))
      return this.readState()
    }
    const state = await this.readState()
    try {
      if (!(await this.hasDownloadsPermission())) {
        await this.turnOff()
        throw new Error(i18n.t('automaticBackupPermissionMissing'))
      }
      const backup = await this.createBackup({
        includeFavicons: settings.backupIncludeFavicons,
      })
      const folder = sanitizeBackupFolder(settings.automaticBackupFolder)
      const json = JSON.stringify(backup)
      // The export time changes every run, so leave it out of the comparison.
      const digest = await sha256(
        JSON.stringify({ folder, sections: backup.sections }),
      )
      if (reason === 'scheduled' && digest === state.lastDigest) {
        state.lastRunAt = this.now()
        delete state.lastError
        delete state.lastErrorAt
        return state
      }
      const slot = currentSlot(state, settings.automaticBackupKeepCount)
      const file = automaticBackupFileName(folder, slot)
      await this.writeFile(file, json)
      const finishedAt = this.now()
      state.nextSlot = slotAfter(slot, settings.automaticBackupKeepCount)
      state.lastRunAt = finishedAt
      state.lastBackupAt = finishedAt
      state.lastFile = file
      state.lastDigest = digest
      delete state.lastError
      delete state.lastErrorAt
      return state
    } catch (error) {
      state.lastError = error instanceof Error ? error.message : String(error)
      state.lastErrorAt = this.now()
      if (reason === 'manual') throw error
      console.error('Automatic backup failed:', error)
      return state
    } finally {
      await browser.storage.local
        .set({ [AUTOMATIC_BACKUP_STATE_KEY]: state })
        .catch((error) => {
          console.error('Failed to save automatic backup state:', error)
        })
      await this.reschedule(0).catch((error) => {
        console.error('Failed to schedule the next automatic backup:', error)
      })
    }
  }

  /**
   * Saves the file into Downloads, waits for Firefox to finish writing it,
   * then removes it from the download history. The file stays on disk.
   */
  private async writeFile(filename: string, json: string): Promise<void> {
    const downloads = this.downloads()
    if (!downloads) throw new Error(i18n.t('automaticBackupPermissionMissing'))
    const url = URL.createObjectURL(
      new Blob([json], { type: 'application/json' }),
    )
    // Listen before starting, so a quick download cannot finish unseen.
    const finished = new Map<number, DownloadOutcome>()
    let waiting:
      | { id: number; resolve: (o: DownloadOutcome) => void }
      | undefined
    const listener = (delta: browser.downloads._OnChangedDownloadDelta) => {
      const state = delta.state?.current
      if (state !== 'complete' && state !== 'interrupted') return
      const outcome: DownloadOutcome = { state, error: delta.error?.current }
      if (waiting?.id === delta.id) waiting.resolve(outcome)
      else finished.set(delta.id, outcome)
    }
    downloads.onChanged.addListener(listener)
    let id: number | undefined
    let timer: ReturnType<typeof setTimeout> | undefined
    try {
      id = await downloads.download({
        url,
        filename,
        saveAs: false,
        conflictAction: 'overwrite',
      })
      const downloadId = id
      const outcome =
        finished.get(downloadId) ??
        (await new Promise<DownloadOutcome | undefined>((resolve) => {
          waiting = { id: downloadId, resolve }
          timer = setTimeout(() => resolve(undefined), this.downloadTimeoutMs)
        }))
      if (!outcome) {
        await downloads.cancel(downloadId).catch(() => undefined)
        throw new Error(i18n.t('automaticBackupTimedOut'))
      }
      if (outcome.state === 'interrupted') {
        throw new Error(
          i18n.t('automaticBackupDownloadFailed', [outcome.error ?? '']),
        )
      }
    } finally {
      if (timer) clearTimeout(timer)
      downloads.onChanged.removeListener(listener)
      URL.revokeObjectURL(url)
      if (id !== undefined) {
        await downloads.erase({ id }).catch((error) => {
          console.error('Failed to clear backup from download history:', error)
        })
      }
    }
  }

  private async reschedule(minimumDelayMs: number): Promise<void> {
    await browser.alarms.clear(AUTOMATIC_BACKUP_ALARM_NAME)
    if (!Settings.values.automaticBackups) return
    const now = this.now()
    const due = nextAutomaticBackupAt(
      await this.readState(),
      Settings.values,
      now,
    )
    await browser.alarms.create(AUTOMATIC_BACKUP_ALARM_NAME, {
      when: Math.max(due, now + minimumDelayMs),
    })
  }

  private async hasDownloadsPermission(): Promise<boolean> {
    if (!this.downloads()) return false
    return browser.permissions.contains({ permissions: [DOWNLOADS_PERMISSION] })
  }

  /** Without the permission no backup can be written, so stop scheduling. */
  private async turnOff(): Promise<void> {
    if (!Settings.values.automaticBackups) return
    Settings.values.automaticBackups = false
    try {
      await Settings.saveSettingsToStorage()
    } catch (error) {
      console.error('Failed to turn off automatic backups:', error)
    }
    await browser.alarms.clear(AUTOMATIC_BACKUP_ALARM_NAME)
  }

  private readonly handleAlarm = (alarm: browser.alarms.Alarm): void => {
    if (alarm.name !== AUTOMATIC_BACKUP_ALARM_NAME) return
    void this.run('scheduled')
  }

  private readonly handlePermissionRemoved = (removed: {
    permissions?: string[]
  }): void => {
    if (!removed.permissions?.includes(DOWNLOADS_PERMISSION)) return
    this.queue = this.queue
      .then(() => this.turnOff())
      .catch((error) => {
        console.error('Failed to handle removed downloads permission:', error)
      })
  }
}

async function sha256(text: string): Promise<string> {
  const digest = await crypto.subtle.digest(
    'SHA-256',
    new TextEncoder().encode(text),
  )
  return Array.from(new Uint8Array(digest), (byte) =>
    byte.toString(16).padStart(2, '0'),
  ).join('')
}

function isAutomaticBackupRequest(
  value: unknown,
): value is AutomaticBackupRequest {
  return (
    typeof value === 'object' &&
    value !== null &&
    (value as Record<string, unknown>).action === 'runAutomaticBackup'
  )
}

export const AutomaticBackups = new AutomaticBackupService({
  createBackup: (options) => Backups.createBackup(options),
})
