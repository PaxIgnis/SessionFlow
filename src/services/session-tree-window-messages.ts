import { State, Window } from '@/types/session-tree'

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

export function reloadWindow(windowId: number, windowSerialId: number) {
  window.browser.runtime.sendMessage({
    action: 'reloadWindow',
    windowId: windowId,
    windowSerialId: windowSerialId,
  })
}

export function reloadWindows(windows: Array<Window>) {
  windows.forEach((window) => {
    reloadWindow(window.id, window.serialId)
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
