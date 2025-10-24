export interface Message {
  action: string
  [key: string]: unknown
}

export interface SaveTabMessage {
  action: 'saveTab'
  tabId: number
  tabSerialId: number
  windowSerialId: number
}

export interface CloseTabMessage {
  action: 'closeTab'
  tabId: number
  tabSerialId: number
  windowSerialId: number
}

export interface OpenTabMessage {
  action: 'openTab'
  tabSerialId: number
  windowSerialId: number
  url?: string | undefined
  discarded?: boolean | undefined
}

export interface CloseWindowMessage {
  action: 'closeWindow'
  windowId: number
  windowSerialId: number
}

export interface SaveAndRemoveWindowMessage {
  action: 'saveWindow'
  windowId: number
  windowSerialId: number
}

export interface OpenWindowMessage {
  action: 'openWindow'
  windowSerialId: number
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
  tabSerialId: number
  windowSerialId: number
}

export interface OpenWindowsInSameLocationUpdatedMessage {
  action: 'openWindowsInSameLocationUpdated'
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
