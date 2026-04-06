import { sendTreeCommand } from '@/services/runtime-port-service'
import { Settings } from '@/services/settings'
import * as Messages from '@/types/messages'
import { State, Tab, Window } from '@/types/session-tree'

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

export function duplicateTab(tabId: number, tabUid: UID) {
  void sendTreeCommand({
    action: 'duplicateTab',
    tabId: tabId,
    tabUid: tabUid,
  } as Messages.DuplicateTabMessage)
}

export function duplicateTabs(tabs: Array<Tab>) {
  tabs.forEach((tab) => {
    duplicateTab(tab.id, tab.uid)
  })
}

export function focusTab(tabId: number, windowId: number) {
  void sendTreeCommand({
    action: 'focusTab',
    tabId: tabId,
    windowId: windowId,
  } as Messages.FocusTabMessage)
}

export function moveTabs(
  tabUIDs: Array<UID>,
  targetWindowUid: UID,
  targetIndex: number,
  parentUid: UID | undefined,
  copy: boolean = false,
) {
  void sendTreeCommand({
    action: 'moveTabs',
    tabUIDs: tabUIDs,
    targetWindowUid: targetWindowUid,
    targetIndex: targetIndex,
    parentUid: parentUid,
    copy: copy,
  })
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

export function tabDoubleClick(
  tabId: number,
  windowId: number,
  tabUid: UID,
  windowUid: UID,
  state: State,
  url: string,
) {
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
      duplicateTab(tabId, tabUid)
    } else if (tabDoubleClickAction === 'focus') {
      focusTab(tabId, windowId)
    }
  } else if (state === State.SAVED) {
    const tabDoubleClickAction = Settings.values.doubleClickOnSavedTab

    if (tabDoubleClickAction === 'open') {
      openTab(tabUid, windowUid, url)
    } else if (tabDoubleClickAction === 'remove') {
      closeTab(tabId, tabUid)
    } else if (tabDoubleClickAction === 'duplicate') {
      duplicateTab(tabId, tabUid)
    }
  }
}

export function tabIndentDecrease(tabs: Array<Tab>) {
  const tabUids = tabs.map((tab) => tab.uid)
  void sendTreeCommand({
    action: 'tabIndentDecrease',
    tabUids: tabUids,
  })
}

export function tabIndentIncrease(tabs: Array<Tab>) {
  const tabUids = tabs.map((tab) => tab.uid)
  void sendTreeCommand({
    action: 'tabIndentIncrease',
    tabUids: tabUids,
  })
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

export function windowDoubleClick(
  windowUid: UID,
  windowId: number,
  state: State,
) {
  console.log('Window double clicked. Window ID: ', windowId)
  if (state === State.SAVED) {
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

// ==============================
// Debug Messages
// ==============================
export function printSessionTree() {
  void sendTreeCommand({
    action: 'printSessionTree',
  })
}
