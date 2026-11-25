import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { watch, type WatchStopHandle } from 'vue'
import { SessionTree } from '@/services/foreground-tree'
import { Selection } from '@/services/selection'
import { SelectionType, type Tab } from '@/types/session-tree'
import {
  makeForegroundTab,
  makeForegroundWindow,
  resetForegroundTree,
} from '../helpers/foreground-tree-fixtures'

const TAB_COUNT = 500

function mouse(overrides: Partial<MouseEvent> = {}): MouseEvent {
  return {
    ctrlKey: false,
    metaKey: false,
    shiftKey: false,
    ...overrides,
  } as MouseEvent
}

/*
 * A shift-click range fill used to add items one at a time, checking each
 * against the whole selection through the reactive proxy and pushing it
 * separately. Selecting a few thousand rows took several seconds. The fill now
 * dedupes against a set and appends in one push, so the selection changes once.
 */
describe('shift-click range selection', () => {
  let tabs: Tab[]
  let stop: WatchStopHandle | undefined

  beforeEach(() => {
    Selection.clearSelection()
    const window = makeForegroundWindow(
      'window-1' as UID,
      Array.from({ length: TAB_COUNT }, (_, i) =>
        makeForegroundTab(`tab-${i}` as UID),
      ),
    )
    resetForegroundTree([window])
    tabs = SessionTree.windowsByUid.get(window.uid)!.children as Tab[]
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
      // Depth 1: the list's entries, not each item's own selected flag.
      { deep: 1, flush: 'sync' },
    )
    return () => changes
  }

  it('updates the selection once for a whole range', () => {
    Selection.selectItem(tabs[0], SelectionType.TAB, mouse())
    const changes = countSelectionChanges()

    Selection.selectItem(
      tabs[TAB_COUNT - 1],
      SelectionType.TAB,
      mouse({ shiftKey: true }),
    )

    expect(Selection.selectedItems.value).toHaveLength(TAB_COUNT)
    expect(tabs.every((tab) => tab.selected)).toBe(true)
    // One clear of the previous selection, one append of the range.
    expect(changes()).toBe(2)
  })

  it('updates the selection once when ctrl-shift extends an existing one', () => {
    Selection.selectItem(tabs[0], SelectionType.TAB, mouse())
    Selection.selectItem(tabs[10], SelectionType.TAB, mouse({ ctrlKey: true }))
    const changes = countSelectionChanges()

    Selection.selectItem(
      tabs[TAB_COUNT - 1],
      SelectionType.TAB,
      mouse({ shiftKey: true, ctrlKey: true }),
    )

    const uids = Selection.selectedItems.value.map(({ item }) => item.uid)
    expect(new Set(uids).size).toBe(uids.length)
    // tab-0 stays selected; the range runs from the ctrl-clicked anchor tab-10.
    expect(uids).toHaveLength(1 + TAB_COUNT - 10)
    expect(changes()).toBe(1)
  })
})
