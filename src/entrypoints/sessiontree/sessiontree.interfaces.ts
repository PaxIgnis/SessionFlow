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

export interface Tab {
  active?: boolean
  id: number
  savedTime?: number
  selected: boolean
  serialId: number
  state: State
  title: string
  url: string
  collapsed?: boolean
  loadingStatus?: LoadingStatus
}

export enum LoadingStatus {
  LOADING = 'loading',
  COMPLETE = 'complete',
}
