import * as Messages from '@/types/messages'
import { State, Tab, Window } from '@/types/session-tree'

// ==============================
// Tab Messages
// ==============================

export function closeTab(
  tabId: number,
  tabSerialId: number,
  windowSerialId: number
) {
  window.browser.runtime.sendMessage({
    action: 'closeTab',
    tabId: tabId,
    tabSerialId: tabSerialId,
    windowSerialId: windowSerialId,
  } as Messages.CloseTabMessage)
}

export function closeTabs(tabs: Array<Tab>) {
  tabs.forEach((tab) => {
    closeTab(tab.id, tab.serialId, tab.windowSerialId)
  })
}

export function reloadTab(
  tabId: number,
  tabSerialId: number,
  windowSerialId: number
) {
  window.browser.runtime.sendMessage({
    action: 'reloadTab',
    tabId: tabId,
    tabSerialId: tabSerialId,
    windowSerialId: windowSerialId,
  })
}

export function reloadTabs(tabs: Array<Tab>) {
  tabs.forEach((tab) => {
    reloadTab(tab.id, tab.serialId, tab.windowSerialId)
  })
}

export function saveTab(
  tabId: number,
  tabSerialId: number,
  windowSerialId: number
) {
  window.browser.runtime.sendMessage({
    action: 'saveTab',
    tabId: tabId,
    tabSerialId: tabSerialId,
    windowSerialId: windowSerialId,
  })
}

export function saveTabs(tabs: Array<Tab>) {
  tabs.forEach((tab) => {
    saveTab(tab.id, tab.serialId, tab.windowSerialId)
  })
}

export function openTab(
  tabSerialId: number,
  windowSerialId: number,
  url: string
) {
  window.browser.runtime.sendMessage({
    action: 'openTab',
    tabSerialId: tabSerialId,
    windowSerialId: windowSerialId,
    url: url,
  })
}

export function openTabs(tabs: Array<Tab>) {
  tabs.forEach((tab) => {
    openTab(tab.serialId, tab.windowSerialId, tab.url)
  })
}

export function tabDoubleClick(
  tabId: number,
  windowId: number,
  tabSerialId: number,
  windowSerialId: number,
  state: State,
  url: string
) {
  if (state === State.SAVED) {
    openTab(tabSerialId, windowSerialId, url)
  } else if (state === State.OPEN || state === State.DISCARDED) {
    window.browser.runtime.sendMessage({
      action: 'focusTab',
      tabId: tabId,
      windowId: windowId,
    })
  }
}

// ==============================
// Window Messages
// ==============================

export function closeWindow(windowId: number, windowSerialId: number) {
  window.browser.runtime.sendMessage({
    action: 'closeWindow',
    windowId: windowId,
    windowSerialId: windowSerialId,
  })
}

export function closeWindows(windows: Array<Window>) {
  windows.forEach((window) => {
    closeWindow(window.id, window.serialId)
  })
}

export function saveWindow(windowId: number, windowSerialId: number) {
  window.browser.runtime.sendMessage({
    action: 'saveWindow',
    windowId: windowId,
    windowSerialId: windowSerialId,
  })
}

export function saveWindows(windows: Array<Window>) {
  windows.forEach((window) => {
    saveWindow(window.id, window.serialId)
  })
}

export function windowDoubleClick(
  windowSerialId: number,
  windowId: number,
  state: State
) {
  console.log('Window double clicked. Window ID: ', windowId)
  if (state === State.SAVED) {
    window.browser.runtime.sendMessage({
      action: 'openWindow',
      windowSerialId: windowSerialId,
    })
  } else if (state === State.OPEN) {
    window.browser.runtime.sendMessage({
      action: 'focusWindow',
      windowId: windowId,
    })
  }
}
