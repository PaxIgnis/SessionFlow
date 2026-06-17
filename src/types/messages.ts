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

export interface FocusTabMessage {
  action: 'focusTab'
  tabId: number
  windowId: number
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

export interface ToggleCollapseTabMessage {
  action: 'toggleCollapseTab'
  tabUid: UID
}

export interface UnpinTabMessage {
  action: 'unpinTab'
  tabUid: UID
}

export interface UpdateCustomLabelMessage {
  action: 'updateCustomLabel'
  uid: UID
  customLabel?: string
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

export interface MoveTreeItemsMessage {
  action: 'moveTreeItems'
  itemUIDs: UID[]
  targetIndex: number
  parentUid?: UID
  targetWindowUid?: UID
  copy: boolean
  includeDescendants?: boolean
}

export interface DuplicateTreeItemsMessage {
  action: 'duplicateTreeItems'
  itemUIDs: UID[]
}

export interface TreeItemIndentIncreaseMessage {
  action: 'treeItemIndentIncrease'
  itemUIDs: UID[]
}

export interface TreeItemIndentDecreaseMessage {
  action: 'treeItemIndentDecrease'
  itemUIDs: UID[]
}

export interface OpenWindowMessage {
  action: 'openWindow'
  windowUid: UID
}

export interface OpenWindowsInSameLocationUpdatedMessage {
  action: 'openWindowsInSameLocationUpdated'
}

export interface RegisterSessionTreeWindowMessage {
  action: 'registerSessionTreeWindow'
  windowId: number
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

export interface UpdateWindowTitleMessage {
  action: 'updateWindowTitle'
  windowUid: UID
  newTitle: string
}

// ==============================
// Note Messages
// ==============================

export interface CreateNoteMessage {
  action: 'createNote'
  parentUid?: UID
  index?: number
  text?: string
}

export interface RemoveNoteMessage {
  action: 'removeNote'
  noteUid: UID
}

export interface ToggleCollapseNoteMessage {
  action: 'toggleCollapseNote'
  noteUid: UID
}

export interface UpdateNoteTextMessage {
  action: 'updateNoteText'
  noteUid: UID
  text: string
}

// ==============================
// Separator Messages
// ==============================

export interface CreateSeparatorMessage {
  action: 'createSeparator'
  parentUid?: UID
  index?: number
}

export interface RemoveSeparatorMessage {
  action: 'removeSeparator'
  separatorUid: UID
}

export interface CreateSeparatorBelowMessage {
  action: 'createSeparatorBelow'
  separatorUid: UID
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
  | CreateSeparatorMessage
  | CreateSeparatorBelowMessage
  | CreateNoteMessage
  | DeselectAllItemsMessage
  | DuplicateTreeItemsMessage
  | FocusTabMessage
  | FocusWindowMessage
  | MoveTreeItemsMessage
  | MoveWindowsMessage
  | OpenTabMessage
  | OpenWindowMessage
  | OpenWindowsInSameLocationUpdatedMessage
  | RegisterSessionTreeWindowMessage
  | PinTabMessage
  | PrintSessionTreeMessage
  | ReloadTabMessage
  | RemoveNoteMessage
  | RemoveSeparatorMessage
  | SaveAndRemoveWindowMessage
  | SaveTabMessage
  | TreeItemIndentDecreaseMessage
  | TreeItemIndentIncreaseMessage
  | ToggleCollapseTabMessage
  | ToggleCollapseNoteMessage
  | ToggleCollapseWindowMessage
  | UnpinTabMessage
  | UpdateCustomLabelMessage
  | UpdateNoteTextMessage
  | UpdateWindowTitleMessage
