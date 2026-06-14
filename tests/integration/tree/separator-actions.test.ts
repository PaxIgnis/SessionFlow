import { beforeEach, describe, expect, it } from 'vitest'
import { Tree } from '@/services/background-tree'
import { TreeItemType } from '@/types/session-tree'
import {
  createNote,
  createSeparator,
  createTab,
  createWindow,
  resetTree,
} from '../../helpers/tree-fixtures'
import { expectTreeInvariants } from '../../helpers/tree-invariants'

describe('separator mutations', () => {
  beforeEach(() => {
    resetTree()
  })

  it('creates top-level separators', () => {
    const separatorUid = Tree.createSeparator()
    const separator = Tree.separatorsByUid.get(separatorUid)

    expect(Tree.Items.map((item) => item.uid)).toEqual([separatorUid])
    expect(separator?.type).toBe(TreeItemType.SEPARATOR)
    expect(separator?.parentUid).toBeUndefined()
    expect(separator?.windowUid).toBeUndefined()
    expect(separator?.indentLevel).toBe(0)
    expect(separator?.isVisible).toBe(true)
    expectTreeInvariants()
  })

  it('creates separators inside windows under tab and note parents', () => {
    const tab = createTab('tab-parent' as UID)
    const note = createNote('note-parent' as UID)
    const window = createWindow('window-1' as UID, [tab, note])

    const tabChildUid = Tree.createSeparator(tab.uid)
    const noteChildUid = Tree.createSeparator(note.uid)
    const tabChild = Tree.separatorsByUid.get(tabChildUid)
    const noteChild = Tree.separatorsByUid.get(noteChildUid)

    expect(window.children.map((item) => item.uid)).toEqual([
      tab.uid,
      tabChildUid,
      note.uid,
      noteChildUid,
    ])
    expect(tabChild?.parentUid).toBe(tab.uid)
    expect(tabChild?.windowUid).toBe(window.uid)
    expect(tabChild?.indentLevel).toBe(2)
    expect(noteChild?.parentUid).toBe(note.uid)
    expect(noteChild?.windowUid).toBe(window.uid)
    expect(noteChild?.indentLevel).toBe(2)
    expect(tab.isParent).toBe(true)
    expect(note.isParent).toBe(true)
    expectTreeInvariants()
  })

  it('removes separators and cleans the separator index', () => {
    const separator = createSeparator('separator-1' as UID)
    const tab = createTab('tab-1' as UID)
    const window = createWindow('window-1' as UID, [separator, tab])

    Tree.removeSeparator(separator.uid)

    expect(window.children.map((item) => item.uid)).toEqual([tab.uid])
    expect(Tree.separatorsByUid.has(separator.uid)).toBe(false)
    expect(Tree.existingUidsSet.has(separator.uid)).toBe(false)
    expectTreeInvariants()
  })

  it('removes the window when removing its only separator child', () => {
    const separator = createSeparator('separator-only' as UID)
    const window = createWindow('window-1' as UID, [separator])

    Tree.removeSeparator(separator.uid)

    expect(Tree.windowsByUid.has(window.uid)).toBe(false)
    expect(Tree.Items.map((item) => item.uid)).not.toContain(window.uid)
    expect(Tree.separatorsByUid.has(separator.uid)).toBe(false)
    expect(Tree.existingUidsSet.has(separator.uid)).toBe(false)
    expectTreeInvariants()
  })

  it('moves top-level separators into a window root', () => {
    const separator = createSeparator('separator-1' as UID, { indentLevel: 0 })
    Tree.Items.push(separator)
    Tree.separatorsByUid.set(separator.uid, separator)
    Tree.existingUidsSet.add(separator.uid)
    const tab = createTab('tab-target' as UID)
    const window = createWindow('window-1' as UID, [tab])

    Tree.moveTreeItems([separator.uid], 1, undefined, window.uid, false)

    expect(Tree.Items.map((item) => item.uid)).toEqual([window.uid])
    expect(window.children.map((item) => item.uid)).toEqual([
      tab.uid,
      separator.uid,
    ])
    expect(separator.windowUid).toBe(window.uid)
    expect(separator.parentUid).toBeUndefined()
    expect(separator.indentLevel).toBe(1)
    expectTreeInvariants()
  })

  it('promotes separator children when removing a parent tab', () => {
    const parent = createTab('tab-parent' as UID, { isParent: true })
    const separator = createSeparator('separator-child' as UID, {
      parentUid: parent.uid,
      indentLevel: 2,
    })
    const window = createWindow('window-1' as UID, [parent, separator])

    Tree.removeTab(parent.uid)

    expect(window.children.map((item) => item.uid)).toEqual([separator.uid])
    expect(Tree.separatorsByUid.get(separator.uid)).toBe(separator)
    expect(separator.parentUid).toBeUndefined()
    expect(separator.indentLevel).toBe(1)
    expectTreeInvariants()
  })

  it('creates a separator below an existing separator', () => {
    const first = createSeparator('separator-1' as UID, { indentLevel: 0 })
    Tree.Items.push(first)
    Tree.separatorsByUid.set(first.uid, first)
    Tree.existingUidsSet.add(first.uid)

    const secondUid = Tree.createSeparatorBelow(first.uid)

    expect(secondUid).toBeDefined()
    expect(Tree.Items.map((item) => item.uid)).toEqual([first.uid, secondUid])
    expect(Tree.separatorsByUid.get(secondUid as UID)?.parentUid).toBeUndefined()
    expect(Tree.separatorsByUid.get(secondUid as UID)?.indentLevel).toBe(0)
    expectTreeInvariants()
  })

  it('increases a separator indent under the previous eligible sibling', () => {
    const parent = createTab('tab-parent' as UID)
    const separator = createSeparator('separator-1' as UID)
    const window = createWindow('window-1' as UID, [parent, separator])

    Tree.separatorIndentIncrease([separator.uid])

    expect(window.children.map((item) => item.uid)).toEqual([
      parent.uid,
      separator.uid,
    ])
    expect(separator.parentUid).toBe(parent.uid)
    expect(separator.windowUid).toBe(window.uid)
    expect(separator.indentLevel).toBe(2)
    expect(parent.isParent).toBe(true)
    expectTreeInvariants()
  })

  it.each([
    ['collapsed', true],
    ['expanded', false],
  ] as const)(
    'increases a top-level separator under the previous %s note sibling instead of that note subtree tail',
    (_state, collapsed) => {
      const rootNote = createNote('note-root' as UID, {
        indentLevel: 0,
        collapsed,
        isParent: true,
        windowUid: undefined,
      })
      const childNote = createNote('note-child' as UID, {
        parentUid: rootNote.uid,
        indentLevel: 1,
        isParent: true,
        windowUid: undefined,
        isVisible: !collapsed,
      })
      const grandchildNote = createNote('note-grandchild' as UID, {
        parentUid: childNote.uid,
        indentLevel: 2,
        isParent: true,
        windowUid: undefined,
        isVisible: !collapsed,
      })
      const windowTab = createTab('tab-window-child' as UID, {
        indentLevel: 4,
        isVisible: !collapsed,
      })
      const nestedWindow = createWindow('window-nested' as UID, [windowTab], {
        parentUid: grandchildNote.uid,
        indentLevel: 3,
        isVisible: !collapsed,
      })
      const separator = createSeparator('separator-1' as UID, {
        indentLevel: 0,
        windowUid: undefined,
      })
      Tree.Items.splice(
        0,
        Tree.Items.length,
        rootNote,
        childNote,
        grandchildNote,
        nestedWindow,
        separator,
      )
      Tree.notesByUid.set(rootNote.uid, rootNote)
      Tree.notesByUid.set(childNote.uid, childNote)
      Tree.notesByUid.set(grandchildNote.uid, grandchildNote)
      Tree.separatorsByUid.set(separator.uid, separator)
      Tree.existingUidsSet.add(rootNote.uid)
      Tree.existingUidsSet.add(childNote.uid)
      Tree.existingUidsSet.add(grandchildNote.uid)
      Tree.existingUidsSet.add(separator.uid)

      Tree.separatorIndentIncrease([separator.uid])

      expect(Tree.Items.map((item) => item.uid)).toEqual([
        rootNote.uid,
        childNote.uid,
        grandchildNote.uid,
        nestedWindow.uid,
        separator.uid,
      ])
      expect(separator.parentUid).toBe(rootNote.uid)
      expect(separator.windowUid).toBeUndefined()
      expect(separator.indentLevel).toBe(1)
      expect(separator.isVisible).toBe(!collapsed)
      expect(rootNote.isParent).toBe(true)
      expect(nestedWindow.children.map((item) => item.uid)).toEqual([
        windowTab.uid,
      ])
      expectTreeInvariants()
    },
  )

  it('increases a window-root separator under the previous root tab sibling instead of that tab subtree tail', () => {
    const parent = createTab('tab-parent' as UID, { isParent: true })
    const childNote = createNote('note-child' as UID, {
      parentUid: parent.uid,
      indentLevel: 2,
      isParent: true,
    })
    const grandchildTab = createTab('tab-grandchild' as UID, {
      parentUid: childNote.uid,
      indentLevel: 3,
    })
    const separator = createSeparator('separator-1' as UID)
    const window = createWindow('window-1' as UID, [
      parent,
      childNote,
      grandchildTab,
      separator,
    ])

    Tree.separatorIndentIncrease([separator.uid])

    expect(window.children.map((item) => item.uid)).toEqual([
      parent.uid,
      childNote.uid,
      grandchildTab.uid,
      separator.uid,
    ])
    expect(separator.parentUid).toBe(parent.uid)
    expect(separator.windowUid).toBe(window.uid)
    expect(separator.indentLevel).toBe(2)
    expect(parent.isParent).toBe(true)
    expectTreeInvariants()
  })

  it('decreases a separator indent to immediately follow its parent subtree', () => {
    const parent = createTab('tab-parent' as UID, { isParent: true })
    const separator = createSeparator('separator-1' as UID, {
      parentUid: parent.uid,
      indentLevel: 2,
    })
    const sibling = createTab('tab-sibling' as UID, {
      parentUid: parent.uid,
      indentLevel: 2,
    })
    const tail = createTab('tab-tail' as UID)
    const window = createWindow('window-1' as UID, [
      parent,
      separator,
      sibling,
      tail,
    ])

    Tree.separatorIndentDecrease([separator.uid])

    expect(window.children.map((item) => item.uid)).toEqual([
      parent.uid,
      sibling.uid,
      separator.uid,
      tail.uid,
    ])
    expect(separator.parentUid).toBeUndefined()
    expect(separator.windowUid).toBe(window.uid)
    expect(separator.indentLevel).toBe(1)
    expect(parent.isParent).toBe(true)
    expectTreeInvariants()
  })

  it('decreases a window-root separator out of its window and removes the empty window', () => {
    const separator = createSeparator('separator-1' as UID)
    const window = createWindow('window-1' as UID, [separator])
    const tailWindow = createWindow('window-tail' as UID)

    Tree.separatorIndentDecrease([separator.uid])

    expect(Tree.Items.map((item) => item.uid)).toEqual([
      separator.uid,
      tailWindow.uid,
    ])
    expect(Tree.windowsByUid.has(window.uid)).toBe(false)
    expect(Tree.existingUidsSet.has(window.uid)).toBe(false)
    expect(separator.parentUid).toBeUndefined()
    expect(separator.windowUid).toBeUndefined()
    expect(separator.indentLevel).toBe(0)
    expectTreeInvariants()
  })
})
