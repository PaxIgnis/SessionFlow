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

export function selectItem(
  item: TreeItem,
  type: SelectionType,
  e: MouseEvent,
) {
  const firstItem = Selection.selectedItems.value[0]

  const ctrlKey = e.ctrlKey || e.metaKey
  const shiftKey = e.shiftKey
  if (shiftKey && firstItem && selectItemRange(firstItem.item, item)) {
    return
  }

  // If the first item is not of the same type, clear the selection
  if (firstItem && firstItem.type !== type) {
    clearSelection()
  }

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

function selectItemRange(firstItem: TreeItem, lastItem: TreeItem): boolean {
  if (selectTopLevelItemRange(firstItem, lastItem)) {
    return true
  }
  return selectWindowChildItemRange(firstItem, lastItem)
}

function selectTopLevelItemRange(
  firstItem: TreeItem,
  lastItem: TreeItem,
): boolean {
  const firstIndex = SessionTree.reactiveItems.value.findIndex(
    (item) => item.uid === firstItem.uid,
  )
  const lastIndex = SessionTree.reactiveItems.value.findIndex(
    (item) => item.uid === lastItem.uid,
  )
  if (firstIndex === -1 || lastIndex === -1) return false

  Selection.clearSelection()
  const [minIndex, maxIndex] = [firstIndex, lastIndex].sort((a, b) => a - b)
  for (let i = minIndex; i <= maxIndex; i++) {
    addSelectedItem(SessionTree.reactiveItems.value[i])
  }
  return true
}

function selectWindowChildItemRange(
  firstItem: TreeItem,
  lastItem: TreeItem,
): boolean {
  const firstWindowUid = getWindowUid(firstItem)
  const lastWindowUid = getWindowUid(lastItem)
  if (!firstWindowUid || firstWindowUid !== lastWindowUid) return false

  const window = SessionTree.windowsByUid.get(firstWindowUid)
  if (!window) return false

  const firstIndex = window.children.findIndex(
    (item) => item.uid === firstItem.uid,
  )
  const lastIndex = window.children.findIndex(
    (item) => item.uid === lastItem.uid,
  )
  if (firstIndex === -1 || lastIndex === -1) return false

  Selection.clearSelection()
  const [minIndex, maxIndex] = [firstIndex, lastIndex].sort((a, b) => a - b)
  for (let i = minIndex; i <= maxIndex; i++) {
    addSelectedItem(window.children[i])
  }
  return true
}

function getWindowUid(item: TreeItem): UID | undefined {
  if (item.type === TreeItemType.TAB) return item.windowUid
  if (item.type === TreeItemType.NOTE) return item.windowUid
  if (item.type === TreeItemType.SEPARATOR) return item.windowUid
  return undefined
}

function addSelectedItem(item: TreeItem | undefined): void {
  if (!item) return
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
  const firstItem = Selection.selectedItems.value[0]
  // If the first item is not of the same type, clear the selection
  if (firstItem && firstItem.type !== type) {
    clearSelection()
  }

  const ctrlKey = e.ctrlKey || e.metaKey
  if (!item.selected && ctrlKey) {
    // If item is not selected and ctrl/meta key is pressed, select & add to selection
    item.selected = true
    Selection.selectedItems.value.push({ item, type })
  } else if (!item.selected && !ctrlKey) {
    // If ctrl/meta is not pressed, clear all selection and select item
    clearSelection()
    item.selected = true
    Selection.selectedItems.value.push({ item, type })
  }
}
