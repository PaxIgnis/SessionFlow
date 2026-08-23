import { SessionTree } from '@/services/foreground-tree'
import { Selection } from '@/services/selection'
import {
  Note,
  Separator,
  SelectionType,
  Tab,
  TreeItem,
  TreeItemType,
  Window,
} from '@/types/session-tree'

export type ContextMenuDescendantScope = 'always' | 'collapsed' | 'never'

export function selectItem(item: TreeItem, type: SelectionType, e: MouseEvent) {
  const firstItem = Selection.selectedItems.value[0]
  const anchorItem = Selection.anchor.value ?? firstItem?.item

  const ctrlKey = e.ctrlKey || e.metaKey
  const shiftKey = e.shiftKey
  if (shiftKey && anchorItem) {
    if (selectItemRange(anchorItem, item, ctrlKey)) return
    clearSelection()
    addSelectedItem(item)
    Selection.anchor.value = item
    return
  }

  // Every non-range click re-anchors; only shift-ranges leave the anchor put.
  Selection.anchor.value = item

  if (item.selected && ctrlKey) {
    // If the item is already selected and ctrl/meta key is pressed, deselect & remove from selection
    item.selected = false
    Selection.removeSelectedItem(item, type)
  } else if (!item.selected && ctrlKey) {
    // If item is not selected and ctrl/meta key is pressed, select & add to selection
    item.selected = true
    Selection.selectedItems.value.push({ item, type })
  } else if (!item.selected && shiftKey && !firstItem) {
    // If no items are selected and shiftkey is pressed, then select
    item.selected = true
    Selection.selectedItems.value.push({ item, type })
  } else if (
    shiftKey &&
    firstItem &&
    item.type === TreeItemType.TAB &&
    firstItem.item.type === TreeItemType.TAB &&
    (firstItem.item as Tab).windowUid === (item as Tab).windowUid
  ) {
    // If multiple tabs selected in same window & shift, then select all tabs between firstItem and item
    Selection.selectMultipleTabsInWindow(firstItem.item as Tab, item as Tab)
  } else if (
    shiftKey &&
    firstItem &&
    item.type === TreeItemType.WINDOW &&
    firstItem.item.type === TreeItemType.WINDOW &&
    (firstItem.item as Window).uid !== (item as Window).uid
  ) {
    // If multiple windows selected & shift, then select all windows between firstItem and item
    Selection.selectMultipleWindows(firstItem.item as Window, item as Window)
  } else {
    // Clear selection and select item
    clearSelection()
    item.selected = true
    Selection.selectedItems.value.push({ item, type })
  }
}

function selectItemRange(
  firstItem: TreeItem,
  lastItem: TreeItem,
  additive: boolean,
): boolean {
  const logicalItems = getLogicalTreeOrder()
  const firstIndex = logicalItems.findIndex(
    (item) => item.uid === firstItem.uid,
  )
  const lastIndex = logicalItems.findIndex((item) => item.uid === lastItem.uid)
  if (firstIndex === -1 || lastIndex === -1) return false

  if (!additive) Selection.clearSelection()
  const [minIndex, maxIndex] = [firstIndex, lastIndex].sort((a, b) => a - b)
  for (let i = minIndex; i <= maxIndex; i++) {
    addSelectedItem(logicalItems[i])
  }
  // The fill runs in tree order and clearSelection drops the anchor, so put it
  // back: extending upward must keep ranging from where the user started.
  Selection.anchor.value = firstItem
  return true
}

export function getLogicalTreeOrder(): TreeItem[] {
  return SessionTree.reactiveItems.value.flatMap((item) =>
    item.type === TreeItemType.WINDOW ? [item, ...item.children] : [item],
  )
}

export function collectContextMenuActionItems(
  items: readonly TreeItem[],
  scope: ContextMenuDescendantScope,
): TreeItem[] {
  const logicalItems = getLogicalTreeOrder()
  const currentByUid = new Map(logicalItems.map((item) => [item.uid, item]))
  const includedUids = new Set<UID>()

  for (const selectedItem of items) {
    const item = currentByUid.get(selectedItem.uid) ?? selectedItem
    includedUids.add(item.uid)
    if (item.type === TreeItemType.WINDOW) {
      item.children.forEach((child) => includedUids.add(child.uid))
      continue
    }
    if (scope === 'never' || (scope === 'collapsed' && !item.collapsed)) {
      continue
    }

    const containingItems = item.windowUid
      ? (SessionTree.windowsByUid.get(item.windowUid)?.children ?? [])
      : (SessionTree.reactiveItems.value as TreeItem[])
    const itemIndex = containingItems.findIndex(
      (candidate) => candidate.uid === item.uid,
    )
    if (itemIndex === -1) continue
    const itemIndent = item.indentLevel ?? 0
    for (let index = itemIndex + 1; index < containingItems.length; index++) {
      const candidate = containingItems[index]
      if ((candidate.indentLevel ?? 0) <= itemIndent) break
      includedUids.add(candidate.uid)
      if (candidate.type === TreeItemType.WINDOW) {
        candidate.children.forEach((child) => includedUids.add(child.uid))
      }
    }
  }

  return logicalItems.filter((item) => includedUids.has(item.uid))
}

function addSelectedItem(item: TreeItem | undefined): void {
  if (!item) return
  if (
    Selection.selectedItems.value.some(
      (selectedItem) => selectedItem.item.uid === item.uid,
    )
  ) {
    return
  }
  item.selected = true
  Selection.selectedItems.value.push({
    item,
    type: getSelectionType(item),
  })
}

function getSelectionType(item: TreeItem): SelectionType {
  if (item.type === TreeItemType.WINDOW) return SelectionType.WINDOW
  if (item.type === TreeItemType.TAB) return SelectionType.TAB
  if (item.type === TreeItemType.NOTE) return SelectionType.NOTE
  return SelectionType.SEPARATOR
}

export function removeSelectedItem(item: TreeItem, type: SelectionType) {
  const index = Selection.selectedItems.value.findIndex(
    (selectedItem) => selectedItem.item === item && selectedItem.type === type,
  )
  if (index !== -1) {
    Selection.selectedItems.value.splice(index, 1)
  } else {
    console.error('Failed to remove selected item')
  }
}

export function selectMultipleTabsInWindow(firstTab: Tab, lastTab: Tab) {
  Selection.clearSelection()
  // First find all tabs between the firstTab and lastTab
  const window = SessionTree.windowsByUid.get(firstTab.windowUid)
  if (!window) {
    console.error('Invalid window selection')
    return
  }

  const allTabs = window.children
  const startIndex = allTabs.indexOf(firstTab)
  const endIndex = allTabs.indexOf(lastTab)

  if (startIndex === -1 || endIndex === -1) {
    console.error('Invalid tab selection')
    return
  }

  // Push all tabs and notes in between
  const [minIndex, maxIndex] = [startIndex, endIndex].sort((a, b) => a - b)
  for (let i = minIndex; i <= maxIndex; i++) {
    addSelectedItem(allTabs[i])
  }
}

export function selectMultipleWindows(firstWindow: Window, lastWindow: Window) {
  Selection.clearSelection()
  const allItems = SessionTree.reactiveItems.value
  const startIndex = allItems.findIndex((item) => item.uid === firstWindow.uid)
  const endIndex = allItems.findIndex((item) => item.uid === lastWindow.uid)

  if (startIndex === -1 || endIndex === -1) {
    console.error('Invalid window selection')
    return
  }

  // Push all windows and notes in between
  const [minIndex, maxIndex] = [startIndex, endIndex].sort((a, b) => a - b)
  for (let i = minIndex; i <= maxIndex; i++) {
    addSelectedItem(allItems[i])
  }
}

export function clearSelection() {
  // Clear selected status from each item
  Selection.selectedItems.value.forEach((item) => {
    if (item && item.item && item.item.selected) {
      item.item.selected = false
    }
  })
  Selection.selectedItems.value = []
  Selection.anchor.value = undefined
}

export function getSelectedWindows(): Array<Window> {
  return Selection.selectedItems.value
    .filter((selectedItem) => selectedItem.type === SelectionType.WINDOW)
    .map((selectedItem) => selectedItem.item as Window)
}

export function getSelectedTabs(): Array<Tab> {
  return Selection.selectedItems.value
    .filter((selectedItem) => selectedItem.type === SelectionType.TAB)
    .map((selectedItem) => selectedItem.item as Tab)
}

export function getSelectedNotes(): Array<Note> {
  return Selection.selectedItems.value
    .filter((selectedItem) => selectedItem.type === SelectionType.NOTE)
    .map((selectedItem) => selectedItem.item as Note)
}

export function getSelectedSeparators(): Array<Separator> {
  return Selection.selectedItems.value
    .filter((selectedItem) => selectedItem.type === SelectionType.SEPARATOR)
    .map((selectedItem) => selectedItem.item as Separator)
}

export function getSelectedItems(type: SelectionType): Array<TreeItem> {
  if (type === SelectionType.WINDOW) {
    return getSelectedWindows()
  } else if (type === SelectionType.TAB) {
    return getSelectedTabs()
  } else if (type === SelectionType.NOTE) {
    return getSelectedNotes()
  } else if (type === SelectionType.SEPARATOR) {
    return getSelectedSeparators()
  }
  return []
}

/**
 * Called when right-clicking an item to open context menu.
 * Current logic: if the item is not selected, select it. If ctrl/meta key is pressed, also include other items already selected,
 * otherwise clear other selections and only select the right-clicked item.
 *
 * @param item The item to select.
 * @param type The type of the item (enum).
 * @param e
 */
export function selectItemForContextMenu(
  item: TreeItem,
  type: SelectionType,
  e: MouseEvent,
): void {
  const ctrlKey = e.ctrlKey || e.metaKey
  if (!item.selected && ctrlKey) {
    // If item is not selected and ctrl/meta key is pressed, select & add to selection
    item.selected = true
    Selection.selectedItems.value.push({ item, type })
    Selection.anchor.value = item
  } else if (!item.selected && !ctrlKey) {
    // If ctrl/meta is not pressed, clear all selection and select item
    clearSelection()
    item.selected = true
    Selection.selectedItems.value.push({ item, type })
    Selection.anchor.value = item
  }
}
