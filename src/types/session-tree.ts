export interface Window {
  active?: boolean
  activeTabId?: number
  id: number
  savedTime?: number
  selected: boolean
  serialId: number
  state: State
  collapsed?: boolean
  windowPosition?: WindowPosition
  tabs: Array<Tab>
  indentLevel: number
}

export interface Tab {
  active?: boolean
  id: number
  savedTime?: number
  selected: boolean
  serialId: number
  state: State
  title: string
  url: string
  windowSerialId: number
  collapsed?: boolean
  loadingStatus?: LoadingStatus
  indentLevel: number
  isParent?: boolean
  parentId?: number
  isVisible?: boolean
}

export interface VisibleWindow {
  window: Window
  visibleTabs: Tab[]
}

export enum State {
  SAVED = 0,
  OPEN = 1,
  DISCARDED = 2,
  OTHER = 3,
}

export interface PendingItem {
  id: number
  complete: boolean
  creatorResolved: boolean
  listenerResolved: boolean
}

export interface WindowPosition {
  left: number
  top: number
  width: number
  height: number
}

export enum LoadingStatus {
  LOADING = 'loading',
  COMPLETE = 'complete',
}

export const enum SelectionType {
  WINDOW = 0,
  TAB = 1,
}

export interface SelectedItem {
  item: Window | Tab
  type: SelectionType
}
