import { State, Tab } from '@/types/session-tree'

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
  })
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

export function tabDoubleClick(
  tabId: number,
  windowId: number,
  tabSerialId: number,
  windowSerialId: number,
  state: State,
  url: string
) {
  if (state === State.SAVED) {
    window.browser.runtime.sendMessage({
      action: 'openTab',
      tabSerialId: tabSerialId,
      windowSerialId: windowSerialId,
      url: url,
    })
  } else if (state === State.OPEN || state === State.DISCARDED) {
    window.browser.runtime.sendMessage({
      action: 'focusTab',
      tabId: tabId,
      windowId: windowId,
    })
  }
}
