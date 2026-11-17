import { describe, expect, it } from 'vitest'
import {
  describeAutomaticBackups,
  formatDateTime,
} from '@/services/automatic-backup-status'

const HOUR = 60 * 60 * 1000
const now = Date.UTC(2026, 10, 17, 12, 0)
const daily = {
  automaticBackups: true,
  automaticBackupInterval: 1,
  automaticBackupIntervalUnit: 'days',
} as const

describe('automatic backup status', () => {
  it('says no backup was made yet, and that one is due now', () => {
    expect(describeAutomaticBackups({ nextSlot: 1 }, daily, now)).toEqual([
      'No automatic backup has been saved yet.',
      `Next backup: ${formatDateTime(now)}`,
    ])
  })

  it('names the last file and when the next backup is due', () => {
    const lastBackupAt = now - 2 * HOUR
    expect(
      describeAutomaticBackups(
        {
          nextSlot: 2,
          lastRunAt: lastBackupAt,
          lastBackupAt,
          lastFile: 'Session Flow/session-flow-backup-1.json',
        },
        daily,
        now,
      ),
    ).toEqual([
      `Last backup: ${formatDateTime(lastBackupAt)}, saved as Session Flow/session-flow-backup-1.json`,
      `Next backup: ${formatDateTime(lastBackupAt + 24 * HOUR)}`,
    ])
  })

  it('reports a failure newer than the last run', () => {
    const lines = describeAutomaticBackups(
      {
        nextSlot: 1,
        lastRunAt: now - 3 * HOUR,
        lastErrorAt: now - HOUR,
        lastError: 'Disk full',
      },
      daily,
      now,
    )

    expect(lines[1]).toBe(
      `The backup at ${formatDateTime(now - HOUR)} failed: Disk full`,
    )
  })

  it('leaves out an old failure and the next run while turned off', () => {
    expect(
      describeAutomaticBackups(
        {
          nextSlot: 1,
          lastRunAt: now,
          lastErrorAt: now - HOUR,
          lastError: 'Disk full',
        },
        { ...daily, automaticBackups: false },
        now,
      ),
    ).toEqual(['No automatic backup has been saved yet.'])
  })
})
