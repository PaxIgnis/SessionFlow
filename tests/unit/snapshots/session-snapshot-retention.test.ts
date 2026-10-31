import { describe, expect, it } from 'vitest'
import { DEFAULT_SETTINGS } from '@/defaults/settings'
import {
  DEFAULT_SNAPSHOT_RETENTION,
  type SnapshotRetentionPolicy,
  snapshotIdsToRetain,
  snapshotRetentionPolicy,
} from '@/services/session-snapshot-retention'
import type { SessionSnapshotMetadata } from '@/types/session-snapshots'

const NOW = new Date(2026, 7, 2, 12, 0, 0).getTime()
const HOUR = 60 * 60 * 1000
const DAY = 24 * HOUR

describe('session snapshot retention', () => {
  it('keeps every snapshot from the rolling previous six hours', () => {
    const metadata = Array.from({ length: 9 }, (_, index) =>
      snapshot(`hour-${index}`, NOW - index * HOUR),
    )

    const retained = snapshotIdsToRetain(metadata, NOW)

    expect(metadata.slice(0, 7).every((item) => retained.has(item.id))).toBe(
      true,
    )
  })

  it('keeps the ten newest snapshots even when they are older than six hours', () => {
    const metadata = Array.from({ length: 14 }, (_, index) =>
      snapshot(`newest-${index}`, NOW - (index + 7) * HOUR),
    )

    const retained = snapshotIdsToRetain(metadata, NOW)

    expect(metadata.slice(0, 10).every((item) => retained.has(item.id))).toBe(
      true,
    )
  })

  it('keeps protected snapshots regardless of age', () => {
    const protectedSnapshot = snapshot('protected', NOW - 20 * 365 * DAY, true)

    expect(snapshotIdsToRetain([protectedSnapshot], NOW)).toContain(
      protectedSnapshot.id,
    )
  })

  it('keeps one newest representative for daily weekly monthly and yearly buckets', () => {
    const metadata = [
      snapshot('daily-newest', new Date(2026, 7, 1, 18).getTime()),
      snapshot('daily-older', new Date(2026, 7, 1, 9).getTime()),
      snapshot('weekly', new Date(2026, 6, 20, 12).getTime()),
      snapshot('monthly', new Date(2026, 2, 15, 12).getTime()),
      snapshot('yearly', new Date(2024, 5, 1, 12).getTime()),
    ]

    const retained = snapshotIdsToRetain(metadata, NOW)

    expect([...retained]).toEqual(
      expect.arrayContaining(['daily-newest', 'weekly', 'monthly', 'yearly']),
    )
  })

  it('returns ids in newest-first order without mutating metadata', () => {
    const metadata = [
      snapshot('older', NOW - DAY),
      snapshot('newer', NOW - HOUR),
    ]
    const original = structuredClone(metadata)

    expect([...snapshotIdsToRetain(metadata, NOW)]).toEqual(['newer', 'older'])
    expect(metadata).toEqual(original)
  })
})

describe('configurable session snapshot retention', () => {
  const nothingBeyondNewest: SnapshotRetentionPolicy = {
    enabled: true,
    recentHours: 0,
    newest: 1,
    days: 0,
    weeks: 0,
    months: 0,
    years: 0,
  }

  it('defaults to the policy the settings ship with', () => {
    expect(DEFAULT_SNAPSHOT_RETENTION).toEqual({
      enabled: true,
      recentHours: 6,
      newest: 10,
      days: 10,
      weeks: 8,
      months: 12,
      years: 5,
    })
    expect(snapshotRetentionPolicy(DEFAULT_SETTINGS)).toEqual(
      DEFAULT_SNAPSHOT_RETENTION,
    )
  })

  it('maps each retention setting onto the policy', () => {
    expect(
      snapshotRetentionPolicy({
        pruneSessionSnapshots: false,
        sessionSnapshotKeepRecentHours: 1,
        sessionSnapshotKeepNewest: 2,
        sessionSnapshotKeepDays: 3,
        sessionSnapshotKeepWeeks: 4,
        sessionSnapshotKeepMonths: 5,
        sessionSnapshotKeepYears: 6,
      }),
    ).toEqual({
      enabled: false,
      recentHours: 1,
      newest: 2,
      days: 3,
      weeks: 4,
      months: 5,
      years: 6,
    })
  })

  it('keeps every snapshot when automatic removal is off', () => {
    const metadata = Array.from({ length: 40 }, (_, index) =>
      snapshot(`old-${index}`, NOW - (index + 1) * 400 * DAY),
    )

    const retained = snapshotIdsToRetain(metadata, NOW, {
      ...nothingBeyondNewest,
      enabled: false,
    })

    expect(retained.size).toBe(metadata.length)
  })

  it('keeps only the newest and protected snapshots when every period is zero', () => {
    const metadata = [
      snapshot('newest', NOW - HOUR),
      snapshot('recent', NOW - 2 * HOUR),
      snapshot('yesterday', NOW - DAY),
      snapshot('protected', NOW - 900 * DAY, true),
    ]

    expect([
      ...snapshotIdsToRetain(metadata, NOW, nothingBeyondNewest),
    ]).toEqual(['newest', 'protected'])
  })

  it('honours custom recent, newest and daily limits', () => {
    const hourly = Array.from({ length: 5 }, (_, index) =>
      snapshot(`hour-${index}`, NOW - index * HOUR),
    )
    const daily = Array.from({ length: 5 }, (_, index) =>
      snapshot(`day-${index + 1}`, NOW - (index + 1) * DAY),
    )

    const retained = snapshotIdsToRetain([...hourly, ...daily], NOW, {
      ...nothingBeyondNewest,
      recentHours: 2,
      days: 3,
    })

    expect([...retained]).toEqual([
      'hour-0',
      'hour-1',
      'hour-2',
      'day-1',
      'day-2',
    ])
  })

  it('keeps one snapshot per week, month and year up to each custom limit', () => {
    const metadata = [
      snapshot('this-week', new Date(2026, 7, 1, 12).getTime()),
      snapshot('last-week', new Date(2026, 6, 25, 12).getTime()),
      snapshot('two-weeks-ago', new Date(2026, 6, 18, 12).getTime()),
      snapshot('last-month', new Date(2026, 5, 10, 12).getTime()),
      snapshot('last-year', new Date(2025, 1, 10, 12).getTime()),
      snapshot('two-years-ago', new Date(2024, 1, 10, 12).getTime()),
    ]

    const retained = snapshotIdsToRetain(metadata, NOW, {
      ...nothingBeyondNewest,
      newest: 1,
      weeks: 2,
      months: 3,
      years: 2,
    })

    expect([...retained]).toEqual([
      'this-week',
      'last-week',
      'last-month',
      'last-year',
    ])
  })
})

function snapshot(
  id: string,
  createdAt: number,
  protectedValue = false,
): SessionSnapshotMetadata {
  return {
    id,
    schemaVersion: 1,
    createdAt,
    trigger: 'periodic',
    protected: protectedValue,
    digest: id,
    sizeBytes: 1,
    counts: { windows: 0, tabs: 0, notes: 0, separators: 0 },
    containsPrivateWindows: false,
    available: true,
  }
}
