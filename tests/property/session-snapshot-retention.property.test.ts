import { describe, expect, it } from 'vitest'
import fc from 'fast-check'
import { snapshotIdsToRetain } from '@/services/session-snapshot-retention'
import type { SessionSnapshotMetadata } from '@/types/session-snapshots'

const NOW = new Date(2026, 7, 2, 12).getTime()
const SIX_HOURS = 6 * 60 * 60 * 1000

describe('session snapshot retention properties', () => {
  it('always retains protected and rolling-six-hour snapshots without duplicates', () => {
    fc.assert(
      fc.property(
        fc.array(
          fc.record({
            age: fc.integer({ min: 0, max: 10 * 365 * 24 * 60 * 60 * 1000 }),
            protected: fc.boolean(),
          }),
          { maxLength: 200 },
        ),
        (entries) => {
          const metadata = entries.map(
            (entry, index): SessionSnapshotMetadata => ({
              id: `snapshot-${index}`,
              schemaVersion: 1,
              createdAt: NOW - entry.age,
              trigger: 'periodic',
              protected: entry.protected,
              digest: String(index),
              sizeBytes: 1,
              counts: { windows: 0, tabs: 0, notes: 0, separators: 0 },
              containsPrivateWindows: false,
              available: true,
            }),
          )

          const retained = snapshotIdsToRetain(metadata, NOW)

          expect(new Set(retained).size).toBe(retained.size)
          expect(
            metadata
              .filter(
                (item) => item.protected || NOW - item.createdAt <= SIX_HOURS,
              )
              .every((item) => retained.has(item.id)),
          ).toBe(true)
        },
      ),
      { numRuns: 100 },
    )
  })
})
