import { describe, expect, it } from 'vitest'
import fc from 'fast-check'
import {
  createSessionFlowBackup,
  parseSessionFlowBackup,
} from '@/services/backup-codec'
import { createSessionSnapshotExport } from '@/services/session-snapshot-codec'
import type {
  SessionSnapshotMetadata,
  SessionSnapshotPayload,
  SnapshotTopLevelItem,
} from '@/types/session-snapshots'
import { State, TreeItemType } from '@/types/session-tree'

const tabArbitrary = fc.record({
  title: fc.string({ maxLength: 30 }),
  path: fc.webPath({ size: 'small' }),
  pinned: fc.boolean(),
  state: fc.constantFrom(State.SAVED, State.OPEN, State.DISCARDED),
})

const windowArbitrary = fc.record({
  incognito: fc.boolean(),
  state: fc.constantFrom(State.SAVED, State.OPEN),
  tabs: fc.array(tabArbitrary, { maxLength: 8 }),
})

const topLevelArbitrary = fc.array(
  fc.oneof(
    windowArbitrary.map((window) => ({ kind: 'window' as const, window })),
    fc
      .string({ maxLength: 40 })
      .map((text) => ({ kind: 'note' as const, text })),
  ),
  { maxLength: 6 },
)

type TopLevelEntries =
  typeof topLevelArbitrary extends fc.Arbitrary<infer T> ? T : never

function buildPayload(entries: TopLevelEntries): SessionSnapshotPayload {
  const items: SnapshotTopLevelItem[] = entries.map((entry, index) => {
    if (entry.kind === 'note') {
      return {
        type: TreeItemType.NOTE,
        uid: `note-${index}` as UID,
        text: entry.text,
        indentLevel: 0,
      }
    }
    const windowUid = `window-${index}` as UID
    return {
      type: TreeItemType.WINDOW,
      uid: windowUid,
      incognito: entry.window.incognito,
      state: entry.window.state,
      indentLevel: 0,
      children: entry.window.tabs.map((tab, tabIndex) => ({
        type: TreeItemType.TAB,
        uid: `tab-${index}-${tabIndex}` as UID,
        state: tab.state,
        title: tab.title,
        url: `https://example.test${tab.path}`,
        windowUid,
        indentLevel: 1,
        pinned: tab.pinned,
      })),
    }
  })
  return { schemaVersion: 1, items }
}

function metadata(id: string, createdAt: number): SessionSnapshotMetadata {
  return {
    id,
    schemaVersion: 1,
    createdAt,
    trigger: 'periodic',
    protected: false,
    digest: '',
    sizeBytes: 0,
    counts: { windows: 0, tabs: 0, notes: 0, separators: 0 },
    containsPrivateWindows: false,
    available: true,
  }
}

describe('backup codec properties', () => {
  it('reads back the tree and snapshot history it wrote', () => {
    fc.assert(
      fc.property(
        topLevelArbitrary,
        fc.array(topLevelArbitrary, { maxLength: 4 }),
        fc.integer({ min: 0, max: 4_102_444_800_000 }),
        (tree, history, exportedAt) => {
          const sessionTree = buildPayload(tree)
          const snapshots = history.map((entries, index) =>
            createSessionSnapshotExport(
              metadata(`snapshot-${index}`, exportedAt - index),
              buildPayload(entries),
            ),
          )
          const backup = createSessionFlowBackup({
            exportedAt,
            extensionVersion: '1.0.0',
            sections: { sessionTree, snapshots },
          })

          const parsed = parseSessionFlowBackup(JSON.stringify(backup))

          expect(parsed.invalidSections).toEqual([])
          expect(parsed.skippedSnapshots).toBe(0)
          expect(parsed.backup.exportedAt).toBe(exportedAt)
          expect(parsed.backup.sections.sessionTree).toEqual(sessionTree)
          expect(
            parsed.backup.sections.snapshots?.map((entry) => ({
              id: entry.metadata.id,
              createdAt: entry.metadata.createdAt,
              payload: entry.payload,
            })),
          ).toEqual(
            snapshots.map((entry) => ({
              id: entry.metadata.id,
              createdAt: entry.metadata.createdAt,
              payload: entry.payload,
            })),
          )
        },
      ),
      { numRuns: 100 },
    )
  })
})
