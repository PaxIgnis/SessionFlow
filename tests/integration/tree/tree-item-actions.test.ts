import { beforeEach, describe, expect, it } from 'vitest'
import { DEFAULT_SETTINGS } from '@/defaults/settings'
import { Tree } from '@/services/background-tree'
import { Settings } from '@/services/settings'
import { State, Tab, TreeItemType, Window } from '@/types/session-tree'
import {
  createNote,
  createSeparator,
  createTab,
  createWindow,
  resetTree,
} from '../../helpers/tree-fixtures'
import { installFakeBrowser } from '../../helpers/fake-browser'
import { expectTreeInvariants } from '../../helpers/tree-invariants'

describe('generic tree item structural actions', () => {
  beforeEach(() => {
    installFakeBrowser()
    resetTree()
    Object.assign(Settings.values, structuredClone(DEFAULT_SETTINGS))
  })

  it('duplicates a note with mixed descendants as the next sibling subtree', () => {
    const note = createNote('note-parent' as UID, { isParent: true })
    const child = createNote('note-child' as UID, {
      parentUid: note.uid,
      indentLevel: 2,
    })
    const separator = createSeparator('separator-child' as UID, {
      parentUid: note.uid,
      indentLevel: 2,
    })
    const tail = createTab('tab-tail' as UID)
    const window = createWindow('window-1' as UID, [
      note,
      child,
      separator,
      tail,
    ])

    Tree.duplicateTreeItems([note.uid])

    expect(window.children).toHaveLength(7)
    expect(window.children[0]).toBe(note)
    expect(window.children[1]).toBe(child)
    expect(window.children[2]).toBe(separator)
    const duplicate = window.children[3]
    const duplicateChild = window.children[4]
    const duplicateSeparator = window.children[5]
    expect(window.children[6]).toBe(tail)

    expect(duplicate.type).toBe(TreeItemType.NOTE)
    expect(duplicate.uid).not.toBe(note.uid)
    expect(duplicate.parentUid).toBeUndefined()
    expect(duplicate.indentLevel).toBe(1)
    expect(duplicateChild.type).toBe(TreeItemType.NOTE)
    expect(duplicateChild.parentUid).toBe(duplicate.uid)
    expect(duplicateChild.indentLevel).toBe(2)
    expect(duplicateSeparator.type).toBe(TreeItemType.SEPARATOR)
    expect(duplicateSeparator.parentUid).toBe(duplicate.uid)
    expect(duplicateSeparator.indentLevel).toBe(2)
    expectTreeInvariants()
  })

  it('duplicates a window with saved cloned browser ids and child parent remapping', () => {
    const note = createNote('note-parent' as UID, { isParent: true })
    const tab = createTab('tab-child' as UID, {
      parentUid: note.uid,
      indentLevel: 2,
      state: State.OPEN,
      id: 123,
    })
    const window = createWindow('window-1' as UID, [note, tab], {
      state: State.OPEN,
      id: 42,
    })

    Tree.duplicateTreeItems([window.uid])

    expect(Tree.Items).toHaveLength(2)
    const duplicate = Tree.Items[1] as Window
    expect(duplicate.type).toBe(TreeItemType.WINDOW)
    expect(duplicate.uid).not.toBe(window.uid)
    expect(duplicate.state).toBe(State.SAVED)
    expect(duplicate.id).toBe(-1)
    expect(duplicate.children).toHaveLength(2)
    const duplicateNote = duplicate.children[0]
    const duplicateTab = duplicate.children[1] as Tab
    expect(duplicateNote.uid).not.toBe(note.uid)
    expect(duplicateTab.uid).not.toBe(tab.uid)
    expect(duplicateTab.parentUid).toBe(duplicateNote.uid)
    expect(duplicateTab.windowUid).toBe(duplicate.uid)
    expect(duplicateTab.state).toBe(State.SAVED)
    expect(duplicateTab.id).toBe(-1)
    expectTreeInvariants()
  })

  it('duplicates a saved tab with mixed descendants as a saved sibling subtree', () => {
    const tab = createTab('tab-parent' as UID, {
      isParent: true,
      state: State.SAVED,
      id: -1,
    })
    const childNote = createNote('note-child' as UID, {
      parentUid: tab.uid,
      indentLevel: 2,
    })
    const childSeparator = createSeparator('separator-child' as UID, {
      parentUid: tab.uid,
      indentLevel: 2,
    })
    const tail = createTab('tab-tail' as UID)
    const window = createWindow('window-1' as UID, [
      tab,
      childNote,
      childSeparator,
      tail,
    ])

    Tree.duplicateTreeItems([tab.uid])

    expect(window.children).toHaveLength(7)
    expect(window.children[0]).toBe(tab)
    expect(window.children[1]).toBe(childNote)
    expect(window.children[2]).toBe(childSeparator)
    const duplicate = window.children[3] as Tab
    const duplicateNote = window.children[4]
    const duplicateSeparator = window.children[5]
    expect(window.children[6]).toBe(tail)

    expect(duplicate.type).toBe(TreeItemType.TAB)
    expect(duplicate.uid).not.toBe(tab.uid)
    expect(duplicate.parentUid).toBeUndefined()
    expect(duplicate.indentLevel).toBe(1)
    expect(duplicate.state).toBe(State.SAVED)
    expect(duplicate.id).toBe(-1)
    expect(duplicateNote.parentUid).toBe(duplicate.uid)
    expect(duplicateNote.indentLevel).toBe(2)
    expect(duplicateSeparator.parentUid).toBe(duplicate.uid)
    expect(duplicateSeparator.indentLevel).toBe(2)
    expectTreeInvariants()
  })

  it('duplicates an open tab through the browser without adding a saved tree clone', () => {
    const tab = createTab('tab-open' as UID, {
      state: State.OPEN,
      id: 123,
    })
    const window = createWindow('window-1' as UID, [tab])

    Tree.duplicateTreeItems([tab.uid])

    expect(browser.tabs.duplicate).toHaveBeenCalledWith(123)
    expect(window.children).toEqual([tab])
    expectTreeInvariants()
  })

  it('increases and decreases a note indent using adjacent structural siblings', () => {
    const parent = createTab('tab-parent' as UID)
    const note = createNote('note-child' as UID)
    const window = createWindow('window-1' as UID, [parent, note])

    Tree.treeItemIndentIncrease([note.uid])

    expect(window.children.map((item) => item.uid)).toEqual([
      parent.uid,
      note.uid,
    ])
    expect(note.parentUid).toBe(parent.uid)
    expect(note.indentLevel).toBe(2)
    expect(parent.isParent).toBe(true)

    Tree.treeItemIndentDecrease([note.uid])

    expect(note.parentUid).toBeUndefined()
    expect(note.indentLevel).toBe(1)
    expect(parent.isParent).toBe(false)
    expectTreeInvariants()
  })

  it('increases and decreases a top-level window indent under a note', () => {
    const parent = createNote('note-parent' as UID, {
      indentLevel: 0,
      windowUid: undefined,
    })
    const tab = createTab('tab-child' as UID)
    const window = createWindow('window-1' as UID, [tab])
    Tree.Items.splice(0, 0, parent)
    Tree.notesByUid.set(parent.uid, parent)
    Tree.existingUidsSet.add(parent.uid)

    Tree.treeItemIndentIncrease([window.uid])

    expect(Tree.Items.map((item) => item.uid)).toEqual([
      parent.uid,
      window.uid,
    ])
    expect(window.parentUid).toBe(parent.uid)
    expect(window.indentLevel).toBe(1)
    expect(tab.windowUid).toBe(window.uid)
    expect(parent.isParent).toBe(true)

    Tree.treeItemIndentDecrease([window.uid])

    expect(window.parentUid).toBeUndefined()
    expect(window.indentLevel).toBe(0)
    expect(parent.isParent).toBe(false)
    expectTreeInvariants()
  })

  it('decreases a tab indent by moving its full subtree after the old parent subtree', () => {
    const parentTab = createTab('tab-parent' as UID, { isParent: true })
    const movedTab = createTab('tab-moved' as UID, {
      parentUid: parentTab.uid,
      indentLevel: 2,
      isParent: true,
    })
    const movedChild = createTab('tab-moved-child' as UID, {
      parentUid: movedTab.uid,
      indentLevel: 3,
    })
    const remainingTab = createTab('tab-remaining' as UID, {
      parentUid: parentTab.uid,
      indentLevel: 2,
    })
    const remainingNote = createNote('note-remaining' as UID, {
      parentUid: parentTab.uid,
      indentLevel: 2,
    })
    const remainingSeparator = createSeparator('separator-remaining' as UID, {
      parentUid: parentTab.uid,
      indentLevel: 2,
    })
    const window = createWindow('window-1' as UID, [
      parentTab,
      movedTab,
      movedChild,
      remainingTab,
      remainingNote,
      remainingSeparator,
    ])

    Tree.treeItemIndentDecrease([movedTab.uid])

    expect(window.children.map((item) => item.uid)).toEqual([
      parentTab.uid,
      remainingTab.uid,
      remainingNote.uid,
      remainingSeparator.uid,
      movedTab.uid,
      movedChild.uid,
    ])
    expect(parentTab.isParent).toBe(true)
    expect(remainingTab.parentUid).toBe(parentTab.uid)
    expect(remainingNote.parentUid).toBe(parentTab.uid)
    expect(remainingSeparator.parentUid).toBe(parentTab.uid)
    expect(movedTab.parentUid).toBeUndefined()
    expect(movedTab.indentLevel).toBe(1)
    expect(movedTab.isParent).toBe(true)
    expect(movedChild.parentUid).toBe(movedTab.uid)
    expect(movedChild.indentLevel).toBe(2)
    expectTreeInvariants()
  })

  it('decreases a nested tab indent to become a sibling of its parent under a note', () => {
    const noteParent = createNote('note-parent' as UID, { isParent: true })
    const parentTab = createTab('tab-parent' as UID, {
      parentUid: noteParent.uid,
      indentLevel: 2,
      isParent: true,
    })
    const movedTab = createTab('tab-moved' as UID, {
      parentUid: parentTab.uid,
      indentLevel: 3,
      isParent: true,
    })
    const movedChild = createSeparator('separator-moved-child' as UID, {
      parentUid: movedTab.uid,
      indentLevel: 4,
    })
    const remainingTab = createTab('tab-remaining' as UID, {
      parentUid: parentTab.uid,
      indentLevel: 3,
    })
    const window = createWindow('window-1' as UID, [
      noteParent,
      parentTab,
      movedTab,
      movedChild,
      remainingTab,
    ])

    Tree.treeItemIndentDecrease([movedTab.uid])

    expect(window.children.map((item) => item.uid)).toEqual([
      noteParent.uid,
      parentTab.uid,
      remainingTab.uid,
      movedTab.uid,
      movedChild.uid,
    ])
    expect(noteParent.isParent).toBe(true)
    expect(parentTab.isParent).toBe(true)
    expect(remainingTab.parentUid).toBe(parentTab.uid)
    expect(remainingTab.indentLevel).toBe(3)
    expect(movedTab.parentUid).toBe(noteParent.uid)
    expect(movedTab.indentLevel).toBe(2)
    expect(movedChild.parentUid).toBe(movedTab.uid)
    expect(movedChild.indentLevel).toBe(3)
    expectTreeInvariants()
  })

  it.each([
    {
      setting: 'always',
      collapsed: false,
      expectedChildParent: 'selected',
    },
    {
      setting: 'collapsed',
      collapsed: true,
      expectedChildParent: 'selected',
    },
    {
      setting: 'collapsed',
      collapsed: false,
      expectedChildParent: 'old-parent',
    },
    {
      setting: 'never',
      collapsed: true,
      expectedChildParent: 'old-parent',
    },
  ] as const)(
    'uses $setting setting with collapsed=$collapsed when increasing indent',
    ({ setting, collapsed, expectedChildParent }) => {
      Settings.values.includeChildrenOfSelectedItemsWhenIndenting = setting
      const oldParent = createTab('tab-old-parent' as UID, { isParent: true })
      const newParent = createTab('tab-new-parent' as UID, {
        parentUid: oldParent.uid,
        indentLevel: 2,
      })
      const movedTab = createTab('tab-moved' as UID, {
        parentUid: oldParent.uid,
        indentLevel: 2,
        isParent: true,
        collapsed,
      })
      const childNote = createNote('note-child' as UID, {
        parentUid: movedTab.uid,
        indentLevel: 3,
      })
      const window = createWindow('window-1' as UID, [
        oldParent,
        newParent,
        movedTab,
        childNote,
      ])

      Tree.treeItemIndentIncrease([movedTab.uid])

      expect(window.children.map((item) => item.uid)).toEqual([
        oldParent.uid,
        newParent.uid,
        movedTab.uid,
        childNote.uid,
      ])
      expect(movedTab.parentUid).toBe(newParent.uid)
      expect(movedTab.indentLevel).toBe(3)
      if (expectedChildParent === 'selected') {
        expect(movedTab.isParent).toBe(true)
        expect(childNote.parentUid).toBe(movedTab.uid)
        expect(childNote.indentLevel).toBe(4)
        expect(oldParent.isParent).toBe(true)
      } else {
        expect(movedTab.isParent).toBe(false)
        expect(childNote.parentUid).toBe(oldParent.uid)
        expect(childNote.indentLevel).toBe(2)
        expect(oldParent.isParent).toBe(true)
      }
      expectTreeInvariants()
    },
  )

  it.each([
    {
      setting: 'always',
      collapsed: false,
      expectedChildParent: 'selected',
    },
    {
      setting: 'collapsed',
      collapsed: true,
      expectedChildParent: 'selected',
    },
    {
      setting: 'collapsed',
      collapsed: false,
      expectedChildParent: 'old-parent',
    },
    {
      setting: 'never',
      collapsed: true,
      expectedChildParent: 'old-parent',
    },
  ] as const)(
    'uses $setting setting with collapsed=$collapsed when decreasing indent',
    ({ setting, collapsed, expectedChildParent }) => {
      Settings.values.includeChildrenOfSelectedItemsWhenIndenting = setting
      const oldParent = createTab('tab-old-parent' as UID, { isParent: true })
      const movedTab = createTab('tab-moved' as UID, {
        parentUid: oldParent.uid,
        indentLevel: 2,
        isParent: true,
        collapsed,
      })
      const childNote = createNote('note-child' as UID, {
        parentUid: movedTab.uid,
        indentLevel: 3,
      })
      const remainingTab = createTab('tab-remaining' as UID, {
        parentUid: oldParent.uid,
        indentLevel: 2,
      })
      const window = createWindow('window-1' as UID, [
        oldParent,
        movedTab,
        childNote,
        remainingTab,
      ])

      Tree.treeItemIndentDecrease([movedTab.uid])

      if (expectedChildParent === 'selected') {
        expect(window.children.map((item) => item.uid)).toEqual([
          oldParent.uid,
          remainingTab.uid,
          movedTab.uid,
          childNote.uid,
        ])
        expect(movedTab.isParent).toBe(true)
        expect(childNote.parentUid).toBe(movedTab.uid)
        expect(childNote.indentLevel).toBe(2)
      } else {
        expect(window.children.map((item) => item.uid)).toEqual([
          oldParent.uid,
          childNote.uid,
          remainingTab.uid,
          movedTab.uid,
        ])
        expect(movedTab.isParent).toBe(false)
        expect(childNote.parentUid).toBe(oldParent.uid)
        expect(childNote.indentLevel).toBe(2)
      }
      expect(movedTab.parentUid).toBeUndefined()
      expect(movedTab.indentLevel).toBe(1)
      expect(oldParent.isParent).toBe(true)
      expectTreeInvariants()
    },
  )

  it.each([
    {
      setting: 'collapsed',
      collapsed: true,
      expectedChildParent: 'selected',
    },
    {
      setting: 'collapsed',
      collapsed: false,
      expectedChildParent: 'old-parent',
    },
    {
      setting: 'never',
      collapsed: true,
      expectedChildParent: 'old-parent',
    },
  ] as const)(
    'uses $setting setting with collapsed=$collapsed when decreasing note indent',
    ({ setting, collapsed, expectedChildParent }) => {
      Settings.values.includeChildrenOfSelectedItemsWhenIndenting = setting
      const oldParent = createNote('note-old-parent' as UID, { isParent: true })
      const movedNote = createNote('note-moved' as UID, {
        parentUid: oldParent.uid,
        indentLevel: 2,
        isParent: true,
        collapsed,
      })
      const childSeparator = createSeparator('separator-child' as UID, {
        parentUid: movedNote.uid,
        indentLevel: 3,
      })
      const remainingTab = createTab('tab-remaining' as UID, {
        parentUid: oldParent.uid,
        indentLevel: 2,
      })
      const window = createWindow('window-1' as UID, [
        oldParent,
        movedNote,
        childSeparator,
        remainingTab,
      ])

      Tree.treeItemIndentDecrease([movedNote.uid])

      if (expectedChildParent === 'selected') {
        expect(window.children.map((item) => item.uid)).toEqual([
          oldParent.uid,
          remainingTab.uid,
          movedNote.uid,
          childSeparator.uid,
        ])
        expect(movedNote.isParent).toBe(true)
        expect(childSeparator.parentUid).toBe(movedNote.uid)
        expect(childSeparator.indentLevel).toBe(2)
      } else {
        expect(window.children.map((item) => item.uid)).toEqual([
          oldParent.uid,
          childSeparator.uid,
          remainingTab.uid,
          movedNote.uid,
        ])
        expect(movedNote.isParent).toBe(false)
        expect(childSeparator.parentUid).toBe(oldParent.uid)
        expect(childSeparator.indentLevel).toBe(2)
      }
      expect(movedNote.parentUid).toBeUndefined()
      expect(movedNote.indentLevel).toBe(1)
      expect(oldParent.isParent).toBe(true)
      expectTreeInvariants()
    },
  )
})
