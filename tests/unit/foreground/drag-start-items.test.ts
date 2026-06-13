import { describe, expect, it } from 'vitest'
import { collectDraggedItemsWithIncludedChildren } from '@/services/drag-and-drop-actions'
import { SelectionType } from '@/types/session-tree'
import {
  makeForegroundNote,
  makeForegroundTab,
  makeForegroundWindow,
} from '../../helpers/foreground-tree-fixtures'

describe('drag start item collection', () => {
  it.each([
    {
      setting: 'always' as const,
      collapsed: false,
      expected: ['tab-parent', 'note-child', 'tab-grandchild'],
    },
    {
      setting: 'always' as const,
      collapsed: true,
      expected: ['tab-parent', 'note-child', 'tab-grandchild'],
    },
    {
      setting: 'collapsed' as const,
      collapsed: true,
      expected: ['tab-parent', 'note-child', 'tab-grandchild'],
    },
    {
      setting: 'collapsed' as const,
      collapsed: false,
      expected: ['tab-parent'],
    },
    {
      setting: 'never' as const,
      collapsed: true,
      expected: ['tab-parent'],
    },
  ])(
    'uses $setting to decide whether tab descendants join the drag payload',
    ({ setting, collapsed, expected }) => {
      const parent = makeForegroundTab('tab-parent' as UID, {
        collapsed,
        isParent: true,
      })
      const childNote = makeForegroundNote('note-child' as UID, {
        parentUid: parent.uid,
        indentLevel: 2,
      })
      const grandchildTab = makeForegroundTab('tab-grandchild' as UID, {
        parentUid: childNote.uid,
        indentLevel: 3,
      })
      const sibling = makeForegroundTab('tab-sibling' as UID)
      const window = makeForegroundWindow('window-1' as UID, [
        parent,
        childNote,
        grandchildTab,
        sibling,
      ])
      const windowsByUid = new Map([[window.uid, window]])

      const items = collectDraggedItemsWithIncludedChildren(
        [parent],
        SelectionType.TAB,
        setting,
        windowsByUid,
      )

      expect(items.map((item) => item.uid)).toEqual(expected)
    },
  )

  it.each(['always', 'collapsed', 'never'] as const)(
    'does not expand note descendants into drag payload when setting is %s',
    (setting) => {
      const note = makeForegroundNote('note-root' as UID, {
        collapsed: true,
        isParent: true,
      })
      const childWindow = makeForegroundWindow('window-child' as UID, [], {
        parentUid: note.uid,
        indentLevel: 1,
      })

      const items = collectDraggedItemsWithIncludedChildren(
        [note],
        SelectionType.NOTE,
        setting,
        new Map([[childWindow.uid, childWindow]]),
      )

      expect(items).toEqual([note])
    },
  )
})
