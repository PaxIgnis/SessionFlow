import { SessionTreeMessage } from '@/types/messages'
import { Tab, Window } from '@/types/session-tree'

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
  windows?: Window[]
  error?: string
}

export type SessionTreeDelta =
  | { op: 'treeReplaced'; windows: Window[] }
  | { op: 'windowCreated'; window: Window; index: number }
  | { op: 'windowRemoved'; windowUid: UID }
  | { op: 'windowUpdated'; window: Window }
  | { op: 'tabCreated'; windowUid: UID; tab: Tab; index: number }
  | { op: 'tabRemoved'; windowUid: UID; tabUid: UID }
  | { op: 'tabUpdated'; tab: Tab }

export interface SessionTreePortDeltaMessage {
  type: 'delta'
  version: number
  delta: SessionTreeDelta
}

export type SessionTreePortMessage =
  | SessionTreePortResponse
  | SessionTreePortDeltaMessage
