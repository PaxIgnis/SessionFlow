import { beforeEach, describe, expect, it, vi } from 'vitest'
import { Selection } from '@/services/selection'
import { Settings } from '@/services/settings'
import { SelectionType } from '@/types/session-tree'
import {
  makeForegroundNote,
  makeForegroundSeparator,
  makeForegroundTab,
  makeForegroundWindow,
  resetForegroundTree,
} from '../../helpers/foreground-tree-fixtures'

const duplicateTreeItems = vi.hoisted(() => vi.fn())
const treeItemIndentDecrease = vi.hoisted(() => vi.fn())
const treeItemIndentIncrease = vi.hoisted(() => vi.fn())
const openDeleteTreeItemsModal = vi.hoisted(() => vi.fn())

vi.mock('@/services/foreground-messages', () => ({
  duplicateTreeItems,
  treeItemIndentDecrease,
  treeItemIndentIncrease,
}))

vi.mock('@/services/modal-state', () => ({
  openDeleteTreeItemsModal,
}))

describe('generic tree context menu items', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    resetForegroundTree()
    Selection.selectedItems.value = []
  })

  it('duplicates a mixed collapsed subtree using the duplicate scope', async () => {
    const parent = makeForegroundTab('parent' as UID, {
      collapsed: true,
      isParent: true,
    })
    const child = makeForegroundNote('child' as UID, {
      parentUid: parent.uid,
      indentLevel: 2,
    })
    const window = makeForegroundWindow('window-1' as UID, [parent, child])
    resetForegroundTree([window])
    const indexedParent = (
      await import('@/services/foreground-tree')
    ).SessionTree.tabsByUid.get(parent.uid)!
    indexedParent.selected = true
    Selection.selectedItems.value = [
      { item: indexedParent, type: SelectionType.TAB },
    ]
    Settings.values.duplicateTreeItemDescendants = 'collapsed'
    const { contextMenuItemsTree } =
      await import('@/services/context-menu-items-tree')

    const item = contextMenuItemsTree.duplicateTreeItem()
    item.action?.()

    expect(item.label).toBe('Duplicate')
    expect(duplicateTreeItems).toHaveBeenCalledWith(
      [parent.uid, child.uid],
      false,
    )
  })

  it('opens Delete confirmation for saved mixed descendants', async () => {
    const parent = makeForegroundTab('parent' as UID, {
      collapsed: true,
      isParent: true,
    })
    const child = makeForegroundNote('child' as UID, {
      parentUid: parent.uid,
      indentLevel: 2,
    })
    const window = makeForegroundWindow('window-1' as UID, [parent, child])
    resetForegroundTree([window])
    const indexedParent = (
      await import('@/services/foreground-tree')
    ).SessionTree.tabsByUid.get(parent.uid)!
    indexedParent.selected = true
    Selection.selectedItems.value = [
      { item: indexedParent, type: SelectionType.TAB },
    ]
    Settings.values.contextMenuDeleteDescendants = 'collapsed'
    const { contextMenuItemsTree } =
      await import('@/services/context-menu-items-tree')

    const item = contextMenuItemsTree.deleteTreeItem()
    item.action?.()

    expect(item).toMatchObject({
      id: 'deleteTreeItem',
      label: 'Delete',
      enabled: true,
    })
    expect(openDeleteTreeItemsModal).toHaveBeenCalledWith([
      expect.objectContaining({ uid: parent.uid }),
      expect.objectContaining({ uid: child.uid }),
    ])
  })

  it('dispatches generic indent actions with selected separator uids', async () => {
    const separator = makeForegroundSeparator('separator-1' as UID)
    Selection.selectedItems.value = [
      { item: separator, type: SelectionType.SEPARATOR },
    ]
    const { contextMenuItemsTree } =
      await import('@/services/context-menu-items-tree')

    contextMenuItemsTree.treeItemIndentIncrease().action?.()
    contextMenuItemsTree.treeItemIndentDecrease().action?.()

    expect(treeItemIndentIncrease).toHaveBeenCalledWith([separator.uid])
    expect(treeItemIndentDecrease).toHaveBeenCalledWith([separator.uid])
  })
})
