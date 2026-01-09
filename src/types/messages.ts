export interface Message {
  action: string
  [key: string]: unknown
}

export interface SaveTabMessage {
  action: 'saveTab'
  tabId: number
  tabUid: UID
}

export interface CloseTabMessage {
  action: 'closeTab'
  tabId: number
  tabUid: UID
}

export interface OpenTabMessage {
  action: 'openTab'
  tabUid: UID
  windowUid: UID
  url?: string | undefined
  discarded?: boolean | undefined
}

export interface CloseWindowMessage {
  action: 'closeWindow'
  windowId: number
  windowUid: UID
}

export interface SaveAndRemoveWindowMessage {
  action: 'saveWindow'
  windowId: number
  windowUid: UID
}

export interface OpenWindowMessage {
  action: 'openWindow'
  windowUid: UID
}

export interface FocusWindowMessage {
  action: 'focusWindow'
  windowId: number
}

export interface FocusTabMessage {
  action: 'focusTab'
  tabId: number
  windowId: number
}

export interface ReloadTabMessage {
  action: 'reloadTab'
  tabId: number
}

export interface ToggleCollapseWindowMessage {
  action: 'toggleCollapseWindow'
  windowUid: UID
}

export interface ToggleCollapseTabMessage {
  action: 'toggleCollapseTab'
  tabUid: UID
}

export interface TabIndentIncreaseMessage {
  action: 'tabIndentIncrease'
  tabUids: UID[]
}

export interface TabIndentDecreaseMessage {
  action: 'tabIndentDecrease'
  tabUids: UID[]
}

export interface OpenWindowsInSameLocationUpdatedMessage {
  action: 'openWindowsInSameLocationUpdated'
}

export interface DeselectAllItemsMessage {
  action: 'deselectAllItems'
}

export interface MoveTabsMessage {
  action: 'moveTabs'
  tabUIDs: UID[]
  targetWindowUid: UID
  targetIndex: number
  parentUid?: UID
  copy: boolean
}

export interface MoveWindowsMessage {
  action: 'moveWindows'
  windowUIDs: UID[]
  targetIndex: number
  copy: boolean
}

export interface PrintSessionTreeMessage {
  action: 'printSessionTree'
}

export type SessionTreeMessage =
  | SaveTabMessage
  | CloseTabMessage
  | OpenTabMessage
  | CloseWindowMessage
  | SaveAndRemoveWindowMessage
  | OpenWindowMessage
  | FocusWindowMessage
  | FocusTabMessage
  | ReloadTabMessage
  | OpenWindowsInSameLocationUpdatedMessage
  | ToggleCollapseWindowMessage
  | ToggleCollapseTabMessage
  | TabIndentIncreaseMessage
  | TabIndentDecreaseMessage
  | DeselectAllItemsMessage
  | MoveTabsMessage
  | MoveWindowsMessage
  | PrintSessionTreeMessage
