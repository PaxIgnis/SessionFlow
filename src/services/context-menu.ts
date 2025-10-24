import { PANEL_MENU, TAB_MENU, WINDOW_MENU } from '@/defaults/context-menu'
import * as Actions from '@/services/context-menu-actions'
import { contextMenuItemsTab } from './context-menu-items-tab'
import { contextMenuItemsWindow } from './context-menu-items-window'

export const ContextMenu = {
  windowConfig: WINDOW_MENU,
  tabConfig: TAB_MENU,
  panelConfig: PANEL_MENU,

  contextMenuItems: { ...contextMenuItemsTab, ...contextMenuItemsWindow },
  ...Actions,
}
