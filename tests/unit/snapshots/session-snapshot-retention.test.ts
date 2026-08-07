import { describe, expect, it } from 'vitest'
import { snapshotIdsToRetain } from '@/services/session-snapshot-retention'
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
