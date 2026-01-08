export interface Window {
  uid: UID
  active?: boolean
  activeTabId?: number
  id: number
  savedTime?: number
  selected: boolean
  state: State
  collapsed?: boolean
  windowPosition?: WindowPosition
  tabs: Array<Tab>
  indentLevel: number
  title?: string
}

export interface Tab {
  uid: UID
  active?: boolean
  id: number
  savedTime?: number
  selected: boolean
  state: State
  title: string
  url: string
  windowUid: UID
  collapsed?: boolean
  loadingStatus?: LoadingStatus
  indentLevel: number
  isParent?: boolean
  parentUid?: UID
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

export const enum DragType {
  TAB = 0,
  WINDOW = 1,
}

export const enum DropType {
  TAB = 0,
  WINDOW = 1,
  OTHER = 2,
}

export const enum DropPosition {
  NONE = -1,
  ABOVE = 0,
  MID = 1,
  BELOW = 2,
}

export interface DragInfo {
  dragType: DragType
  items: Array<Tab | Window>
}

export interface DragState {
  dragEventStarted: boolean
  sourceType: DragType | null
  destinationId: UID | number | null
  destinationType: DropType | null
  isValidDropTarget: boolean
  prevEl: HTMLElement | null
  dropPosition: DropPosition | DropPosition.NONE
}
