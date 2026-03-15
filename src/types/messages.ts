export interface Message {
  action: string
  [key: string]: unknown
}

// ==============================
// Tab Messages
// ==============================

export interface CloseTabMessage {
  action: 'closeTab'
  tabId: number
  tabUid: UID
}

export interface DuplicateTabMessage {
  action: 'duplicateTab'
  tabId: number
  tabUid: UID
}

export interface FocusTabMessage {
  action: 'focusTab'
  tabId: number
  windowId: number
}

export interface MoveTabsMessage {
  action: 'moveTabs'
  tabUIDs: UID[]
  targetWindowUid: UID
  targetIndex: number
  parentUid?: UID
  copy: boolean
}

export interface OpenTabMessage {
  action: 'openTab'
  tabUid: UID
  windowUid: UID
  url?: string | undefined
  discarded?: boolean | undefined
}

export interface PinTabMessage {
  action: 'pinTab'
  tabUid: UID
}

export interface ReloadTabMessage {
  action: 'reloadTab'
  tabId: number
}

export interface SaveTabMessage {
  action: 'saveTab'
  tabId: number
  tabUid: UID
}

export interface TabIndentDecreaseMessage {
  action: 'tabIndentDecrease'
  tabUids: UID[]
}

export interface TabIndentIncreaseMessage {
  action: 'tabIndentIncrease'
  tabUids: UID[]
}

export interface ToggleCollapseTabMessage {
  action: 'toggleCollapseTab'
  tabUid: UID
}

export interface UnpinTabMessage {
  action: 'unpinTab'
  tabUid: UID
}

// ==============================
// Window Messages
// ==============================

export interface CloseWindowMessage {
  action: 'closeWindow'
  windowId: number
  windowUid: UID
}

export interface FocusWindowMessage {
  action: 'focusWindow'
  windowId: number
}

export interface MoveWindowsMessage {
  action: 'moveWindows'
  windowUIDs: UID[]
  targetIndex: number
  copy: boolean
}

export interface OpenWindowMessage {
  action: 'openWindow'
  windowUid: UID
}

export interface OpenWindowsInSameLocationUpdatedMessage {
  action: 'openWindowsInSameLocationUpdated'
}

export interface SaveAndRemoveWindowMessage {
  action: 'saveWindow'
  windowId: number
  windowUid: UID
}

export interface ToggleCollapseWindowMessage {
  action: 'toggleCollapseWindow'
  windowUid: UID
}

// ==============================
// Debug Messages
// ==============================

export interface PrintSessionTreeMessage {
  action: 'printSessionTree'
}

// ==============================
// Tree Messages
// ==============================

export interface DeselectAllItemsMessage {
  action: 'deselectAllItems'
}

export type SessionTreeMessage =
  | CloseTabMessage
  | CloseWindowMessage
  | DeselectAllItemsMessage
  | DuplicateTabMessage
  | FocusTabMessage
  | FocusWindowMessage
  | MoveTabsMessage
  | MoveWindowsMessage
  | OpenTabMessage
  | OpenWindowMessage
  | OpenWindowsInSameLocationUpdatedMessage
  | PinTabMessage
  | PrintSessionTreeMessage
  | ReloadTabMessage
  | SaveAndRemoveWindowMessage
  | SaveTabMessage
  | TabIndentDecreaseMessage
  | TabIndentIncreaseMessage
  | ToggleCollapseTabMessage
  | ToggleCollapseWindowMessage
  | UnpinTabMessage
