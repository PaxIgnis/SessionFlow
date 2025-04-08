export interface Window {
  id: number
  serialId: number
  state: State
  collapsed?: boolean
  windowPosition?: WindowPosition
  tabs: Array<{
    id: number
    serialId: number
    state: State
    title: string
    url: string
    collapsed?: boolean
  }>
}

export enum State {
  SAVED = 0,
  OPEN = 1,
  OTHER = 2,
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
