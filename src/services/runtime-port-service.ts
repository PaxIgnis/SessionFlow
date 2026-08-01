import { Tree } from '@/services/background-tree'
import * as Messages from '@/types/messages'
import {
  SESSION_TREE_PORT_NAME,
  SessionTreeCommandResult,
  SessionTreeDelta,
  SessionTreePortMessage,
  SessionTreePortRequest,
  SessionTreePortResponse,
} from '@/types/runtime-port-service'
import { TopLevelTreeItem, TreeItemType } from '@/types/session-tree'

type DispatchCommand = (
  message: Messages.SessionTreeMessage,
) => void | SessionTreeCommandResult | Promise<void | SessionTreeCommandResult>

type SnapshotGetter = () => TopLevelTreeItem[]

interface TreeUpdateSubscription {
  replaceTree: (items: TopLevelTreeItem[]) => void
  applyDelta: (delta: SessionTreeDelta) => boolean
  onError?: (error: Error) => void
}

interface VersionedDelta {
  type: 'delta'
  version: number
  delta: SessionTreeDelta
}

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
const treeUpdateSubscriptions = new Set<TreeUpdateSubscription>()
let subscriptionInFlight = false
let subscriptionAttempt = 0
let lastTreeVersion: number | undefined
let bufferedDeltas: VersionedDelta[] = []
let reconnectTimer: ReturnType<typeof setTimeout> | undefined

const RECONNECT_DELAY_MS = 100

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
  payload?: {
    treeItems?: TopLevelTreeItem[]
    error?: string
    result?: SessionTreeCommandResult
  },
): void {
  const response: SessionTreePortResponse = {
    type: 'response',
    requestId,
    ok,
    version: treeVersion,
    treeItems: payload?.treeItems,
    error: payload?.error,
    result: payload?.result,
  }
  port.postMessage(response as SessionTreePortMessage)
}

function createRequestId(): string {
  requestCounter += 1
  return `req-${Date.now()}-${requestCounter}`
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function isVersion(value: unknown): value is number {
  return Number.isInteger(value) && (value as number) >= 0
}

function isTreeItemLike(value: unknown, expectedType?: TreeItemType): boolean {
  return (
    isRecord(value) &&
    typeof value.uid === 'string' &&
    Number.isInteger(value.type) &&
    (expectedType === undefined || value.type === expectedType)
  )
}

function hasCommonTreeItemFields(
  value: unknown,
  expectedType: TreeItemType,
): value is Record<string, unknown> {
  return (
    isTreeItemLike(value, expectedType) &&
    isRecord(value) &&
    typeof value.selected === 'boolean' &&
    Number.isInteger(value.indentLevel)
  )
}

function isTabLike(value: unknown): boolean {
  return (
    hasCommonTreeItemFields(value, TreeItemType.TAB) &&
    typeof value.id === 'number' &&
    Number.isInteger(value.state) &&
    typeof value.title === 'string' &&
    typeof value.url === 'string' &&
    typeof value.windowUid === 'string' &&
    typeof value.pinned === 'boolean'
  )
}

function isNoteLike(value: unknown): boolean {
  return (
    hasCommonTreeItemFields(value, TreeItemType.NOTE) &&
    typeof value.text === 'string'
  )
}

function isSeparatorLike(value: unknown): boolean {
  return hasCommonTreeItemFields(value, TreeItemType.SEPARATOR)
}

function isWindowLike(value: unknown): boolean {
  if (
    !hasCommonTreeItemFields(value, TreeItemType.WINDOW) ||
    typeof value.id !== 'number' ||
    typeof value.incognito !== 'boolean' ||
    !Number.isInteger(value.state) ||
    !Array.isArray(value.children)
  ) {
    return false
  }
  const childUids = new Set<string>()
  return value.children.every((child) => {
    if (!isRecord(child) || typeof child.uid !== 'string') return false
    if (childUids.has(child.uid)) return false
    childUids.add(child.uid)
    return isTabLike(child) || isNoteLike(child) || isSeparatorLike(child)
  })
}

function isTreeSnapshot(value: unknown): value is TopLevelTreeItem[] {
  if (!Array.isArray(value)) return false
  const seenUids = new Set<string>()

  for (const item of value) {
    if (!isWindowLike(item) && !isNoteLike(item) && !isSeparatorLike(item)) {
      return false
    }
    const typedItem = item as Record<string, unknown>
    if (seenUids.has(typedItem.uid as string)) return false
    seenUids.add(typedItem.uid as string)

    if (typedItem.type === TreeItemType.WINDOW) {
      for (const child of typedItem.children as Array<
        Record<string, unknown>
      >) {
        if (seenUids.has(child.uid as string)) return false
        seenUids.add(child.uid as string)
      }
    }
  }
  return true
}

function isSessionTreeDelta(value: unknown): value is SessionTreeDelta {
  if (!isRecord(value) || typeof value.op !== 'string') return false

  switch (value.op) {
    case 'treeReplaced':
      return isTreeSnapshot(value.treeItems)
    case 'windowCreated':
      return isWindowLike(value.window) && Number.isInteger(value.index)
    case 'windowRemoved':
      return typeof value.windowUid === 'string'
    case 'windowUpdated':
      return isWindowLike(value.window)
    case 'tabCreated':
      return (
        typeof value.windowUid === 'string' &&
        isTabLike(value.tab) &&
        Number.isInteger(value.index)
      )
    case 'tabRemoved':
      return (
        typeof value.windowUid === 'string' && typeof value.tabUid === 'string'
      )
    case 'tabUpdated':
      return isTabLike(value.tab)
    case 'noteCreated':
      return isNoteLike(value.note) && Number.isInteger(value.index)
    case 'noteRemoved':
      return typeof value.noteUid === 'string'
    case 'noteUpdated':
      return isNoteLike(value.note)
    case 'separatorCreated':
      return isSeparatorLike(value.separator) && Number.isInteger(value.index)
    case 'separatorRemoved':
      return typeof value.separatorUid === 'string'
    case 'separatorUpdated':
      return isSeparatorLike(value.separator)
    default:
      return false
  }
}

function isPortResponse(value: unknown): value is SessionTreePortResponse {
  if (!isRecord(value)) return false
  return (
    value.type === 'response' &&
    typeof value.requestId === 'string' &&
    typeof value.ok === 'boolean' &&
    isVersion(value.version) &&
    (value.treeItems === undefined || isTreeSnapshot(value.treeItems)) &&
    (value.error === undefined || typeof value.error === 'string')
  )
}

function isDeltaMessage(value: unknown): value is VersionedDelta {
  return (
    isRecord(value) &&
    value.type === 'delta' &&
    isVersion(value.version) &&
    isSessionTreeDelta(value.delta)
  )
}

function hasString(value: Record<string, unknown>, key: string): boolean {
  return typeof value[key] === 'string'
}

function hasNumber(value: Record<string, unknown>, key: string): boolean {
  return typeof value[key] === 'number' && Number.isFinite(value[key])
}

function hasInteger(value: Record<string, unknown>, key: string): boolean {
  return Number.isInteger(value[key])
}

function hasBoolean(value: Record<string, unknown>, key: string): boolean {
  return typeof value[key] === 'boolean'
}

function hasStringArray(value: Record<string, unknown>, key: string): boolean {
  return (
    Array.isArray(value[key]) &&
    value[key].every((item) => typeof item === 'string')
  )
}

function hasNonNegativeIntegerArray(
  value: Record<string, unknown>,
  key: string,
): boolean {
  return (
    Array.isArray(value[key]) &&
    value[key].every(
      (item) => Number.isSafeInteger(item) && (item as number) >= 0,
    )
  )
}

function optional(
  value: Record<string, unknown>,
  key: string,
  predicate: (candidate: unknown) => boolean,
): boolean {
  return value[key] === undefined || predicate(value[key])
}

function isSessionTreeCommand(
  value: unknown,
): value is Messages.SessionTreeMessage {
  if (!isRecord(value) || typeof value.action !== 'string') return false

  switch (value.action) {
    case 'closeTab':
      return hasNumber(value, 'tabId') && hasString(value, 'tabUid')
    case 'closeWindow':
    case 'saveWindow':
      return hasNumber(value, 'windowId') && hasString(value, 'windowUid')
    case 'focusTab':
      return hasNumber(value, 'tabId') && hasNumber(value, 'windowId')
    case 'focusWindow':
    case 'registerSessionTreeWindow':
      return hasNumber(value, 'windowId')
    case 'openTab':
      return (
        hasString(value, 'tabUid') &&
        hasString(value, 'windowUid') &&
        optional(value, 'url', (item) => typeof item === 'string') &&
        optional(value, 'discarded', (item) => typeof item === 'boolean') &&
        optional(value, 'active', (item) => typeof item === 'boolean') &&
        optional(
          value,
          'deferGroupRestore',
          (item) => typeof item === 'boolean',
        ) &&
        optional(
          value,
          'containerRecovery',
          (item) => item === 'recreate' || item === 'without-container',
        ) &&
        optional(
          value,
          'containerRecoveryStoreIds',
          (item) =>
            Array.isArray(item) && item.every((id) => typeof id === 'string'),
        )
      )
    case 'openWindow':
      return (
        hasString(value, 'windowUid') &&
        optional(
          value,
          'containerRecovery',
          (item) => item === 'recreate' || item === 'without-container',
        ) &&
        optional(
          value,
          'containerRecoveryStoreIds',
          (item) =>
            Array.isArray(item) && item.every((id) => typeof id === 'string'),
        )
      )
    case 'pinTab':
    case 'toggleCollapseTab':
    case 'unpinTab':
      return hasString(value, 'tabUid')
    case 'reloadTab':
      return hasNumber(value, 'tabId')
    case 'saveTab':
      return hasNumber(value, 'tabId') && hasString(value, 'tabUid')
    case 'moveWindows':
      return (
        hasStringArray(value, 'windowUIDs') &&
        hasInteger(value, 'targetIndex') &&
        hasBoolean(value, 'copy')
      )
    case 'moveTreeItems':
      return (
        hasStringArray(value, 'itemUIDs') &&
        hasInteger(value, 'targetIndex') &&
        hasBoolean(value, 'copy') &&
        optional(value, 'parentUid', (item) => typeof item === 'string') &&
        optional(
          value,
          'targetWindowUid',
          (item) => typeof item === 'string',
        ) &&
        optional(
          value,
          'includeDescendants',
          (item) => typeof item === 'boolean',
        )
      )
    case 'moveFirefoxNativeTabs':
      return (
        hasNonNegativeIntegerArray(value, 'firefoxTabIds') &&
        hasInteger(value, 'targetIndex') &&
        optional(value, 'parentUid', (item) => typeof item === 'string') &&
        hasString(value, 'targetWindowUid')
      )
    case 'importExternalUrls':
      return (
        Array.isArray(value.items) &&
        value.items.every(
          (item) =>
            isRecord(item) &&
            typeof item.url === 'string' &&
            (item.title === undefined || typeof item.title === 'string'),
        ) &&
        hasInteger(value, 'targetIndex') &&
        optional(value, 'parentUid', (item) => typeof item === 'string') &&
        optional(value, 'targetWindowUid', (item) => typeof item === 'string')
      )
    case 'duplicateTreeItems':
    case 'treeItemIndentDecrease':
    case 'treeItemIndentIncrease':
      return hasStringArray(value, 'itemUIDs')
    case 'createNote':
      return (
        optional(value, 'parentUid', (item) => typeof item === 'string') &&
        optional(value, 'index', Number.isInteger) &&
        optional(value, 'text', (item) => typeof item === 'string')
      )
    case 'createSeparator':
      return (
        optional(value, 'parentUid', (item) => typeof item === 'string') &&
        optional(value, 'index', Number.isInteger)
      )
    case 'createSeparatorBelow':
    case 'removeSeparator':
      return hasString(value, 'separatorUid')
    case 'removeNote':
    case 'toggleCollapseNote':
      return hasString(value, 'noteUid')
    case 'toggleCollapseWindow':
      return hasString(value, 'windowUid')
    case 'updateCustomLabel':
      return (
        hasString(value, 'uid') &&
        optional(value, 'customLabel', (item) => typeof item === 'string')
      )
    case 'updateNoteText':
      return hasString(value, 'noteUid') && hasString(value, 'text')
    case 'updateWindowTitle':
      return hasString(value, 'windowUid') && hasString(value, 'newTitle')
    case 'deselectAllItems':
    case 'openWindowsInSameLocationUpdated':
    case 'printSessionTree':
      return true
    default:
      return false
  }
}

function isPortRequest(value: unknown): value is SessionTreePortRequest {
  if (
    !isRecord(value) ||
    typeof value.requestId !== 'string' ||
    typeof value.type !== 'string'
  ) {
    return false
  }
  if (value.type === 'subscribe') return true
  return value.type === 'command' && isSessionTreeCommand(value.command)
}

function notifySubscriptionError(error: Error): void {
  treeUpdateSubscriptions.forEach((subscription) => {
    subscription.onError?.(error)
  })
}

function scheduleReconnect(): void {
  if (treeUpdateSubscriptions.size === 0 || reconnectTimer) return
  reconnectTimer = setTimeout(() => {
    reconnectTimer = undefined
    if (treeUpdateSubscriptions.size === 0) return
    void requestTreeSnapshot()
  }, RECONNECT_DELAY_MS)
}

function requestResynchronization(error: Error): void {
  notifySubscriptionError(error)
  if (treeUpdateSubscriptions.size === 0 || subscriptionInFlight) return
  queueMicrotask(() => {
    if (treeUpdateSubscriptions.size > 0 && !subscriptionInFlight) {
      void requestTreeSnapshot()
    }
  })
}

function applyVersionedDelta(message: VersionedDelta): boolean {
  if (lastTreeVersion === undefined) {
    bufferedDeltas.push(message)
    return true
  }
  if (message.version <= lastTreeVersion) return true
  if (message.version !== lastTreeVersion + 1) return false

  for (const subscription of treeUpdateSubscriptions) {
    if (!subscription.applyDelta(structuredClone(message.delta))) return false
  }
  lastTreeVersion = message.version
  deltaListeners.forEach((listener) => listener(message.delta))
  return true
}

function drainBufferedDeltas(): boolean {
  const nextDeltas = bufferedDeltas.filter(
    (message) => message.version > (lastTreeVersion ?? -1),
  )
  bufferedDeltas = []

  for (const message of nextDeltas) {
    if (message.version === lastTreeVersion) continue
    if (!applyVersionedDelta(message)) return false
  }
  return true
}

async function requestTreeSnapshot(): Promise<void> {
  if (treeUpdateSubscriptions.size === 0 || subscriptionInFlight) return
  subscriptionInFlight = true
  const attempt = ++subscriptionAttempt
  bufferedDeltas = []

  try {
    const response = await sendRequest({
      type: 'subscribe',
      requestId: createRequestId(),
    })
    if (attempt !== subscriptionAttempt || treeUpdateSubscriptions.size === 0)
      return
    if (!response.ok) {
      throw new Error(response.error || 'Failed to subscribe to session tree')
    }
    if (!Array.isArray(response.treeItems)) {
      throw new Error('Malformed session tree snapshot response')
    }

    treeUpdateSubscriptions.forEach((subscription) => {
      subscription.replaceTree(structuredClone(response.treeItems!))
    })
    lastTreeVersion = response.version
    subscriptionInFlight = false
    if (!drainBufferedDeltas()) {
      requestResynchronization(
        new Error('Session tree delta sequence requires resynchronization'),
      )
    }
  } catch (error) {
    if (attempt !== subscriptionAttempt) return
    subscriptionInFlight = false
    notifySubscriptionError(
      error instanceof Error ? error : new Error(String(error)),
    )
    scheduleReconnect()
  }
}

function handleClientMessage(message: unknown): void {
  if (isPortResponse(message)) {
    const pending = pendingRequests.get(message.requestId)
    if (!pending) return
    pendingRequests.delete(message.requestId)
    pending.resolve(message)
    return
  }

  if (isRecord(message) && message.type === 'response') {
    if (typeof message.requestId !== 'string') return
    const pending = pendingRequests.get(message.requestId)
    if (!pending) return
    pendingRequests.delete(message.requestId)
    pending.reject(new Error('Malformed session tree response'))
    return
  }

  if (isDeltaMessage(message)) {
    if (treeUpdateSubscriptions.size === 0) {
      deltaListeners.forEach((listener) => listener(message.delta))
      return
    }
    if (subscriptionInFlight || lastTreeVersion === undefined) {
      bufferedDeltas.push(message)
      return
    }
    if (!applyVersionedDelta(message)) {
      bufferedDeltas.push(message)
      requestResynchronization(
        new Error('Session tree delta sequence requires resynchronization'),
      )
    }
    return
  }

  if (isRecord(message) && message.type === 'delta') {
    requestResynchronization(new Error('Malformed session tree delta'))
  }
}

function connectClientPort(): browser.runtime.Port {
  if (clientPort) {
    return clientPort
  }

  clientPort = browser.runtime.connect({ name: SESSION_TREE_PORT_NAME })

  const connectedPort = clientPort
  clientPort.onMessage.addListener(handleClientMessage)

  clientPort.onDisconnect.addListener(() => {
    if (clientPort !== connectedPort) return
    clientPort = undefined
    subscriptionInFlight = false
    lastTreeVersion = undefined
    bufferedDeltas = []
    pendingRequests.forEach(({ reject }) => {
      reject(new Error('Session tree port disconnected'))
    })
    pendingRequests.clear()
    scheduleReconnect()
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
    void handlePortMessage(port, message)
  })
}

/**
 * Handles a runtime port request from the foreground session tree.
 * Awaits command dispatch so command responses reflect async mutation completion.
 *
 * @param {browser.runtime.Port} port - Runtime port that sent the request.
 * @param {object} message - Raw port message to handle.
 */
async function handlePortMessage(
  port: browser.runtime.Port,
  message: object,
): Promise<void> {
  if (!isPortRequest(message)) return
  const typedMessage = message
  if (typedMessage.type === 'subscribe') {
    void handleSubscribe(port, typedMessage.requestId)
    return
  }

  if (typedMessage.type === 'command') {
    try {
      if (!dispatchCommandHandler) {
        throw new Error('Session tree command dispatcher is not initialized')
      }
      const result = await dispatchCommandHandler(typedMessage.command)
      sendResponse(
        port,
        typedMessage.requestId,
        true,
        result ? { result } : undefined,
      )
    } catch (error) {
      sendResponse(port, typedMessage.requestId, false, {
        error: String(error),
      })
    }
  }
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
): Promise<SessionTreeCommandResult | undefined> {
  const response = await sendRequest({
    type: 'command',
    requestId: createRequestId(),
    command: message,
  })
  if (!response.ok) {
    throw new Error(response.error || 'Session tree command failed')
  }
  return response.result
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

export function subscribeTreeUpdates(
  subscription: TreeUpdateSubscription,
): () => void {
  treeUpdateSubscriptions.add(subscription)
  if (treeUpdateSubscriptions.size === 1) {
    void requestTreeSnapshot()
  } else if (lastTreeVersion !== undefined) {
    requestResynchronization(
      new Error('A new tree subscriber requires a current snapshot'),
    )
  }

  return () => {
    treeUpdateSubscriptions.delete(subscription)
    if (treeUpdateSubscriptions.size > 0) return

    subscriptionAttempt += 1
    subscriptionInFlight = false
    lastTreeVersion = undefined
    bufferedDeltas = []
    if (reconnectTimer) {
      clearTimeout(reconnectTimer)
      reconnectTimer = undefined
    }
    if (clientPort) {
      const port = clientPort
      port.disconnect()
      clientPort = undefined
    }
  }
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
  treeUpdateSubscriptions.clear()
  subscriptionAttempt += 1
  subscriptionInFlight = false
  lastTreeVersion = undefined
  bufferedDeltas = []
  if (reconnectTimer) {
    clearTimeout(reconnectTimer)
    reconnectTimer = undefined
  }
  if (!clientPort) return
  try {
    clientPort.disconnect()
  } finally {
    clientPort = undefined
    deltaListeners.clear()
    pendingRequests.clear()
  }
}
