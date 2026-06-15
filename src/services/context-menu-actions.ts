import { ContextMenu } from '@/services/context-menu'
import { SessionTree } from '@/services/foreground-tree'
import {
  ContextMenuConfig,
  ContextMenuItem,
  ContextMenuItemType,
  ContextMenuType,
} from '@/types/context-menu'
// import { Settings } from '@/services/settings'
import { Selection } from '@/services/selection'
import {
  Note,
  SelectionType,
  Separator,
  Tab,
  TreeItemType,
  Window,
} from '@/types/session-tree'
import type { TreeItem } from '@/types/session-tree'

interface ItemLocation {
  item: TreeItem
  children: TreeItem[]
  index: number
}

/**
 * Controls logic opening of context menu based on selected type.
 *
 * @param type - The type of context menu to open.
 */
export function open(type: ContextMenuType): void {
  try {
    browser.menus.overrideContext({ showDefaults: false })
  } catch (e) {
    console.error('Error overriding context menu:', e)
  }
  ContextMenu.clear()
  if (!type) return
  let items: ContextMenuItem[] = []
  if (type === ContextMenuType.Window) {
    items = createContextMenuItems(ContextMenu.windowConfig)
  } else if (type === ContextMenuType.Tab) {
    items = createContextMenuItems(ContextMenu.tabConfig)
  } else if (type === ContextMenuType.Note) {
    items = createContextMenuItems(ContextMenu.noteConfig)
  } else if (type === ContextMenuType.Separator) {
    items = createContextMenuItems(ContextMenu.separatorConfig)
  } else if (type === ContextMenuType.Panel) {
    // TODO: Implement panel context menu
    items = createContextMenuItems(ContextMenu.panelConfig)
  }
  // No items to display
  if (!items.length) return

  createContextMenu(items)
}

/**
 * Creates array of context menu items from the given configuration.
 * Returns an array of ContextMenuItem.
 *
 * @param config - The context menu configuration.
 * @returns items - The array of context menu items.
 */
export function createContextMenuItems(
  config: ContextMenuConfig,
): ContextMenuItem[] {
  const items: ContextMenuItem[] = []
  config.forEach((item) => {
    if (item.type === ContextMenuItemType.Action) {
      const menuItem = ContextMenu.contextMenuItems[item.id]
      if (menuItem) {
        items.push(menuItem())
      }
    } else if (item.type === ContextMenuItemType.Separator) {
      // TODO: Implement separator
    } else if (item.type === ContextMenuItemType.Submenu) {
      // TODO: Implement submenu items
    }
  })
  return items
}

/**
 * Creates the context menu in the browser. Adds each ContextMenuItem to the browser context menu.
 *
 * @param items - The array of context menu items to add to browser context menu.
 */
export function createContextMenu(items: ContextMenuItem[]): void {
  for (const item of items) {
    const optionProperties: browser.menus._CreateCreateProperties = {
      type: 'normal',
      title: item.label,
      contexts: ['all'],
      onclick: () => {
        if (item.action) {
          item.action()
        }
        Selection.clearSelection()
      },
    }
    if (item.enabled === false) {
      optionProperties.enabled = false
    }
    browser.menus.create(optionProperties)
  }
}

/**
 * Clears all context menu items that have been added.
 */
export function clear(): void {
  browser.menus.removeAll()
}

export function canIncreaseIndentSelectedItems(items: TreeItem[]): boolean {
  return items.some((item) => canIncreaseIndent(item))
}

export function canDecreaseIndentSelectedItems(items: TreeItem[]): boolean {
  return items.some((item) => canDecreaseIndent(item))
}

function canIncreaseIndent(item: TreeItem): boolean {
  const location = findItemLocation(item.uid)
  if (!location || location.index === 0) return false

  const previous = findPreviousSiblingAtSameIndent(
    location.children,
    location.index,
    location.item.indentLevel ?? 0,
  )
  if (!previous || previous.type === TreeItemType.SEPARATOR) return false

  if (
    location.item.type === TreeItemType.WINDOW &&
    previous.type === TreeItemType.WINDOW
  ) {
    return false
  }

  return true
}

function canDecreaseIndent(item: TreeItem): boolean {
  const location = findItemLocation(item.uid)
  if (!location) return false

  if (location.item.parentUid) return true
  if (location.item.type === TreeItemType.WINDOW) return false
  if (!location.item.windowUid) return false

  return location.item.type !== TreeItemType.TAB
}

function findItemLocation(uid: UID): ItemLocation | undefined {
  const topLevelItems = SessionTree.reactiveItems.value as TreeItem[]
  const topLevelIndex = topLevelItems.findIndex((item) => item.uid === uid)
  if (topLevelIndex !== -1) {
    return {
      item: topLevelItems[topLevelIndex],
      children: topLevelItems,
      index: topLevelIndex,
    }
  }

  for (const window of SessionTree.windowsByUid.values()) {
    const children = window.children as TreeItem[]
    const index = children.findIndex((item) => item.uid === uid)
    if (index !== -1) return { item: children[index], children, index }
  }
  return undefined
}

function findPreviousSiblingAtSameIndent(
  items: TreeItem[],
  index: number,
  indentLevel: number,
): TreeItem | undefined {
  for (let i = index - 1; i >= 0; i--) {
    const itemIndent = items[i].indentLevel ?? 0
    if (itemIndent === indentLevel) return items[i]
    if (itemIndent < indentLevel) return undefined
  }
  return undefined
}

/**
 * First step when right-clicking to open context menu.
 * Controls selection of the item being right-clicked, then opens the context menu.
 *
 * @param type - The type of context menu.
 * @param e - The mouse event.
 * @param window - The window object (if applicable).
 * @param tab - The tab object (if applicable).
 * @param selectionType - The type of selection.
 */
export function handleContextMenuClick(
  type: ContextMenuType,
  e: MouseEvent,
  window?: Window,
  tab?: Tab,
  note?: Note,
  separator?: Separator,
  selectionType?: SelectionType,
): void {
  if (type === ContextMenuType.Window && window) {
    Selection.selectItemForContextMenu(
      window,
      selectionType || SelectionType.WINDOW,
      e,
    )
  } else if (type === ContextMenuType.Tab && tab) {
    Selection.selectItemForContextMenu(
      tab,
      selectionType || SelectionType.TAB,
      e,
    )
  } else if (type === ContextMenuType.Note && note) {
    Selection.selectItemForContextMenu(
      note,
      selectionType || SelectionType.NOTE,
      e,
    )
  } else if (type === ContextMenuType.Separator && separator) {
    Selection.selectItemForContextMenu(
      separator,
      selectionType || SelectionType.SEPARATOR,
      e,
    )
  }
  ContextMenu.open(type)
}
