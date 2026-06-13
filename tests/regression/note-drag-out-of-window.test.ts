import { beforeEach, describe, expect, it } from 'vitest'
import { Tree } from '@/services/background-tree'
import {
  createNote,
  createTab,
  createWindow,
  resetTree,
} from '../helpers/tree-fixtures'
import { expectTreeInvariants } from '../helpers/tree-invariants'

describe('note dragged out of a window', () => {
  beforeEach(() => {
    resetTree()
  })

  it('clears isParent when its tab child stays inside the window', () => {
    const note = createNote('note-parent' as UID, {
      collapsed: true,
      isParent: true,
    })
    const childTab = createTab('tab-child' as UID, {
      parentUid: note.uid,
      indentLevel: 2,
    })
    const window = createWindow('window-1' as UID, [note, childTab])

    Tree.moveTreeItems([note.uid], 0, undefined, undefined, false, false)

    expect(Tree.Items.map((item) => item.uid)).toEqual([note.uid, window.uid])
    expect(window.children.map((item) => item.uid)).toEqual([childTab.uid])
    expect(note.windowUid).toBeUndefined()
    expect(note.parentUid).toBeUndefined()
    expect(note.indentLevel).toBe(0)
    expect(note.collapsed).toBe(false)
    expect(note.isParent).toBe(false)
    expect(childTab.windowUid).toBe(window.uid)
    expect(childTab.parentUid).toBeUndefined()
    expect(childTab.indentLevel).toBe(1)
    expectTreeInvariants()
  })
})
