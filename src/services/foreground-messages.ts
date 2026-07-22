import { sendTreeCommand } from '@/services/runtime-port-service'
import { missingContainers } from '@/services/foreground-container-actions'
import {
  closeModal,
  type ContainerRecoveryTarget,
  ModalState,
  openContainerRecoveryModal,
} from '@/services/modal-state'
import {
  showNotification,
  showPrivateWindowAccessRequired,
} from '@/services/notification-state'
import { SessionTree } from '@/services/foreground-tree'
import { Settings } from '@/services/settings'
import { isPrivateWindowAccessAllowed } from '@/services/utils'
import * as Messages from '@/types/messages'
import type { SessionTreeCommandResult } from '@/types/runtime-port-service'
import { State, Tab, TreeItemType, Window } from '@/types/session-tree'

function warningMessage(result: SessionTreeCommandResult | undefined): string {
  return result?.warnings?.map((warning) => warning.message).join(' ') ?? ''
}

async function sendActionCommand(
  message: Messages.SessionTreeMessage,
  failureMessage: string,
): Promise<void> {
  try {
    const result = await sendTreeCommand(message)
    const warning = warningMessage(result)
    if (warning) showNotification(warning)
  } catch (error) {
    showNotification(`${failureMessage}: ${error}`)
  }
}

async function sendBulkCommands(
  messages: Messages.SessionTreeMessage[],
  failureMessage: (failedCount: number, totalCount: number) => string,
): Promise<void> {
  const results = await Promise.allSettled(
    messages.map((message) => sendTreeCommand(message)),
  )
  const failedCount = results.filter(
    (result) => result.status === 'rejected',
  ).length
  const warnings = results.flatMap((result) =>
    result.status === 'fulfilled'
      ? (result.value?.warnings?.map((warning) => warning.message) ?? [])
      : [],
  )
  const notificationParts: string[] = []
  if (failedCount > 0) {
    notificationParts.push(failureMessage(failedCount, messages.length))
  }
  if (warnings.length > 0) notificationParts.push(warnings.join(' '))
  if (notificationParts.length > 0) {
    showNotification(notificationParts.join(' '))
  }
}

// ==============================
// Tab Messages
// ==============================

export function closeTab(tabId: number, tabUid: UID): Promise<void> {
  return sendActionCommand(
    {
      action: 'closeTab',
      tabId: tabId,
      tabUid: tabUid,
    } as Messages.CloseTabMessage,
    'Session Flow could not close the tab',
  )
}

export function closeTabs(tabs: Array<Tab>): Promise<void> {
  return sendBulkCommands(
    tabs.map((tab) => ({
      action: 'closeTab',
      tabId: tab.id,
      tabUid: tab.uid,
    })),
    (failedCount, totalCount) =>
      `Session Flow could not close ${failedCount} of ${totalCount} tabs.`,
  )
}

export function focusTab(tabId: number, windowId: number) {
  void sendTreeCommand({
    action: 'focusTab',
    tabId: tabId,
    windowId: windowId,
  } as Messages.FocusTabMessage)
}

type TabRecoveryTarget = Extract<ContainerRecoveryTarget, { type: 'tab' }>

function tabRecoveryTarget(tab: Tab): TabRecoveryTarget {
  return {
    type: 'tab',
    tabUid: tab.uid,
    windowUid: tab.windowUid,
    url: tab.url,
    containerStoreId: tab.container?.cookieStoreId,
  }
}

async function sendOpenTabTarget(
  target: TabRecoveryTarget,
  recovery?: {
    strategy: Messages.ContainerRecoveryStrategy
    storeIds: string[]
  },
): Promise<void> {
  await sendTreeCommand({
    action: 'openTab',
    tabUid: target.tabUid,
    windowUid: target.windowUid,
    url: target.url,
    ...(recovery
      ? {
          containerRecovery: recovery.strategy,
          containerRecoveryStoreIds: recovery.storeIds,
        }
      : {}),
  })
}

export async function openTab(tabUid: UID, windowUid: UID, url: string) {
  const target: TabRecoveryTarget = { type: 'tab', tabUid, windowUid, url }
  const tab = SessionTree.tabsByUid.get(tabUid)
  if (tab) {
    const missing = await missingContainers([tab])
    if (missing.length > 0) {
      openContainerRecoveryModal(target, missing)
      return
    }
  }
  await sendActionCommand(
    {
      action: 'openTab',
      tabUid: target.tabUid,
      windowUid: target.windowUid,
      url: target.url,
    },
    'Session Flow could not open the tab',
  )
}

export async function openTabs(tabs: Array<Tab>): Promise<void> {
  const targets = tabs.map(tabRecoveryTarget)
  if (!tabs.some((tab) => tab.container)) {
    await sendBulkCommands(
      targets.map((target) => ({
        action: 'openTab',
        tabUid: target.tabUid,
        windowUid: target.windowUid,
        url: target.url,
      })),
      (failedCount, totalCount) =>
        `Session Flow could not open ${failedCount} of ${totalCount} tabs.`,
    )
    return
  }
  const missing = await missingContainers(tabs)
  if (missing.length > 0) {
    openContainerRecoveryModal({ type: 'tabs', tabs: targets }, missing)
    return
  }
  await sendBulkCommands(
    targets.map((target) => ({
      action: 'openTab',
      tabUid: target.tabUid,
      windowUid: target.windowUid,
      url: target.url,
    })),
    (failedCount, totalCount) =>
      `Session Flow could not open ${failedCount} of ${totalCount} tabs.`,
  )
}

export function pinTabs(tabs: Array<Tab>) {
  tabs.forEach((tab) => {
    void sendTreeCommand({
      action: 'pinTab',
      tabUid: tab.uid,
    })
  })
}

export function reloadTab(tabId: number) {
  void sendTreeCommand({
    action: 'reloadTab',
    tabId: tabId,
  })
}

export function reloadTabs(tabs: Array<Tab>) {
  tabs.forEach((tab) => {
    reloadTab(tab.id)
  })
}

export function saveTab(tabId: number, tabUid: UID): Promise<void> {
  return sendActionCommand(
    {
      action: 'saveTab',
      tabId: tabId,
      tabUid: tabUid,
    },
    'Session Flow could not save the tab',
  )
}

export function saveTabs(tabs: Array<Tab>): Promise<void> {
  return sendBulkCommands(
    tabs.map((tab) => ({
      action: 'saveTab',
      tabId: tab.id,
      tabUid: tab.uid,
    })),
    (failedCount, totalCount) =>
      `Session Flow could not save ${failedCount} of ${totalCount} tabs.`,
  )
}

export async function tabDoubleClick(
  tabId: number,
  windowId: number,
  tabUid: UID,
  windowUid: UID,
  state: State,
  url: string,
  incognito = false,
): Promise<void> {
  if (state === State.OPEN || state === State.DISCARDED) {
    const tabDoubleClickAction = Settings.values.doubleClickOnOpenTab

    if (tabDoubleClickAction === 'save') {
      saveTab(tabId, tabUid)
    }
    if (tabDoubleClickAction === 'close') {
      closeTab(tabId, tabUid)
    } else if (tabDoubleClickAction === 'reload') {
      reloadTab(tabId)
    } else if (tabDoubleClickAction === 'duplicate') {
      duplicateTreeItems([tabUid])
    } else if (tabDoubleClickAction === 'focus') {
      focusTab(tabId, windowId)
    }
  } else if (state === State.SAVED) {
    const tabDoubleClickAction = Settings.values.doubleClickOnSavedTab

    if (tabDoubleClickAction === 'open') {
      if (incognito && !(await canOpenPrivateItem('tab'))) {
        return
      }
      await openTab(tabUid, windowUid, url)
    } else if (tabDoubleClickAction === 'remove') {
      closeTab(tabId, tabUid)
    } else if (tabDoubleClickAction === 'duplicate') {
      duplicateTreeItems([tabUid])
    }
  }
}

export async function treeItemDoubleClick(item: Tab | Window): Promise<void> {
  if (item.type === TreeItemType.WINDOW) {
    await windowDoubleClick(item.uid, item.id, item.state, item.incognito)
    return
  }

  const window = SessionTree.windowsByUid.get(item.windowUid)
  if (!window) {
    console.warn(
      'Could not find parent window for tab double-click action',
      item,
    )
    return
  }

  await tabDoubleClick(
    item.id,
    window.id,
    item.uid,
    item.windowUid,
    item.state,
    item.url,
    window.incognito,
  )
}

export function toggleCollapseTab(tabUid: UID) {
  void sendTreeCommand({
    action: 'toggleCollapseTab',
    tabUid: tabUid,
  })
}

export function unpinTabs(tabs: Array<Tab>) {
  tabs
    .slice()
    .reverse()
    .forEach((tab) => {
      void sendTreeCommand({
        action: 'unpinTab',
        tabUid: tab.uid,
      })
    })
}

export function updateCustomLabel(uid: UID, customLabel?: string) {
  void sendTreeCommand({
    action: 'updateCustomLabel',
    uid: uid,
    customLabel,
  } as Messages.UpdateCustomLabelMessage).catch((error) => {
    console.error('Failed to update custom label:', error)
  })
}

// ==============================
// Window Messages
// ==============================

export function closeWindow(windowId: number, windowUid: UID): Promise<void> {
  return sendActionCommand(
    {
      action: 'closeWindow',
      windowId: windowId,
      windowUid: windowUid,
    },
    'Session Flow could not close the window',
  )
}

export function closeWindows(windows: Array<Window>): Promise<void> {
  return sendBulkCommands(
    windows.map((window) => ({
      action: 'closeWindow',
      windowId: window.id,
      windowUid: window.uid,
    })),
    (failedCount, totalCount) =>
      `Session Flow could not close ${failedCount} of ${totalCount} windows.`,
  )
}

export function saveWindow(windowId: number, windowUid: UID): Promise<void> {
  return sendActionCommand(
    {
      action: 'saveWindow',
      windowId: windowId,
      windowUid: windowUid,
    },
    'Session Flow could not save the window',
  )
}

export function saveWindows(windows: Array<Window>): Promise<void> {
  return sendBulkCommands(
    windows.map((window) => ({
      action: 'saveWindow',
      windowId: window.id,
      windowUid: window.uid,
    })),
    (failedCount, totalCount) =>
      `Session Flow could not save ${failedCount} of ${totalCount} windows.`,
  )
}

export async function windowDoubleClick(
  windowUid: UID,
  windowId: number,
  state: State,
  incognito = false,
): Promise<void> {
  console.log('Window double clicked. Window ID: ', windowId)
  if (state === State.SAVED) {
    if (incognito && !(await canOpenPrivateItem('window'))) {
      return
    }
    const window = SessionTree.windowsByUid.get(windowUid)
    if (window) {
      const missing = await missingContainers(
        window.children.filter(
          (item): item is Tab => item.type === TreeItemType.TAB,
        ),
      )
      if (missing.length > 0) {
        openContainerRecoveryModal({ type: 'window', windowUid }, missing)
        return
      }
    }
    await sendActionCommand(
      {
        action: 'openWindow',
        windowUid,
      },
      'Session Flow could not open the window',
    )
  } else if (state === State.OPEN) {
    void sendTreeCommand({
      action: 'focusWindow',
      windowId: windowId,
    })
  }
}

export async function resolveContainerRecoveryModal(
  strategy: Messages.ContainerRecoveryStrategy,
): Promise<void> {
  if (containerRecoveryRequest) return containerRecoveryRequest
  const modal = ModalState.active
  if (modal?.kind !== 'containerRecovery') return
  const target = copyContainerRecoveryTarget(modal.target)
  const shownMissingContainers = modal.missingContainers.map((container) => ({
    ...container,
  }))
  const consentedStoreIds = shownMissingContainers.map(
    (container) => container.cookieStoreId,
  )
  containerRecoveryRequest = (async () => {
    try {
      await sendContainerRecoveryTarget(target, {
        strategy,
        storeIds: consentedStoreIds,
      })
      closeModal()
    } catch (error) {
      if (String(error).includes(Messages.CONTAINER_RECOVERY_STALE_ERROR)) {
        try {
          await refreshContainerRecoveryModal(target)
        } catch (refreshError) {
          await retainRemainingBulkRecoveryTarget(target)
          showNotification(
            `Session Flow could not recover the container: ${refreshError}`,
          )
        }
      } else {
        await retainRemainingBulkRecoveryTarget(target)
        showNotification(
          `Session Flow could not recover the container: ${error}`,
        )
      }
    }
  })()
  try {
    await containerRecoveryRequest
  } finally {
    containerRecoveryRequest = undefined
  }
}

let containerRecoveryRequest: Promise<void> | undefined

function copyContainerRecoveryTarget(
  target: ContainerRecoveryTarget,
): ContainerRecoveryTarget {
  if (target.type === 'tab') return { ...target }
  if (target.type === 'tabs') {
    return { type: 'tabs', tabs: target.tabs.map((tab) => ({ ...tab })) }
  }
  return { ...target }
}

async function sendContainerRecoveryTarget(
  target: ContainerRecoveryTarget,
  recovery?: {
    strategy: Messages.ContainerRecoveryStrategy
    storeIds: string[]
  },
): Promise<void> {
  if (target.type === 'tab') {
    await sendOpenTabTarget(target, recovery)
    return
  }
  if (target.type === 'tabs') {
    while (target.tabs.length > 0) {
      const tab = target.tabs[0]
      await sendOpenTabTarget(
        tab,
        recovery
          ? {
              ...recovery,
              storeIds: tab.containerStoreId
                ? recovery.storeIds.filter(
                    (storeId) => storeId === tab.containerStoreId,
                  )
                : [],
            }
          : undefined,
      )
      target.tabs.shift()
    }
    return
  }
  await sendTreeCommand({
    action: 'openWindow',
    windowUid: target.windowUid,
    ...(recovery
      ? {
          containerRecovery: recovery.strategy,
          containerRecoveryStoreIds: recovery.storeIds,
        }
      : {}),
  })
}

async function retainRemainingBulkRecoveryTarget(
  target: ContainerRecoveryTarget,
): Promise<void> {
  if (target.type !== 'tabs' || target.tabs.length === 0) return
  const remainingMissingContainers = await missingContainers(
    recoveryTargetTabs(target),
  )
  if (remainingMissingContainers.length === 0) {
    closeModal()
    return
  }
  openContainerRecoveryModal(target, remainingMissingContainers)
}

function recoveryTargetTabs(target: ContainerRecoveryTarget): Tab[] {
  if (target.type === 'tab') {
    const tab = SessionTree.tabsByUid.get(target.tabUid)
    return tab ? [tab] : []
  }
  if (target.type === 'tabs') {
    return target.tabs.flatMap((item) => {
      const tab = SessionTree.tabsByUid.get(item.tabUid)
      return tab ? [tab] : []
    })
  }
  const window = SessionTree.windowsByUid.get(target.windowUid)
  return (
    window?.children.filter(
      (item): item is Tab => item.type === TreeItemType.TAB,
    ) ?? []
  )
}

async function refreshContainerRecoveryModal(
  target: ContainerRecoveryTarget,
): Promise<void> {
  const missing = await missingContainers(recoveryTargetTabs(target))
  if (missing.length > 0) {
    openContainerRecoveryModal(target, missing)
    return
  }
  await sendContainerRecoveryTarget(target)
  closeModal()
}

async function canOpenPrivateItem(itemType: 'tab' | 'window') {
  if (await isPrivateWindowAccessAllowed()) return true
  showPrivateWindowAccessRequired(itemType)
  return false
}

export function toggleCollapseWindow(windowUid: UID) {
  void sendTreeCommand({
    action: 'toggleCollapseWindow',
    windowUid: windowUid,
  })
}

export function moveWindows(
  windowUIDs: Array<UID>,
  targetIndex: number,
  copy: boolean = false,
): Promise<void> {
  return sendActionCommand(
    {
      action: 'moveWindows',
      windowUIDs: windowUIDs,
      targetIndex: targetIndex,
      copy: copy,
    },
    'Session Flow could not move the selected windows',
  )
}

export function moveTreeItems(
  itemUIDs: Array<UID>,
  targetIndex: number,
  parentUid?: UID,
  targetWindowUid?: UID,
  copy: boolean = false,
  includeDescendants?: boolean,
): Promise<void> {
  return sendActionCommand(
    {
      action: 'moveTreeItems',
      itemUIDs,
      targetIndex,
      parentUid,
      targetWindowUid,
      copy,
      includeDescendants,
    } as Messages.MoveTreeItemsMessage,
    'Session Flow could not move the selected items',
  )
}

export function importExternalUrls(
  items: Messages.ImportExternalUrlsMessage['items'],
  targetIndex: number,
  parentUid?: UID,
  targetWindowUid?: UID,
) {
  void sendTreeCommand({
    action: 'importExternalUrls',
    items,
    targetIndex,
    parentUid,
    targetWindowUid,
  } as Messages.ImportExternalUrlsMessage)
}

// ==============================
// Tree Messages
// ==============================
export function deselectAllItems() {
  void sendTreeCommand({
    action: 'deselectAllItems',
  })
}

export function registerSessionTreeWindow(windowId: number) {
  void sendTreeCommand({
    action: 'registerSessionTreeWindow',
    windowId,
  })
}

export function updateWindowTitle(windowUid: UID, newTitle: string) {
  void sendTreeCommand({
    action: 'updateWindowTitle',
    windowUid,
    newTitle,
  } as Messages.UpdateWindowTitleMessage)
}

export function duplicateTreeItems(itemUIDs: Array<UID>) {
  void sendTreeCommand({
    action: 'duplicateTreeItems',
    itemUIDs,
  } as Messages.DuplicateTreeItemsMessage).catch((error) => {
    showNotification(
      `Session Flow could not duplicate the selected items: ${error}`,
    )
  })
}

export function treeItemIndentIncrease(itemUIDs: Array<UID>) {
  void sendTreeCommand({
    action: 'treeItemIndentIncrease',
    itemUIDs,
  } as Messages.TreeItemIndentIncreaseMessage)
}

export function treeItemIndentDecrease(itemUIDs: Array<UID>) {
  void sendTreeCommand({
    action: 'treeItemIndentDecrease',
    itemUIDs,
  } as Messages.TreeItemIndentDecreaseMessage)
}

// ==============================
// Note Messages
// ==============================

export function createNote(parentUid?: UID, index?: number, text?: string) {
  void sendTreeCommand({
    action: 'createNote',
    parentUid,
    index,
    text,
  } as Messages.CreateNoteMessage)
}

export function removeNote(noteUid: UID) {
  void sendTreeCommand({
    action: 'removeNote',
    noteUid,
  } as Messages.RemoveNoteMessage)
}

export function toggleCollapseNote(noteUid: UID) {
  void sendTreeCommand({
    action: 'toggleCollapseNote',
    noteUid,
  } as Messages.ToggleCollapseNoteMessage)
}

export function updateNoteText(noteUid: UID, text: string) {
  void sendTreeCommand({
    action: 'updateNoteText',
    noteUid,
    text,
  } as Messages.UpdateNoteTextMessage)
}

// ==============================
// Separator Messages
// ==============================

export function createSeparator(parentUid?: UID, index?: number) {
  void sendTreeCommand({
    action: 'createSeparator',
    parentUid,
    index,
  } as Messages.CreateSeparatorMessage)
}

export function removeSeparator(separatorUid: UID) {
  void sendTreeCommand({
    action: 'removeSeparator',
    separatorUid,
  } as Messages.RemoveSeparatorMessage)
}

export function createSeparatorBelow(separatorUid: UID) {
  void sendTreeCommand({
    action: 'createSeparatorBelow',
    separatorUid,
  } as Messages.CreateSeparatorBelowMessage)
}

// ==============================
// Debug Messages
// ==============================
export function printSessionTree() {
  void sendTreeCommand({
    action: 'printSessionTree',
  })
}
