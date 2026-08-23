import { beforeEach, describe, expect, it } from 'vitest'
import { SessionTree } from '@/services/foreground-tree'
import { Selection } from '@/services/selection'
import { SelectionType } from '@/types/session-tree'
import {
  makeForegroundTab,
  makeForegroundWindow,
  resetForegroundTree,
} from '../helpers/foreground-tree-fixtures'

function mouse(overrides: Partial<MouseEvent> = {}): MouseEvent {
  return {
    ctrlKey: false,
    metaKey: false,
    shiftKey: false,
    ...overrides,
  } as MouseEvent
}

/*
 * The shift-click anchor used to be read from selectedItems[0]. Because a range
 * fill rebuilds the selection in tree order, extending upward left the clicked
 * item sitting at index 0, silently moving the anchor to it. Extending downward
 * happened to work because the anchor already sorted first.
 */
describe('shift-click selection anchor', () => {
  let tabs: ReturnType<typeof makeForegroundTab>[]

  beforeEach(() => {
    resetForegroundTree()
    Selection.selectedItems.value = []
    Selection.anchor.value = undefined

    const children = [0, 1, 2, 3, 4, 5].map((i) =>
      makeForegroundTab(`tab-${i}` as UID),
    )
    const window = makeForegroundWindow('window-1' as UID, children)
    resetForegroundTree([window])
    tabs = SessionTree.windowsByUid.get(window.uid)!.children as typeof children
  })

  const selectedUids = () =>
    Selection.selectedItems.value.map((entry) => entry.item.uid)

  it('keeps the anchor when a range is extended upward', () => {
    Selection.selectItem(tabs[3], SelectionType.TAB, mouse())
    Selection.selectItem(tabs[1], SelectionType.TAB, mouse({ shiftKey: true }))

    expect(selectedUids()).toEqual(['tab-1', 'tab-2', 'tab-3'])

    // Reverse direction: this must range from tab-3, not from tab-1.
    Selection.selectItem(tabs[5], SelectionType.TAB, mouse({ shiftKey: true }))

    expect(selectedUids()).toEqual(['tab-3', 'tab-4', 'tab-5'])
  })

  it('keeps the anchor when a range is extended downward', () => {
    Selection.selectItem(tabs[2], SelectionType.TAB, mouse())
    Selection.selectItem(tabs[4], SelectionType.TAB, mouse({ shiftKey: true }))

    expect(selectedUids()).toEqual(['tab-2', 'tab-3', 'tab-4'])

    Selection.selectItem(tabs[0], SelectionType.TAB, mouse({ shiftKey: true }))

    expect(selectedUids()).toEqual(['tab-0', 'tab-1', 'tab-2'])
  })

  it('shrinks a range from the anchor rather than from the last click', () => {
    Selection.selectItem(tabs[1], SelectionType.TAB, mouse())
    Selection.selectItem(tabs[5], SelectionType.TAB, mouse({ shiftKey: true }))
    Selection.selectItem(tabs[3], SelectionType.TAB, mouse({ shiftKey: true }))

    expect(selectedUids()).toEqual(['tab-1', 'tab-2', 'tab-3'])
  })

  it('re-anchors on a plain click', () => {
    Selection.selectItem(tabs[4], SelectionType.TAB, mouse())
    Selection.selectItem(tabs[2], SelectionType.TAB, mouse({ shiftKey: true }))
    Selection.selectItem(tabs[1], SelectionType.TAB, mouse())
    Selection.selectItem(tabs[3], SelectionType.TAB, mouse({ shiftKey: true }))

    expect(selectedUids()).toEqual(['tab-1', 'tab-2', 'tab-3'])
  })

  it('drops the anchor when the selection is cleared', () => {
    Selection.selectItem(tabs[4], SelectionType.TAB, mouse())
    Selection.clearSelection()

    expect(Selection.anchor.value).toBeUndefined()
  })
})
