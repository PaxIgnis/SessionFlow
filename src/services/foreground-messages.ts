import { sendTreeCommand } from '@/services/runtime-port-service'
import { showPrivateWindowAccessRequired } from '@/services/notification-state'
import { SessionTree } from '@/services/foreground-tree'
import { Settings } from '@/services/settings'
import { isPrivateWindowAccessAllowed } from '@/services/utils'
import * as Messages from '@/types/messages'
import { State, Tab, TreeItemType, Window } from '@/types/session-tree'

// ==============================
// Tab Messages
// ==============================

export function closeTab(tabId: number, tabUid: UID) {
  void sendTreeCommand({
    action: 'closeTab',
    tabId: tabId,
    tabUid: tabUid,
  } as Messages.CloseTabMessage)
}

export function closeTabs(tabs: Array<Tab>) {
  tabs.forEach((tab) => {
    closeTab(tab.id, tab.uid)
  })
}

export function focusTab(tabId: number, windowId: number) {
  void sendTreeCommand({
    action: 'focusTab',
    tabId: tabId,
    windowId: windowId,
  } as Messages.FocusTabMessage)
}

export function openTab(tabUid: UID, windowUid: UID, url: string) {
  void sendTreeCommand({
    action: 'openTab',
    tabUid: tabUid,
    windowUid: windowUid,
    url: url,
  })
}

export function openTabs(tabs: Array<Tab>) {
  tabs.forEach((tab) => {
    openTab(tab.uid, tab.windowUid, tab.url)
  })
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

export function saveTab(tabId: number, tabUid: UID) {
  void sendTreeCommand({
    action: 'saveTab',
    tabId: tabId,
    tabUid: tabUid,
  })
}

export function saveTabs(tabs: Array<Tab>) {
  tabs.forEach((tab) => {
    saveTab(tab.id, tab.uid)
  })
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
      openTab(tabUid, windowUid, url)
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

export function closeWindow(windowId: number, windowUid: UID) {
  void sendTreeCommand({
    action: 'closeWindow',
    windowId: windowId,
    windowUid: windowUid,
  })
}

export function closeWindows(windows: Array<Window>) {
  windows.forEach((window) => {
    closeWindow(window.id, window.uid)
  })
}

export function saveWindow(windowId: number, windowUid: UID) {
  void sendTreeCommand({
    action: 'saveWindow',
    windowId: windowId,
    windowUid: windowUid,
  })
}

export function saveWindows(windows: Array<Window>) {
  windows.forEach((window) => {
    saveWindow(window.id, window.uid)
  })
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
    void sendTreeCommand({
      action: 'openWindow',
      windowUid: windowUid,
    })
  } else if (state === State.OPEN) {
    void sendTreeCommand({
      action: 'focusWindow',
      windowId: windowId,
    })
  }
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
) {
  void sendTreeCommand({
    action: 'moveWindows',
    windowUIDs: windowUIDs,
    targetIndex: targetIndex,
    copy: copy,
  })
}

export function moveTreeItems(
  itemUIDs: Array<UID>,
  targetIndex: number,
  parentUid?: UID,
  targetWindowUid?: UID,
  copy: boolean = false,
  includeDescendants?: boolean,
) {
  void sendTreeCommand({
    action: 'moveTreeItems',
    itemUIDs,
    targetIndex,
    parentUid,
    targetWindowUid,
    copy,
    includeDescendants,
  } as Messages.MoveTreeItemsMessage)
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
  } as Messages.DuplicateTreeItemsMessage)
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
