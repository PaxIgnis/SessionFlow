export type ContextMenuConfig = ContextMenuConfigItem[]

export interface ContextMenuConfigs {
  window?: ContextMenuConfig
  tab?: ContextMenuConfig
  panel?: ContextMenuConfig
}

export const enum ContextMenuType {
  Window = 1,
  Tab = 2,
  Panel = 3,
  Note = 4,
  Separator = 5,
}

export const enum ContextMenuItemType {
  Action = 1,
  Separator = 2,
  Submenu = 3,
}

export interface ContextMenuItem {
  id: string
  label: string
  type?: 'normal' | 'separator'
  icon?: string
  icons?: Record<string, string>
  enabled?: boolean
  submenu?: ContextMenuItem[]
  loadSubmenu?: () => Promise<ContextMenuItem[]>
  action?: () => void
}

export interface ContextMenuConfigItem {
  type: ContextMenuItemType
  id: string
  items?: ContextMenuConfigItem[]
}
