import { SessionTreeMessage } from '@/types/messages'
import {
  Note,
  Separator,
  Tab,
  TopLevelTreeItem,
  Window,
} from '@/types/session-tree'

export const SESSION_TREE_PORT_NAME = 'sessiontree-rpc'

export interface SessionTreePortSubscribeRequest {
  type: 'subscribe'
  requestId: string
}

export interface SessionTreePortCommandRequest {
  type: 'command'
  requestId: string
  command: SessionTreeMessage
}

export type SessionTreePortRequest =
  | SessionTreePortSubscribeRequest
  | SessionTreePortCommandRequest

export interface SessionTreePortResponse {
  type: 'response'
  requestId: string
  ok: boolean
  version: number
  treeItems?: TopLevelTreeItem[]
  error?: string
}

export type SessionTreeDelta =
  | { op: 'treeReplaced'; treeItems: TopLevelTreeItem[] }
  | { op: 'windowCreated'; window: Window; index: number }
  | { op: 'windowRemoved'; windowUid: UID }
  | { op: 'windowUpdated'; window: Window }
  | { op: 'tabCreated'; windowUid: UID; tab: Tab; index: number }
  | { op: 'tabRemoved'; windowUid: UID; tabUid: UID }
  | { op: 'tabUpdated'; tab: Tab }
  | { op: 'noteCreated'; parentUid?: UID; note: Note; index: number }
  | { op: 'noteRemoved'; noteUid: UID }
  | { op: 'noteUpdated'; note: Note }
  | {
      op: 'separatorCreated'
      parentUid?: UID
      separator: Separator
      index: number
    }
  | { op: 'separatorRemoved'; separatorUid: UID }
  | { op: 'separatorUpdated'; separator: Separator }

export interface SessionTreePortDeltaMessage {
  type: 'delta'
  version: number
  delta: SessionTreeDelta
}

export type SessionTreePortMessage =
  | SessionTreePortResponse
  | SessionTreePortDeltaMessage
