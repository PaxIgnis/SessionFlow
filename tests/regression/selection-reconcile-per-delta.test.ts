import { SessionTree } from '@/services/foreground-tree'
import { Selection } from '@/services/selection'
import { SelectionType, type Tab } from '@/types/session-tree'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { toRaw, watch, type WatchStopHandle } from 'vue'
import {
  makeForegroundNote,
  makeForegroundTab,
  makeForegroundWindow,
  resetForegroundTree,
} from '../helpers/foreground-tree-fixtures'

const TAB_COUNT = 200
const WINDOW_UID = 'window-1' as UID

function mouse(overrides: Partial<MouseEvent> = {}): MouseEvent {
  return {
    ctrlKey: false,
    metaKey: false,
    shiftKey: false,
    ...overrides,
  } as MouseEvent
}

/*
 * The sidebar re-checks the selection after every background delta. It looks entries
 * up in the uid indexes and leaves the array alone unless an entry was dropped or swapped.
 */
describe('selection reconciliation after deltas', () => {
  let tabs: Tab[]
  let stop: WatchStopHandle | undefined

  beforeEach(() => {
    Selection.clearSelection()
    resetForegroundTree([
      makeForegroundWindow(
        WINDOW_UID,
        Array.from({ length: TAB_COUNT }, (_, i) =>
          makeForegroundTab(`tab-${i}` as UID),
        ),
      ),
      makeForegroundNote('note-1' as UID),
    ])
    tabs = SessionTree.windowsByUid.get(WINDOW_UID)!.children as Tab[]
    Selection.selectItem(tabs[0], SelectionType.TAB, mouse())
    Selection.selectItem(
      tabs[TAB_COUNT - 1],
      SelectionType.TAB,
      mouse({ shiftKey: true }),
    )
  })

  afterEach(() => {
    stop?.()
    stop = undefined
  })

  function countSelectionChanges(): () => number {
    let changes = 0
    stop = watch(
      () => Selection.selectedItems.value,
      () => {
        changes += 1
      },
      { deep: 1, flush: 'sync' },
    )
    return () => changes
  }

  function applyAndReconcile(
    delta: Parameters<typeof SessionTree.applyDelta>[0],
  ) {
    expect(SessionTree.applyDelta(delta)).toBe(true)
    Selection.reconcileSelection()
  }

  it('restores flags reset by updates without replacing the selection', () => {
    const changes = countSelectionChanges()

    applyAndReconcile({
      op: 'batch',
      deltas: tabs.map((tab) => ({
        op: 'tabUpdated' as const,
        tab: { ...structuredClone(toRaw(tab)), pinned: true, selected: false },
      })),
    })

    expect(tabs.every((tab) => tab.selected && tab.pinned)).toBe(true)
    expect(Selection.selectedItems.value).toHaveLength(TAB_COUNT)
    expect(changes()).toBe(0)
  })

  it('drops removed items and the anchor that pointed at one', () => {
    Selection.anchor.value = tabs[5]
    const changes = countSelectionChanges()

    applyAndReconcile({
      op: 'tabRemoved',
      windowUid: WINDOW_UID,
      tabUid: 'tab-5' as UID,
    })

    const uids = Selection.selectedItems.value.map(({ item }) => item.uid)
    expect(uids).toHaveLength(TAB_COUNT - 1)
    expect(uids).not.toContain('tab-5')
    expect(Selection.anchor.value).toBeUndefined()
    expect(changes()).toBe(1)
  })

  it('re-points entries and the anchor at items recreated under the same uid', () => {
    Selection.anchor.value = tabs[3]
    const recreated = {
      ...structuredClone(toRaw(tabs[3])),
      title: 'Recreated',
      selected: false,
    }

    applyAndReconcile({
      op: 'batch',
      deltas: [
        { op: 'tabRemoved', windowUid: WINDOW_UID, tabUid: recreated.uid },
        { op: 'tabCreated', windowUid: WINDOW_UID, tab: recreated, index: 3 },
      ],
    })

    const current = SessionTree.tabsByUid.get(recreated.uid)!
    const entry = Selection.selectedItems.value.find(
      ({ item }) => item.uid === recreated.uid,
    )!
    expect(current.selected).toBe(true)
    expect(toRaw(entry.item)).toBe(toRaw(current))
    expect((entry.item as Tab).title).toBe('Recreated')
    expect(toRaw(Selection.anchor.value)).toBe(toRaw(current))
  })

  it('leaves an empty selection untouched', () => {
    Selection.clearSelection()
    const changes = countSelectionChanges()

    applyAndReconcile({
      op: 'tabUpdated',
      tab: { ...structuredClone(toRaw(tabs[0])), title: 'Updated' },
    })

    expect(Selection.selectedItems.value).toEqual([])
    expect(tabs.some((tab) => tab.selected)).toBe(false)
    expect(changes()).toBe(0)
  })
})
