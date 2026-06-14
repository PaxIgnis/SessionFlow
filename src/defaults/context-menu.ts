import { ContextMenuConfig, ContextMenuItemType } from '@/types/context-menu'

export const WINDOW_MENU: ContextMenuConfig = [
  { type: ContextMenuItemType.Action, id: 'createNote' },
  { type: ContextMenuItemType.Action, id: 'createSeparator' },
  { type: ContextMenuItemType.Action, id: 'duplicateTreeItem' },
  // 'newTab',
  { type: ContextMenuItemType.Action, id: 'saveWindow' },
  { type: ContextMenuItemType.Action, id: 'closeWindow' },
  { type: ContextMenuItemType.Action, id: 'editWindowTitle' },
  { type: ContextMenuItemType.Action, id: 'treeItemIndentIncrease' },
  { type: ContextMenuItemType.Action, id: 'treeItemIndentDecrease' },
  // 'minimizeWindow',
  // 'maximizeWindow',
  // 'unloadWindow',
]

export const TAB_MENU: ContextMenuConfig = [
  { type: ContextMenuItemType.Action, id: 'createNote' },
  { type: ContextMenuItemType.Action, id: 'createSeparator' },
  { type: ContextMenuItemType.Action, id: 'openTab' },
  { type: ContextMenuItemType.Action, id: 'reloadTab' },
  { type: ContextMenuItemType.Action, id: 'saveTab' },
  { type: ContextMenuItemType.Action, id: 'closeTab' },
  { type: ContextMenuItemType.Action, id: 'editLabel' },
  { type: ContextMenuItemType.Action, id: 'pinTab' },
  { type: ContextMenuItemType.Action, id: 'unpinTab' },
  { type: ContextMenuItemType.Action, id: 'duplicateTreeItem' },
  { type: ContextMenuItemType.Action, id: 'treeItemIndentIncrease' },
  { type: ContextMenuItemType.Action, id: 'treeItemIndentDecrease' },
  // 'unloadTab',
]

export const NOTE_MENU: ContextMenuConfig = [
  { type: ContextMenuItemType.Action, id: 'createNote' },
  { type: ContextMenuItemType.Action, id: 'createSeparator' },
  { type: ContextMenuItemType.Action, id: 'duplicateTreeItem' },
  { type: ContextMenuItemType.Action, id: 'treeItemIndentIncrease' },
  { type: ContextMenuItemType.Action, id: 'treeItemIndentDecrease' },
  { type: ContextMenuItemType.Action, id: 'editNote' },
  { type: ContextMenuItemType.Action, id: 'removeNote' },
]

export const SEPARATOR_MENU: ContextMenuConfig = [
  { type: ContextMenuItemType.Action, id: 'createNote' },
  { type: ContextMenuItemType.Action, id: 'createSeparatorBelow' },
  { type: ContextMenuItemType.Action, id: 'treeItemIndentIncrease' },
  { type: ContextMenuItemType.Action, id: 'treeItemIndentDecrease' },
  { type: ContextMenuItemType.Action, id: 'removeSeparator' },
]

export const PANEL_MENU: ContextMenuConfig = [
  { type: ContextMenuItemType.Action, id: 'createNote' },
  { type: ContextMenuItemType.Action, id: 'createSeparator' },
  { type: ContextMenuItemType.Action, id: 'newWindow' },
  // 'collapseAllWindows',
  // 'expandAllWindows',
  // 'saveAllWindows',
]
