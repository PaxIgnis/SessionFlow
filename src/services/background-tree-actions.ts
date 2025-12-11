import { STORAGE_KEY } from '@/defaults/constants'
import { OnCreatedQueue } from '@/services/background-on-created-queue'
import { Tree } from '@/services/background-tree'
import { Settings } from '@/services/settings'
import { State, Tab, Window } from '@/types/session-tree'

/**
 * Initializes the session tree by first loading the save tree from storage,
 * and then updating it with the current state of the browser.
 *
 * @returns {Promise<void>} A promise that resolves when the session tree has been initialized.
 */
export async function initializeWindows(): Promise<void> {
  try {
    await Tree.loadSessionTreeFromStorage()
    const currentWindows = await browser.windows.getAll({ populate: true })
    currentWindows.forEach((win) => {
      const newWindow: Window = {
        id: win.id!,
        serialId: 0,
        selected: false,
        state: State.OPEN,
        active: win.focused,
        activeTabId: win.tabs?.find((tab) => tab.active)?.id,
        indentLevel: 0,
        tabs: win.tabs!.map((tab) => ({
          active: tab.active,
          id: tab.id!,
          serialId: 0,
          selected: false,
          state: State.OPEN,
          title: tab.title!,
          url: tab.url!,
          windowSerialId: 0,
          indentLevel: 1,
        })),
      }
      Tree.windowsList.push(newWindow)
    })
    Tree.serializeSessionTree()
  } catch (error) {
    console.error('Error initializing windows:', error)
  }
}

/**
 * Serializes the session tree by assigning serial IDs to windows and tabs.
 */
export function serializeSessionTree(): void {
  Tree.windowsList.forEach((window, windowIndex) => {
    window.serialId = windowIndex
    window.tabs.forEach((tab, tabIndex) => {
      tab.serialId = tabIndex
      tab.windowSerialId = window.serialId
    })
  })
  setVisibility()
  setIndentLevel()
}

/**
 * Sets visibility of tree items based on collapsed state.
 */
function setVisibility(): void {
  Tree.windowsList.forEach((win) => {
    if (win.collapsed) {
      win.tabs.forEach((tab) => {
        tab.isVisible = false
      })
    } else {
      const childrenMap = new Map<number, Tab[]>()
      win.tabs.forEach((tab) => {
        if (tab.parentId !== undefined) {
          if (!childrenMap.has(tab.parentId)) {
            childrenMap.set(tab.parentId, [])
          }
          childrenMap.get(tab.parentId)!.push(tab)
        }
      })
      const roots = win.tabs.filter((t) => t.parentId === undefined)
      setVisibilityRecursively(roots, childrenMap, true)
    }
  })
}

/*
 * Recursively sets visibility for tabs and their children.
 */
function setVisibilityRecursively(
  tabs: Tab[],
  childrenMap: Map<number, Tab[]>,
  isVisible: boolean
): void {
  for (const tab of tabs) {
    tab.isVisible = isVisible
    const children = childrenMap.get(tab.serialId) || []
    if (children.length > 0) {
      const childVisibility = isVisible && !tab.collapsed
      setVisibilityRecursively(children, childrenMap, childVisibility)
    }
  }
}

/*
 * Sets indent levels for windows and tabs if not already set.
 */
function setIndentLevel(): void {
  for (const w of Tree.windowsList) {
    if (w.indentLevel === undefined) {
      w.indentLevel = 0
    }
    for (const tab of w.tabs) {
      if (tab.indentLevel === undefined) {
        tab.indentLevel = 1
      }
    }
  }
}

/**
 * Loads the session tree from local storage.
 *
 * @returns {Promise<void>} A promise that resolves when the session tree has been loaded.
 */
export async function loadSessionTreeFromStorage(): Promise<void> {
  try {
    const sessionTree = await browser.storage.local.get(STORAGE_KEY)
    console.debug('Session Tree from storage:', sessionTree)
    if (sessionTree[STORAGE_KEY]) {
      Tree.windowsList.splice(
        0,
        Tree.windowsList.length,
        ...sessionTree[STORAGE_KEY]
      )
      Tree.windowsList.forEach((window) => {
        window.id = 0
        window.state = State.SAVED
        window.active = false
        window.activeTabId = 0
        window.selected = false
        if (!window.savedTime) window.savedTime = Date.now()
        window.tabs.forEach((tab) => {
          tab.active = false
          tab.id = 0
          tab.selected = false
          tab.state = State.SAVED
          if (!tab.savedTime) tab.savedTime = Date.now()
        })
      })
    }
  } catch (error) {
    console.error('Error loading session tree from storage:', error)
  }
}

/**
 * Saves the session tree to local storage.
 *
 * @returns {Promise<void>} A promise that resolves when the session tree has been saved.
 */
export async function saveSessionTreeToStorage(): Promise<void> {
  try {
    await browser.storage.local.set({
      [STORAGE_KEY]: structuredClone(Tree.windowsList),
    })
  } catch (error) {
    console.error('Error saving session tree to storage:', error)
  }
}

/**
 * Opens Session Tree popup window
 */
export async function openSessionTree(): Promise<void> {
  if (Tree.sessionTreeWindowId) {
    const openWindows = await browser.windows.getAll()
    const exists = openWindows.some(
      (window) => window.id === Tree.sessionTreeWindowId
    )

    if (exists) {
      await browser.windows.update(Tree.sessionTreeWindowId, { focused: true })
      return // Window is already open
    }
  }
  // properties to pass to browser.windows.create
  const properties: browser.windows._CreateCreateData = {
    type: 'popup' as browser.windows.CreateType,
    url: 'sessiontree.html',
  }

  if (Settings.values.openSessionTreeInSameLocation) {
    let bounds
    // get last window position and size from storage
    const sessionTreeWindowConfigLocal = localStorage.getItem(
      'sessionTreeWindowConfig'
    )
    if (sessionTreeWindowConfigLocal) {
      bounds = JSON.parse(sessionTreeWindowConfigLocal)
    } else {
      const { sessionTreeWindowConfig } = await browser.storage.local.get({
        sessionTreeWindowConfig: {
          width: 300,
          height: 700,
          top: 50,
          left: 50,
        },
      })

      bounds = sessionTreeWindowConfig
    }
    properties.width = bounds.width
    properties.height = bounds.height
    properties.top = bounds.top
    properties.left = bounds.left
  }

  const sessionTreeWindow = await OnCreatedQueue.createWindowAndWait(properties)
  Tree.sessionTreeWindowId = sessionTreeWindow.id
}

/**
 * Returns the session tree.
 *
 * @returns {Array<Window>} The session tree
 */
function getSessionTree(): Array<Window> {
  return Tree.windowsList
}

/**
 * Sets the session tree to a new tree, saving the current tree as a backup.
 *
 * @param {Array<Window>} newTree - The new session tree
 */
function setSessionTree(newTree: Array<Window>): void {
  Tree.windowsBackupList = Tree.windowsList
  Tree.windowsList = newTree
}

/**
 * Resets the session tree to the backup session tree.
 */
function resetSessionTree(): void {
  console.log('Resetting Session Tree')
  Tree.windowsList = Tree.windowsBackupList
  Tree.saveSessionTreeToStorage()
}

// ==============================
// Exposed Functions for the SessionTree Vue component
// ==============================

window.getSessionTree = getSessionTree
window.setSessionTree = setSessionTree
window.resetSessionTree = resetSessionTree

/**
 * Resets the session tree id variable.
 */
export async function removeSessionWindowId(windowId: number): Promise<void> {
  if (windowId === Tree.sessionTreeWindowId) {
    Tree.sessionTreeWindowId = undefined
  }
}

/**
 * Focuses a tab and corresponding window.
 *
 * @param {Object} message - The message object containing tab information.
 * @param {number} message.tabId - The ID of the tab to be focused.
 * @param {number} message.windowId - The ID of the window containing the tab.
 */
export function focusTabAndWindow(message: {
  tabId: number
  windowId: number
}): void {
  Tree.focusTab({ tabId: message.tabId })
  Tree.focusWindow({ windowId: message.windowId })
}
