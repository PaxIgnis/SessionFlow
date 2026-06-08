import { Tree } from '@/services/background-tree'
import * as Messages from '@/types/messages'
import {
  SESSION_TREE_PORT_NAME,
  SessionTreeDelta,
  SessionTreePortMessage,
  SessionTreePortRequest,
  SessionTreePortResponse,
} from '@/types/runtime-port-service'
import { TopLevelTreeItem } from '@/types/session-tree'

type DispatchCommand = (message: Messages.SessionTreeMessage) => void

type SnapshotGetter = () => TopLevelTreeItem[]

const sessionTreePorts = new Set<browser.runtime.Port>()
let treeVersion = 0
let dispatchCommandHandler: DispatchCommand | undefined
let getSnapshotHandler: SnapshotGetter | undefined
let initialized = false

let clientPort: browser.runtime.Port | undefined
let requestCounter = 0
const pendingRequests = new Map<
  string,
  {
    resolve: (value: SessionTreePortResponse) => void
    reject: (reason?: unknown) => void
  }
>()
const deltaListeners = new Set<(delta: SessionTreeDelta) => void>()

function nextTreeVersion(): number {
  treeVersion += 1
  return treeVersion
}

function getTreeSnapshot(): TopLevelTreeItem[] {
  if (!getSnapshotHandler) {
    return []
  }
  return structuredClone(getSnapshotHandler())
}

function sendResponse(
  port: browser.runtime.Port,
  requestId: string,
  ok: boolean,
  payload?: { treeItems?: TopLevelTreeItem[]; error?: string },
): void {
  const response: SessionTreePortResponse = {
    type: 'response',
    requestId,
    ok,
    version: treeVersion,
    treeItems: payload?.treeItems,
    error: payload?.error,
  }
  port.postMessage(response as SessionTreePortMessage)
}

function createRequestId(): string {
  requestCounter += 1
  return `req-${Date.now()}-${requestCounter}`
}

function connectClientPort(): browser.runtime.Port {
  if (clientPort) {
    return clientPort
  }

  clientPort = browser.runtime.connect({ name: SESSION_TREE_PORT_NAME })

  clientPort.onMessage.addListener((message: object) => {
    const typed = message as SessionTreePortMessage
    if (typed.type === 'response') {
      const pending = pendingRequests.get(typed.requestId)
      if (!pending) return
      pendingRequests.delete(typed.requestId)
      pending.resolve(typed)
      return
    }
    if (typed.type === 'delta') {
      deltaListeners.forEach((listener) => listener(typed.delta))
    }
  })

  clientPort.onDisconnect.addListener(() => {
    clientPort = undefined
    pendingRequests.forEach(({ reject }) => {
      reject(new Error('Session tree port disconnected'))
    })
    pendingRequests.clear()
  })

  return clientPort
}

async function sendRequest(
  request: SessionTreePortRequest,
): Promise<SessionTreePortResponse> {
  const activePort = connectClientPort()
  return new Promise<SessionTreePortResponse>((resolve, reject) => {
    pendingRequests.set(request.requestId, { resolve, reject })
    activePort.postMessage(request)
  })
}

function onConnect(port: browser.runtime.Port): void {
  if (port.name !== SESSION_TREE_PORT_NAME) {
    return
  }

  sessionTreePorts.add(port)

  port.onDisconnect.addListener(() => {
    sessionTreePorts.delete(port)
  })

  port.onMessage.addListener((message: object) => {
    const typedMessage = message as SessionTreePortRequest
    if (typedMessage.type === 'subscribe') {
      void handleSubscribe(port, typedMessage.requestId)
      return
    }

    if (typedMessage.type === 'command') {
      try {
        if (!dispatchCommandHandler) {
          throw new Error('Session tree command dispatcher is not initialized')
        }
        dispatchCommandHandler(typedMessage.command)
        sendResponse(port, typedMessage.requestId, true)
      } catch (error) {
        sendResponse(port, typedMessage.requestId, false, {
          error: String(error),
        })
      }
    }
  })
}

async function handleSubscribe(
  port: browser.runtime.Port,
  requestId: string,
): Promise<void> {
  const timeoutMs = 10000 // 10 second timeout
  const startTime = Date.now()

  while (!Tree.initialized && Date.now() - startTime < timeoutMs) {
    await new Promise((resolve) => setTimeout(resolve, 100))
  }

  console.log('Handling subscribe request, tree initialized:', Tree.initialized)
  if (!Tree.initialized) {
    sendResponse(port, requestId, false, {
      error: 'Tree initialization timeout',
    })
    return
  }

  sendResponse(port, requestId, true, {
    treeItems: getTreeSnapshot(),
  })
}

export function initializeSessionTreePort(options: {
  dispatchCommand: DispatchCommand
  getSnapshot: SnapshotGetter
}): void {
  dispatchCommandHandler = options.dispatchCommand
  getSnapshotHandler = options.getSnapshot

  if (initialized) {
    return
  }
  initialized = true
  browser.runtime.onConnect.addListener(onConnect)
}

export function emitTreeDelta(delta: SessionTreeDelta): void {
  const message: SessionTreePortMessage = {
    type: 'delta',
    version: nextTreeVersion(),
    delta,
  }
  sessionTreePorts.forEach((port) => {
    try {
      port.postMessage(message)
    } catch {
      sessionTreePorts.delete(port)
    }
  })
}

export function emitTreeReplaced(): void {
  emitTreeDelta({
    op: 'treeReplaced',
    treeItems: getTreeSnapshot(),
  })
}

export async function sendTreeCommand(
  message: Messages.SessionTreeMessage,
): Promise<void> {
  const response = await sendRequest({
    type: 'command',
    requestId: createRequestId(),
    command: message,
  })
  if (!response.ok) {
    throw new Error(response.error || 'Session tree command failed')
  }
}

export async function subscribeTreePort(): Promise<TopLevelTreeItem[]> {
  const response = await sendRequest({
    type: 'subscribe',
    requestId: createRequestId(),
  })
  if (!response.ok) {
    throw new Error(response.error || 'Failed to subscribe to session tree')
  }
  return response.treeItems || []
}

export function onTreeDeltaPort(
  listener: (delta: SessionTreeDelta) => void,
): () => void {
  connectClientPort()
  deltaListeners.add(listener)
  return () => {
    deltaListeners.delete(listener)
  }
}

export function disconnectTreePort(): void {
  if (!clientPort) return
  try {
    clientPort.disconnect()
  } finally {
    clientPort = undefined
    deltaListeners.clear()
    pendingRequests.clear()
  }
}
