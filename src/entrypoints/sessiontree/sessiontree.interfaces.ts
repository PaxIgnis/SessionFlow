export interface Window {
  id: number
  state: State
  tabs: Array<{
    id: number
    state: State
    title: string
    url: string
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
