import {
  PANEL_MENU,
  SEPARATOR_MENU,
  TAB_MENU,
  WINDOW_MENU,
} from '@/defaults/context-menu'
import * as Actions from '@/services/context-menu-actions'
import { NOTE_MENU } from '@/defaults/context-menu'
import { contextMenuItemsNote } from './context-menu-items-note'
import { contextMenuItemsSeparator } from './context-menu-items-separator'
import { contextMenuItemsTab } from './context-menu-items-tab'
import { contextMenuItemsWindow } from './context-menu-items-window'

export const ContextMenu = {
  windowConfig: WINDOW_MENU,
  tabConfig: TAB_MENU,
  noteConfig: NOTE_MENU,
  separatorConfig: SEPARATOR_MENU,
  panelConfig: PANEL_MENU,

  contextMenuItems: {
    ...contextMenuItemsTab,
    ...contextMenuItemsWindow,
    ...contextMenuItemsNote,
    ...contextMenuItemsSeparator,
  },
  ...Actions,
}
