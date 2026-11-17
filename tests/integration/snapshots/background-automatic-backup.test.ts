import { beforeEach, describe, expect, it, vi } from 'vitest'
import { DEFAULT_SETTINGS } from '@/defaults/settings'
import { AUTOMATIC_BACKUP_RETRY_MS } from '@/services/automatic-backup-schedule'
import {
  AUTOMATIC_BACKUP_ALARM_NAME,
  AutomaticBackupService,
} from '@/services/background-automatic-backup'
import { Settings } from '@/services/settings'
import {
  AUTOMATIC_BACKUP_STATE_KEY,
  type AutomaticBackupState,
  type SessionFlowBackup,
  type SessionFlowBackupSections,
} from '@/types/backup'
import { flushMicrotasks, installFakeBrowser } from '../../helpers/fake-browser'

const DAY = 24 * 60 * 60 * 1000

type Outcome = 'complete' | 'interrupted' | 'early' | 'never'
type DownloadDelta = browser.downloads._OnChangedDownloadDelta

function createFakeDownloads() {
  let listeners: Array<(delta: DownloadDelta) => void> = []
  let nextId = 1
  const fake = {
    outcome: 'complete' as Outcome,
    onChanged: {
      addListener: (listener: (delta: DownloadDelta) => void) => {
        listeners.push(listener)
      },
      removeListener: (listener: (delta: DownloadDelta) => void) => {
        listeners = listeners.filter((current) => current !== listener)
      },
    },
    get listenerCount() {
      return listeners.length
    },
    download: vi.fn(async (_options: browser.downloads._DownloadOptions) => {
      const id = nextId++
      const emit = (delta: DownloadDelta) => {
        for (const listener of [...listeners]) listener(delta)
      }
      if (fake.outcome === 'early') {
        // Firefox can report completion before download() resolves.
        emit({ id, state: { current: 'complete' } })
      } else if (fake.outcome === 'complete') {
        setTimeout(() => emit({ id, state: { current: 'complete' } }))
      } else if (fake.outcome === 'interrupted') {
        setTimeout(() =>
          emit({
            id,
            state: { current: 'interrupted' },
            error: { current: 'FILE_ACCESS_DENIED' },
          }),
        )
      }
      return id
    }),
    erase: vi.fn(async () => []),
    cancel: vi.fn(async () => undefined),
  }
  return fake
}

describe('automatic backups', () => {
  let fakeBrowser: ReturnType<typeof installFakeBrowser>
  let store: Record<string, unknown>
  let downloads: ReturnType<typeof createFakeDownloads>
  let downloadsAvailable: boolean
  let sections: SessionFlowBackupSections
  let clock: number
  let service: AutomaticBackupService

  beforeEach(() => {
    fakeBrowser = installFakeBrowser()
    store = {}
    fakeBrowser.storage.local.get.mockImplementation(async (key: string) =>
      key in store ? { [key]: structuredClone(store[key]) } : {},
    )
    fakeBrowser.storage.local.set.mockImplementation(
      async (items: Record<string, unknown>) => {
        Object.assign(store, structuredClone(items))
      },
    )
    fakeBrowser.permissions.contains.mockResolvedValue(true)
    Object.assign(Settings.values, structuredClone(DEFAULT_SETTINGS), {
      automaticBackups: true,
      automaticBackupFolder: 'Session Flow',
      automaticBackupKeepCount: 2,
    })
    downloads = createFakeDownloads()
    downloadsAvailable = true
    sections = { settings: { focusTabOnOpen: true } }
    clock = 1_000_000
    service = new AutomaticBackupService({
      createBackup: async (): Promise<SessionFlowBackup> => ({
        format: 'session-flow-backup',
        version: 1,
        exportedAt: clock,
        extensionVersion: '1.0.0',
        sections: structuredClone(sections),
      }),
      downloads: () => (downloadsAvailable ? downloads : undefined),
      now: () => clock,
      downloadTimeoutMs: 50,
    })
  })

  function savedState(): AutomaticBackupState | undefined {
    return store[AUTOMATIC_BACKUP_STATE_KEY] as AutomaticBackupState | undefined
  }

  function writtenFiles(): string[] {
    return downloads.download.mock.calls.map(([options]) => options.filename!)
  }

  function lastAlarm() {
    const calls = fakeBrowser.alarms.create.mock.calls
    return calls.at(-1) as [string, { when: number }] | undefined
  }

  it('writes the next slot file and keeps it out of the download history', async () => {
    const revoke = vi.spyOn(URL, 'revokeObjectURL')

    const state = await service.run('scheduled')

    expect(downloads.download).toHaveBeenCalledWith(
      expect.objectContaining({
        filename: 'Session Flow/session-flow-backup-1.json',
        saveAs: false,
        conflictAction: 'overwrite',
      }),
    )
    expect(downloads.erase).toHaveBeenCalledWith({ id: 1 })
    expect(revoke).toHaveBeenCalledWith(downloads.download.mock.calls[0][0].url)
    expect(downloads.listenerCount).toBe(0)
    expect(state).toMatchObject({
      nextSlot: 2,
      lastRunAt: clock,
      lastBackupAt: clock,
      lastFile: 'Session Flow/session-flow-backup-1.json',
    })
    expect(savedState()).toEqual(state)
    expect(lastAlarm()).toEqual([
      AUTOMATIC_BACKUP_ALARM_NAME,
      { when: clock + DAY },
    ])
  })

  it('overwrites the oldest file once the keep count is reached', async () => {
    for (let run = 0; run < 3; run++) {
      sections = { settings: { focusTabOnOpen: run % 2 === 0 } }
      clock += DAY
      await service.run('scheduled')
    }

    expect(writtenFiles()).toEqual([
      'Session Flow/session-flow-backup-1.json',
      'Session Flow/session-flow-backup-2.json',
      'Session Flow/session-flow-backup-1.json',
    ])
  })

  it('skips a scheduled run when nothing changed, but not a manual one', async () => {
    await service.run('scheduled')
    clock += DAY

    const skipped = await service.run('scheduled')

    expect(downloads.download).toHaveBeenCalledTimes(1)
    expect(skipped).toMatchObject({ nextSlot: 2, lastRunAt: clock })
    expect(skipped.lastBackupAt).toBe(clock - DAY)
    expect(lastAlarm()?.[1].when).toBe(clock + DAY)

    await service.run('manual')
    expect(writtenFiles()).toHaveLength(2)
  })

  it('writes again after the folder changes, even with the same data', async () => {
    await service.run('scheduled')
    Settings.values.automaticBackupFolder = 'Backups/../Other'

    await service.run('scheduled')

    expect(writtenFiles()).toEqual([
      'Session Flow/session-flow-backup-1.json',
      'Backups/Other/session-flow-backup-2.json',
    ])
  })

  it('handles a download that finishes before Firefox returns its id', async () => {
    downloads.outcome = 'early'

    const state = await service.run('scheduled')

    expect(state.lastFile).toBe('Session Flow/session-flow-backup-1.json')
    expect(downloads.erase).toHaveBeenCalledWith({ id: 1 })
  })

  it('records a failed download, keeps the slot and retries sooner', async () => {
    downloads.outcome = 'interrupted'
    vi.spyOn(console, 'error').mockImplementation(() => undefined)

    const state = await service.run('scheduled')

    expect(state).toMatchObject({
      nextSlot: 1,
      lastErrorAt: clock,
      lastError: expect.stringContaining('FILE_ACCESS_DENIED'),
    })
    expect(state.lastBackupAt).toBeUndefined()
    expect(downloads.erase).toHaveBeenCalledWith({ id: 1 })
    expect(lastAlarm()?.[1].when).toBe(clock + AUTOMATIC_BACKUP_RETRY_MS)

    downloads.outcome = 'complete'
    clock += AUTOMATIC_BACKUP_RETRY_MS
    const retried = await service.run('scheduled')
    expect(retried.lastError).toBeUndefined()
    expect(retried.lastFile).toBe('Session Flow/session-flow-backup-1.json')
  })

  it('cancels a download that never finishes', async () => {
    downloads.outcome = 'never'

    await expect(service.run('manual')).rejects.toThrow('in time')

    expect(downloads.cancel).toHaveBeenCalledWith(1)
    expect(downloads.erase).toHaveBeenCalledWith({ id: 1 })
    expect(savedState()?.lastError).toContain('in time')
  })

  it('turns itself off when the downloads permission is missing', async () => {
    fakeBrowser.permissions.contains.mockResolvedValue(false)
    vi.spyOn(console, 'error').mockImplementation(() => undefined)

    const state = await service.run('scheduled')

    expect(downloads.download).not.toHaveBeenCalled()
    expect(Settings.values.automaticBackups).toBe(false)
    expect((store.settings as typeof DEFAULT_SETTINGS).automaticBackups).toBe(
      false,
    )
    expect(state.lastError).toContain('not allowed to manage downloads')
    expect(fakeBrowser.alarms.clear).toHaveBeenCalledWith(
      AUTOMATIC_BACKUP_ALARM_NAME,
    )
    expect(fakeBrowser.alarms.create).not.toHaveBeenCalled()
  })

  it('treats a missing downloads API as a missing permission', async () => {
    downloadsAvailable = false
    vi.spyOn(console, 'error').mockImplementation(() => undefined)

    await service.run('scheduled')

    expect(Settings.values.automaticBackups).toBe(false)
  })

  it('turns itself off when the downloads permission is removed', async () => {
    await service.initialize()

    fakeBrowser.permissions.onRemoved.emit({
      permissions: ['downloads'],
    } as never)
    await vi.waitFor(() => expect(Settings.values.automaticBackups).toBe(false))
  })

  it('ignores removal of other permissions', async () => {
    await service.initialize()

    fakeBrowser.permissions.onRemoved.emit({ origins: ['https://*/*'] })
    await flushMicrotasks()

    expect(Settings.values.automaticBackups).toBe(true)
  })

  it('catches up shortly after startup when a backup is overdue', async () => {
    store[AUTOMATIC_BACKUP_STATE_KEY] = {
      nextSlot: 1,
      lastRunAt: clock - DAY * 3,
    }

    await service.initialize()

    expect(lastAlarm()).toEqual([
      AUTOMATIC_BACKUP_ALARM_NAME,
      { when: clock + 60_000 },
    ])
  })

  it('waits for the schedule at startup when a backup is not due', async () => {
    store[AUTOMATIC_BACKUP_STATE_KEY] = {
      nextSlot: 1,
      lastRunAt: clock - 1_000,
    }

    await service.initialize()

    expect(lastAlarm()?.[1].when).toBe(clock - 1_000 + DAY)
  })

  it('schedules nothing while automatic backups are off', async () => {
    Settings.values.automaticBackups = false

    await service.initialize()
    await service.handleSettingsUpdated()

    expect(fakeBrowser.alarms.clear).toHaveBeenCalledWith(
      AUTOMATIC_BACKUP_ALARM_NAME,
    )
    expect(fakeBrowser.alarms.create).not.toHaveBeenCalled()
  })

  it('runs when its alarm fires and ignores other alarms', async () => {
    await service.initialize()

    fakeBrowser.alarms.onAlarm.emit({
      name: 'session-flow-periodic-snapshot',
      scheduledTime: clock,
    })
    await flushMicrotasks()
    expect(downloads.download).not.toHaveBeenCalled()

    fakeBrowser.alarms.onAlarm.emit({
      name: AUTOMATIC_BACKUP_ALARM_NAME,
      scheduledTime: clock,
    })
    await vi.waitFor(() => expect(savedState()?.lastFile).toBeDefined())
  })

  it('answers a request to back up now', async () => {
    service.listenForRequests()
    const response = service.handleRuntimeMessage({
      action: 'runAutomaticBackup',
    })
    await service.initialize()

    await expect(response).resolves.toMatchObject({
      ok: true,
      data: { lastFile: 'Session Flow/session-flow-backup-1.json' },
    })
    expect(service.handleRuntimeMessage({ action: 'other' })).toBeUndefined()
  })

  it('refuses to back up now while automatic backups are off', async () => {
    Settings.values.automaticBackups = false
    await service.initialize()

    await expect(
      service.handleRuntimeMessage({ action: 'runAutomaticBackup' }),
    ).resolves.toMatchObject({ ok: false, error: 'Automatic backups are off.' })
    expect(downloads.download).not.toHaveBeenCalled()
  })
})
