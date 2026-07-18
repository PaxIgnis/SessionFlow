export interface Window {
  type: TreeItemType.WINDOW
  uid: UID
  active?: boolean
  activeTabId?: number
  savedActiveTabUid?: UID
  id: number
  incognito: boolean
  savedTime?: number
  selected: boolean
  state: State
  collapsed?: boolean
  windowPosition?: WindowPosition
  children: Array<WindowChild>
  indentLevel: number
  title?: string
  isParent?: boolean
  parentUid?: UID
  isVisible?: boolean
}

export interface Tab {
  type: TreeItemType.TAB
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
  pinned: boolean
  isParent?: boolean
  parentUid?: UID
  isVisible?: boolean
  customLabel?: string
  tabGroup?: TabGroupMetadata
  container?: ContainerMetadata
}

export interface ContainerMetadata {
  cookieStoreId: string
  name: string
  color: string
  colorCode: string
  icon: string
  iconUrl?: string
}

export type TabGroupColor =
  | 'blue'
  | 'cyan'
  | 'grey'
  | 'green'
  | 'orange'
  | 'pink'
  | 'purple'
  | 'red'
  | 'yellow'

export interface TabGroupMetadata {
  /** Stable Session Flow identity. Firefox group IDs can change on restore. */
  uid: UID
  /** Current Firefox group ID, or -1 while this tab is saved. */
  id: number
  title?: string
  color: TabGroupColor
  collapsed: boolean
}

export interface Note {
  type: TreeItemType.NOTE
  uid: UID
  text: string
  selected: boolean
  windowUid?: UID
  collapsed?: boolean
  indentLevel: number
  isParent?: boolean
  parentUid?: UID
  isVisible?: boolean
}

export interface Separator {
  type: TreeItemType.SEPARATOR
  uid: UID
  selected: boolean
  windowUid?: UID
  indentLevel: number
  parentUid?: UID
  isVisible?: boolean
  isParent?: false
  collapsed?: false
}

export type TreeItem = Window | Tab | Note | Separator
export type TopLevelTreeItem = Window | Note | Separator
export type WindowChild = Tab | Note | Separator

export const enum TreeItemType {
  WINDOW = 0,
  TAB = 1,
  NOTE = 2,
  SEPARATOR = 3,
}

export interface VisibleWindow {
  window: Window
  visibleChildren: WindowChild[]
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
  NOTE = 2,
  SEPARATOR = 3,
}

export interface SelectedItem {
  item: TreeItem
  type: SelectionType
}

export const enum DragType {
  TAB = 0,
  WINDOW = 1,
  NOTE = 2,
  SEPARATOR = 3,
}

export const enum DropType {
  TAB = 0,
  WINDOW = 1,
  OTHER = 2,
  NOTE = 3,
  SEPARATOR = 4,
  TREE_END = 5,
}

export const enum DropPosition {
  NONE = -1,
  ABOVE = 0,
  MID = 1,
  BELOW = 2,
}

export interface DragInfo {
  dragType: DragType
  items: TreeItem[]
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
