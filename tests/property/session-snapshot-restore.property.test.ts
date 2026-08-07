import { describe, expect, it } from 'vitest'
import fc from 'fast-check'
import { projectSnapshotForRestore } from '@/services/session-snapshot-restore'
import { State, TreeItemType } from '@/types/session-tree'
import type { SessionSnapshotPayload } from '@/types/session-snapshots'

describe('session snapshot restore properties', () => {
  it('produces unique saved items without dangling parents', () => {
    fc.assert(
      fc.property(
        fc.array(fc.string({ minLength: 1, maxLength: 20 }), {
          minLength: 1,
          maxLength: 50,
        }),
        (titles) => {
          const windowUid = 'window-source' as UID
          const payload: SessionSnapshotPayload = {
            schemaVersion: 1,
            items: [
              {
                type: TreeItemType.WINDOW,
                uid: windowUid,
                incognito: false,
                state: State.OPEN,
                children: titles.map((title, index) => ({
                  type: TreeItemType.TAB,
                  uid: `tab-${index}` as UID,
                  state: State.OPEN,
                  title,
                  url: `https://example.test/${index}`,
                  windowUid,
                  indentLevel: 1,
                  pinned: false,
                })),
                indentLevel: 0,
              },
            ],
          }

          const result = projectSnapshotForRestore({
            payload,
            mode: 'all',
            selectedUids: new Set(),
            existingUids: new Set(['existing' as UID]),
          })
          const allItems = result.items.flatMap((item) =>
            item.type === TreeItemType.WINDOW
              ? [item, ...item.children]
              : [item],
          )
          const uids = allItems.map((item) => item.uid)
          const uidSet = new Set(uids)

          expect(uidSet.size).toBe(uids.length)
          expect(uidSet.has('existing' as UID)).toBe(false)
          expect(
            allItems.every(
              (item) =>
                item.parentUid === undefined || uidSet.has(item.parentUid),
            ),
          ).toBe(true)
          expect(
            allItems
              .filter((item) => item.type === TreeItemType.TAB)
              .every((item) => item.state === State.SAVED && item.id === -1),
          ).toBe(true)
        },
      ),
      { numRuns: 100 },
    )
  })
})
