import { SessionTree } from '@/services/foreground-tree'
import { Selection } from '@/services/selection'
import { SelectionType, Tab, Window } from '@/types/session-tree'

export function selectItem(
  item: Window | Tab,
  type: SelectionType,
  e: MouseEvent
) {
  const firstItem = Selection.selectedItems.value[0]
  // If the first item is not of the same type, clear the selection
  if (firstItem && firstItem.type !== type) {
    clearSelection()
  }

  const ctrlKey = e.ctrlKey || e.metaKey
  const shiftKey = e.shiftKey
  if (item.selected && ctrlKey) {
    // If the item is already selected and ctrl/meta key is pressed, deselect & remove from selection
    item.selected = false
    Selection.removeSelectedItem(item, type)
  } else if (!item.selected && ctrlKey) {
    // If item is not selected and ctrl/meta key is pressed, select & add to selection
    item.selected = true
    Selection.selectedItems.value.push({ item, type })
  } else if (!item.selected && shiftKey && !firstItem) {
    // If item is not selected and shiftkey is pressed, then select
    item.selected = true
    Selection.selectedItems.value.push({ item, type })
  } else if (
    shiftKey &&
    firstItem &&
    type === SelectionType.TAB &&
    (firstItem.item as Tab).windowSerialId === (item as Tab).windowSerialId
  ) {
    // If multiple tabs selected in same window & shift, then select all tabs between firstItem and item
    Selection.selectMultipleTabsInWindow(firstItem.item as Tab, item as Tab)
  } else {
    // Clear selection and select item
    clearSelection()
    item.selected = true
    Selection.selectedItems.value.push({ item, type })
  }
}

export function removeSelectedItem(item: Window | Tab, type: SelectionType) {
  const index = Selection.selectedItems.value.findIndex(
    (selectedItem) => selectedItem.item === item && selectedItem.type === type
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
  const window = SessionTree.reactiveWindowsList.value.find(
    (w) => w.serialId === firstTab.windowSerialId
  )
  if (!window) {
    console.error('Invalid window selection')
    return
  }

  const allTabs = window.tabs
  const startIndex = allTabs.indexOf(firstTab)
  const endIndex = allTabs.indexOf(lastTab)

  if (startIndex === -1 || endIndex === -1) {
    console.error('Invalid tab selection')
    return
  }

  // Push the firstTab first
  firstTab.selected = true
  Selection.selectedItems.value.push({
    item: firstTab,
    type: SelectionType.TAB,
  })

  // Then push all tabs in between
  const [minIndex, maxIndex] = [startIndex, endIndex].sort((a, b) => a - b)
  for (let i = minIndex; i <= maxIndex; i++) {
    if (i === startIndex) continue // Skip the firstTab as it's already added
    const tab = allTabs[i]
    if (tab) {
      tab.selected = true
      Selection.selectedItems.value.push({ item: tab, type: SelectionType.TAB })
    }
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
  item: Window | Tab,
  type: SelectionType,
  e: MouseEvent
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
