import { ContextMenuConfig, ContextMenuItemType } from '@/types/context-menu'

export const WINDOW_MENU: ContextMenuConfig = [
  // 'newTab',
  { type: ContextMenuItemType.Action, id: 'saveWindow' },
  { type: ContextMenuItemType.Action, id: 'closeWindow' },
  // 'minimizeWindow',
  // 'maximizeWindow',
  // 'unloadWindow',
]

export const TAB_MENU: ContextMenuConfig = [
  { type: ContextMenuItemType.Action, id: 'openTab' },
  { type: ContextMenuItemType.Action, id: 'reloadTab' },
  { type: ContextMenuItemType.Action, id: 'saveTab' },
  { type: ContextMenuItemType.Action, id: 'closeTab' },
  { type: ContextMenuItemType.Action, id: 'tabIndentIncrease' },
  { type: ContextMenuItemType.Action, id: 'tabIndentDecrease' },
  // 'unloadTab',
]

export const PANEL_MENU: ContextMenuConfig = [
  { type: ContextMenuItemType.Action, id: 'newWindow' },
  // 'collapseAllWindows',
  // 'expandAllWindows',
  // 'saveAllWindows',
]
