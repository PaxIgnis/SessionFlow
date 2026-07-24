import { beforeEach, describe, expect, it } from 'vitest'
import { DEFAULT_SETTINGS } from '@/defaults/settings'
import { Tree } from '@/services/background-tree'
import { Settings } from '@/services/settings'
import { State } from '@/types/session-tree'
import {
  createNote,
  createSeparator,
  createTab,
  createWindow,
  resetTree,
} from '../../helpers/tree-fixtures'
import { expectTreeInvariants } from '../../helpers/tree-invariants'
import { installFakeBrowser } from '../../helpers/fake-browser'

describe('tree removal and grouped descendant invariants', () => {
  beforeEach(() => {
    resetTree()
    Object.assign(Settings.values, structuredClone(DEFAULT_SETTINGS))
  })

  it('promotes direct children while leaving grandchildren attached and collapsible', () => {
    const grandparent = createNote('note-grandparent' as UID, {
      isParent: true,
    })
    const parent = createNote('note-parent' as UID, {
      parentUid: grandparent.uid,
      indentLevel: 2,
      isParent: true,
      collapsed: true,
    })
    const child = createTab('tab-child' as UID, {
      parentUid: parent.uid,
      indentLevel: 3,
      isParent: true,
    })
    const grandchild = createSeparator('separator-grandchild' as UID, {
      parentUid: child.uid,
      indentLevel: 4,
    })
    const window = createWindow('window-1' as UID, [
      grandparent,
      parent,
      child,
      grandchild,
    ])
    Tree.recomputeSessionTree(false)

    Tree.removeNote(parent.uid)

    expect(window.children.map((item) => item.uid)).toEqual([
      grandparent.uid,
      child.uid,
      grandchild.uid,
    ])
    expect(child.parentUid).toBe(grandparent.uid)
    expect(grandchild.parentUid).toBe(child.uid)
    expect(grandparent.isParent).toBe(true)
    expect(child.isParent).toBe(true)
    expect(grandchild.indentLevel).toBe(3)

    Tree.toggleCollapseTab(child.uid, false)
    expect(grandchild.isVisible).toBe(false)
    expectTreeInvariants()
  })

  it('removes orphaned group identities with their containing window', () => {
    const groupUid = 'group-removed-window' as UID
    const grouped = createTab('tab-grouped' as UID, {
      tabGroup: {
        uid: groupUid,
        id: -1,
        color: 'blue',
        collapsed: false,
      },
    })
    const window = createWindow('window-removed' as UID, [grouped])

    Tree.removeWindow(window.uid)

    expect(Tree.existingUidsSet.has(groupUid)).toBe(false)
    expect(Tree.tabsByUid.has(grouped.uid)).toBe(false)
    expect(Tree.windowsByUid.has(window.uid)).toBe(false)
    expectTreeInvariants()
  })

  it('clears the old parent and preserves metadata when its complete tab group moves', async () => {
    const group = {
      uid: 'group-stable' as UID,
      id: -1,
      title: 'Research',
      color: 'purple' as const,
      collapsed: true,
    }
    const oldParent = createNote('note-old-parent' as UID, { isParent: true })
    const first = createTab('tab-first' as UID, {
      parentUid: oldParent.uid,
      indentLevel: 2,
      tabGroup: structuredClone(group),
    })
    const second = createTab('tab-second' as UID, {
      parentUid: oldParent.uid,
      indentLevel: 2,
      tabGroup: structuredClone(group),
    })
    const target = createNote('note-target' as UID)
    const window = createWindow('window-1' as UID, [
      oldParent,
      first,
      second,
      target,
    ])

    await Tree.moveTreeItems(
      [first.uid, second.uid],
      window.children.length,
      target.uid,
      window.uid,
      false,
      false,
    )

    expect(oldParent.isParent).toBe(false)
    expect(target.isParent).toBe(true)
    expect(first.parentUid).toBe(target.uid)
    expect(second.parentUid).toBe(target.uid)
    expect(first.tabGroup).toEqual(group)
    expect(second.tabGroup).toEqual(group)
    expect(Tree.existingUidsSet.has(group.uid)).toBe(true)
    expectTreeInvariants()
  })

  it('ungroups mixed grouped tabs while preserving pinned and non-tab descendants in a browser-backed move', async () => {
    const fakeBrowser = installFakeBrowser()
    const group = {
      uid: 'group-browser-move' as UID,
      id: 7,
      title: 'Work',
      color: 'blue' as const,
      collapsed: false,
    }
    const pinned = createTab('tab-pinned' as UID, {
      id: 10,
      state: State.OPEN,
      pinned: true,
    })
    const target = createTab('tab-target' as UID, {
      id: 11,
      state: State.OPEN,
    })
    const groupedParent = createTab('tab-group-parent' as UID, {
      id: 12,
      state: State.OPEN,
      isParent: true,
      tabGroup: structuredClone(group),
    })
    const childNote = createNote('note-child' as UID, {
      parentUid: groupedParent.uid,
      indentLevel: 2,
    })
    const childSeparator = createSeparator('separator-child' as UID, {
      parentUid: groupedParent.uid,
      indentLevel: 2,
    })
    const groupedChild = createTab('tab-group-child' as UID, {
      id: 13,
      state: State.DISCARDED,
      parentUid: groupedParent.uid,
      indentLevel: 2,
      tabGroup: structuredClone(group),
    })
    const window = createWindow(
      'window-1' as UID,
      [pinned, target, groupedParent, childNote, childSeparator, groupedChild],
      { id: 100, state: State.OPEN },
    )
    fakeBrowser.tabs.move.mockImplementation(async (tabId) => ({
      id: Array.isArray(tabId) ? tabId[0] : tabId,
    }))
    fakeBrowser.tabs.group.mockResolvedValue(8)
    fakeBrowser.tabGroups.update.mockResolvedValue({
      id: 8,
      windowId: window.id,
      title: group.title,
      color: group.color,
      collapsed: group.collapsed,
    })

    await Tree.moveTreeItems(
      [pinned.uid, groupedParent.uid],
      0,
      undefined,
      window.uid,
      false,
      true,
    )

    expect(window.children.map((item) => item.uid)).toEqual([
      pinned.uid,
      groupedParent.uid,
      childNote.uid,
      childSeparator.uid,
      groupedChild.uid,
      target.uid,
    ])
    expect(pinned.tabGroup).toBeUndefined()
    expect(Tree.tabsByUid.get(groupedParent.uid)?.tabGroup).toBeUndefined()
    expect(Tree.tabsByUid.get(groupedChild.uid)?.tabGroup).toBeUndefined()
    expect(Tree.notesByUid.get(childNote.uid)?.parentUid).toBe(
      groupedParent.uid,
    )
    expect(Tree.separatorsByUid.get(childSeparator.uid)?.parentUid).toBe(
      groupedParent.uid,
    )
    expectTreeInvariants()
  })
})
