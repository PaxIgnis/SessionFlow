import { describe, expect, it } from 'vitest'
import {
  AUTOMATIC_BACKUP_RETRY_MS,
  automaticBackupFileName,
  automaticBackupIntervalMs,
  currentSlot,
  nextAutomaticBackupAt,
  normalizeAutomaticBackupState,
  sanitizeBackupFolder,
  slotAfter,
} from '@/services/automatic-backup-schedule'

const HOUR = 60 * 60 * 1000
const daily = {
  automaticBackupInterval: 1,
  automaticBackupIntervalUnit: 'days',
} as const

describe('automatic backup folder', () => {
  it.each([
    ['Session Flow', 'Session Flow'],
    ['  Backups / Session Flow  ', 'Backups/Session Flow'],
    ['Backups\\Session Flow', 'Backups/Session Flow'],
    ['../../outside', 'outside'],
    ['/absolute/path/', 'absolute/path'],
    ['C:\\Users\\me', 'C/Users/me'],
    ['what?<now>*|"', 'whatnow'],
    ['tab\there', 'tabhere'],
    ['ends with dots...', 'ends with dots'],
    ['.hidden', 'hidden'],
    ['CON', 'CON_'],
    ['backups/nul.txt', 'backups/nul.txt_'],
    ['console', 'console'],
    ['', 'Session Flow'],
    ['..', 'Session Flow'],
    ['  /  ', 'Session Flow'],
  ])('turns %j into %j', (input, expected) => {
    expect(sanitizeBackupFolder(input)).toBe(expected)
  })

  it('shortens very long folder names', () => {
    expect(sanitizeBackupFolder('a'.repeat(300))).toHaveLength(100)
    expect(sanitizeBackupFolder(`${'a'.repeat(99)}.b`)).toBe('a'.repeat(99))
  })

  it('names each slot file inside the folder', () => {
    expect(automaticBackupFileName('../Backups', 3)).toBe(
      'Backups/session-flow-backup-3.json',
    )
  })
})

describe('automatic backup rotation', () => {
  it('cycles through the slots', () => {
    expect(slotAfter(1, 3)).toBe(2)
    expect(slotAfter(3, 3)).toBe(1)
    expect(slotAfter(1, 1)).toBe(1)
  })

  it('starts again from the first slot when fewer are kept', () => {
    expect(currentSlot({ nextSlot: 4 }, 5)).toBe(4)
    expect(currentSlot({ nextSlot: 4 }, 3)).toBe(1)
    expect(currentSlot({ nextSlot: 0 }, 3)).toBe(1)
  })
})

describe('automatic backup schedule', () => {
  it.each([
    [{ automaticBackupInterval: 6, automaticBackupIntervalUnit: 'hours' }, 6],
    [{ automaticBackupInterval: 2, automaticBackupIntervalUnit: 'days' }, 48],
    [{ automaticBackupInterval: 1, automaticBackupIntervalUnit: 'weeks' }, 168],
  ] as const)('converts %o to %i hours', (settings, hours) => {
    expect(automaticBackupIntervalMs(settings)).toBe(hours * HOUR)
  })

  it('is due straight away before the first backup', () => {
    expect(nextAutomaticBackupAt({ nextSlot: 1 }, daily, 500)).toBe(500)
  })

  it('is due one interval after the last run', () => {
    expect(
      nextAutomaticBackupAt({ nextSlot: 2, lastRunAt: 1_000 }, daily, 2_000),
    ).toBe(1_000 + 24 * HOUR)
  })

  it('retries a failed run after an hour, or sooner on a short schedule', () => {
    const failed = { nextSlot: 1, lastRunAt: 1_000, lastErrorAt: 5_000 }

    expect(nextAutomaticBackupAt(failed, daily, 6_000)).toBe(
      5_000 + AUTOMATIC_BACKUP_RETRY_MS,
    )
    expect(
      nextAutomaticBackupAt(
        failed,
        { automaticBackupInterval: 1, automaticBackupIntervalUnit: 'hours' },
        6_000,
      ),
    ).toBe(5_000 + HOUR)
  })

  it('ignores a failure that a later run has replaced', () => {
    expect(
      nextAutomaticBackupAt(
        { nextSlot: 1, lastRunAt: 9_000, lastErrorAt: 5_000 },
        daily,
        10_000,
      ),
    ).toBe(9_000 + 24 * HOUR)
  })
})

describe('automatic backup state', () => {
  it('starts from the first slot when nothing is stored', () => {
    expect(normalizeAutomaticBackupState(undefined)).toEqual({ nextSlot: 1 })
    expect(normalizeAutomaticBackupState('junk')).toEqual({ nextSlot: 1 })
  })

  it('keeps valid fields and drops malformed ones', () => {
    expect(
      normalizeAutomaticBackupState({
        nextSlot: 3,
        lastRunAt: 10,
        lastBackupAt: 'yesterday',
        lastFile: 'Session Flow/session-flow-backup-2.json',
        lastDigest: 42,
        lastError: 'Disk full',
        lastErrorAt: -1,
      }),
    ).toEqual({
      nextSlot: 3,
      lastRunAt: 10,
      lastFile: 'Session Flow/session-flow-backup-2.json',
      lastError: 'Disk full',
    })
  })
})
