import { beforeEach, describe, expect, it } from 'vitest'
import { DEFAULT_SETTINGS } from '@/defaults/settings'
import { Tree } from '@/services/background-tree'
import { collectDraggedItemsWithIncludedChildren } from '@/services/drag-and-drop-actions'
import { Settings } from '@/services/settings'
import { SelectionType, State } from '@/types/session-tree'
import {
  createNote,
  createSeparator,
  createTab,
  createWindow,
  resetTree,
} from '../../helpers/tree-fixtures'
import { installFakeBrowser } from '../../helpers/fake-browser'
import { expectTreeInvariants } from '../../helpers/tree-invariants'

describe('tree hierarchy settings', () => {
  beforeEach(() => {
    resetTree()
    Object.assign(Settings.values, structuredClone(DEFAULT_SETTINGS))
  })

  it.each([State.OPEN, State.SAVED, State.DISCARDED, State.OTHER])(
    'applies always/collapsed/never descendant inclusion to tab state %s',
    (state) => {
      const parent = createTab('tab-parent' as UID, {
        state,
        isParent: true,
      })
      const childTab = createTab('tab-child' as UID, {
        parentUid: parent.uid,
        indentLevel: 2,
      })
      const childNote = createNote('note-child' as UID, {
        parentUid: parent.uid,
        indentLevel: 2,
      })
      const childSeparator = createSeparator('separator-child' as UID, {
        parentUid: parent.uid,
        indentLevel: 2,
      })
      const window = createWindow('window-1' as UID, [
        parent,
        childTab,
        childNote,
        childSeparator,
      ])

      parent.collapsed = false
      expect(
        collectDraggedItemsWithIncludedChildren(
          [parent],
          SelectionType.TAB,
          'always',
          Tree.windowsByUid,
        ).map((item) => item.uid),
      ).toEqual([parent.uid, childTab.uid, childNote.uid, childSeparator.uid])
      expect(
        collectDraggedItemsWithIncludedChildren(
          [parent],
          SelectionType.TAB,
          'collapsed',
          Tree.windowsByUid,
        ).map((item) => item.uid),
      ).toEqual([parent.uid])

      parent.collapsed = true
      expect(
        collectDraggedItemsWithIncludedChildren(
          [parent],
          SelectionType.TAB,
          'collapsed',
          new Map([[window.uid, window]]),
        ).map((item) => item.uid),
      ).toEqual([parent.uid, childTab.uid, childNote.uid, childSeparator.uid])
      expect(
        collectDraggedItemsWithIncludedChildren(
          [parent],
          SelectionType.TAB,
          'never',
          Tree.windowsByUid,
        ).map((item) => item.uid),
      ).toEqual([parent.uid])
    },
  )

  it.each([
    { maintainHierarchy: true, expectedChildParent: 'note-parent' },
    { maintainHierarchy: false, expectedChildParent: 'note-target' },
  ])(
    'maintains explicitly selected hierarchy=$maintainHierarchy across source parents',
    async ({ maintainHierarchy, expectedChildParent }) => {
      Settings.values.tryToMaintainHierarchyOfDraggedItems = maintainHierarchy
      const parent = createNote('note-parent' as UID, { isParent: true })
      const child = createNote('note-child' as UID, {
        parentUid: parent.uid,
        indentLevel: 2,
      })
      const otherParent = createNote('note-other-parent' as UID, {
        isParent: true,
      })
      const otherChild = createSeparator('separator-other-child' as UID, {
        parentUid: otherParent.uid,
        indentLevel: 2,
      })
      const target = createNote('note-target' as UID)
      const window = createWindow('window-1' as UID, [
        parent,
        child,
        otherParent,
        otherChild,
        target,
      ])

      await Tree.moveTreeItems(
        [parent.uid, child.uid, otherChild.uid],
        window.children.length,
        target.uid,
        window.uid,
        false,
        false,
      )

      expect(child.parentUid).toBe(expectedChildParent)
      expect(parent.parentUid).toBe(target.uid)
      expect(otherChild.parentUid).toBe(target.uid)
      expectTreeInvariants()
    },
  )

  it.each([
    { maintainCollapsed: true, expectedCollapsed: true },
    { maintainCollapsed: false, expectedCollapsed: false },
  ])(
    'maintains collapsed state=$maintainCollapsed for a browser-backed subtree move',
    async ({ maintainCollapsed, expectedCollapsed }) => {
      Settings.values.tryToMaintainCollapsedStateOfDraggedItems =
        maintainCollapsed
      const fakeBrowser = installFakeBrowser()
      const parent = createTab('tab-parent' as UID, {
        id: 10,
        state: State.OPEN,
        collapsed: true,
        isParent: true,
      })
      const child = createTab('tab-child' as UID, {
        id: 11,
        state: State.OPEN,
        parentUid: parent.uid,
        indentLevel: 2,
      })
      createWindow('window-source' as UID, [parent, child], {
        id: 100,
        state: State.OPEN,
      })
      const targetWindow = createWindow('window-target' as UID, [], {
        id: 200,
        state: State.OPEN,
      })
      fakeBrowser.tabs.move
        .mockResolvedValueOnce({ id: parent.id } as browser.tabs.Tab)
        .mockResolvedValueOnce({ id: child.id } as browser.tabs.Tab)

      await Tree.moveTreeItems(
        [parent.uid],
        0,
        undefined,
        targetWindow.uid,
        false,
        true,
      )

      expect(Boolean(Tree.tabsByUid.get(parent.uid)?.collapsed)).toBe(
        expectedCollapsed,
      )
      expect(Tree.tabsByUid.get(child.uid)?.parentUid).toBe(parent.uid)
      expectTreeInvariants()
    },
  )
})
