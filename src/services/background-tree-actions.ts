import { STORAGE_KEY } from '@/defaults/constants'
import { OnCreatedQueue } from '@/services/background-on-created-queue'
import { Tree } from '@/services/background-tree'
import { Favicons } from '@/services/favicons'
import { Settings } from '@/services/settings'
import * as Utils from '@/services/utils'
import { State, Tab, Window } from '@/types/session-tree'
import { emitTreeDelta } from './runtime-port-service'

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
    const matchedWindowUids = new Set<UID>()
    const openWindowUIDs = new Set<UID>()
    Tree.windowsList.forEach((w) => {
      if (w.state !== State.SAVED) {
        openWindowUIDs.add(w.uid)
      }
    })
    currentWindows.forEach((win) => {
      let bestMatch = undefined
      if (Settings.values.matchOpenedWindowsWithSavedWindowsOnStartup) {
        // Reuse a saved window when the current browser window looks like a restored session window.
        bestMatch = findBestSavedWindowMatch(win, matchedWindowUids)
      }
      if (
        Settings.values.matchOpenedWindowsWithSavedWindowsOnStartup &&
        bestMatch
      ) {
        matchedWindowUids.add(bestMatch.uid)
        reconcileSavedWindowWithOpenWindow(bestMatch, win)
      } else {
        const windowUid = Utils.createUid(Tree.existingUidsSet)
        const newWindow: Window = {
          uid: windowUid,
          id: win.id!,
          selected: false,
          state: State.OPEN,
          active: win.focused,
          activeTabId: win.tabs?.find((tab) => tab.active)?.id,
          indentLevel: 0,
          tabs: win.tabs!.map((tab) => ({
            uid: Utils.createUid(Tree.existingUidsSet),
            active: tab.active,
            id: tab.id!,
            selected: false,
            state: tab.discarded ? State.DISCARDED : State.OPEN,
            title: tab.title || 'Untitled',
            url: tab.url || '',
            windowUid: windowUid,
            indentLevel: 1,
            pinned: tab.pinned || false,
          })),
        }
        Tree.windowsList.push(newWindow)
      }
    })
    openWindowUIDs.forEach((uid) => {
      if (!matchedWindowUids.has(uid)) {
        const orphanedWindow = Tree.windowsByUid.get(uid)
        if (orphanedWindow) {
          orphanedWindow.state = State.SAVED
          orphanedWindow.tabs.forEach((tab) => {
            tab.state = State.SAVED
          })
        }
      }
    })
    rebuildUIDMaps()
    Tree.recomputeSessionTree()
    Tree.initialized = true
    if (Settings.values.fetchMissingFaviconsOnStartup) {
      await Favicons.init()
      const hasPermissions = await Favicons.hasFetchPermissions()
      if (!hasPermissions) {
        console.info(
          'Skipping startup favicon fetch: host permissions are not granted',
        )
        return
      }
      const tabUrls = Array.from(Tree.tabsByUid.values())
        .map((tab) => tab.url)
        .filter((url): url is string => typeof url === 'string' && url !== '')
      await Favicons.fetchMissingFavicons(tabUrls)
    }
  } catch (error) {
    console.error('Error initializing windows:', error)
  }
}

/**
 * Finds the best matching non-saved window in the session tree for the given browser window.
 *
 * @param {browser.windows.Window} openWindow - The currently open browser window.
 * @param {Set<UID>} matchedWindowUids - The set of session tree window UIDs that were already matched.
 * @returns {Window | undefined} The best matching window, or undefined if no match is good enough.
 */
function findBestSavedWindowMatch(
  openWindow: browser.windows.Window,
  matchedWindowUids: Set<UID>,
): Window | undefined {
  let bestMatch: Window | undefined
  let bestScore = -1

  for (const savedWindow of Tree.windowsList) {
    if (matchedWindowUids.has(savedWindow.uid)) {
      continue
    }
    if (savedWindow.state === State.SAVED) {
      continue
    }

    const score = scoreWindowMatch(savedWindow, openWindow)
    if (score > bestScore) {
      bestScore = score
      bestMatch = savedWindow
    }
  }

  // conservative threshold: require at least one meaningful tab match
  return bestScore >= 3 ? bestMatch : undefined
}

/**
 * Scores how well a saved window matches an open browser window.
 *
 * Only tabs that are not already saved are considered, because saved tabs were not open at shutdown.
 *
 * @param {Window} savedWindow - The candidate session tree window.
 * @param {browser.windows.Window} openWindow - The currently open browser window.
 * @returns {number} A higher score indicates a better match.
 */
function scoreWindowMatch(
  savedWindow: Window,
  openWindow: browser.windows.Window,
): number {
  const openTabs = openWindow.tabs ?? []
  const candidateTabs = savedWindow.tabs.filter(
    (tab) => tab.state !== State.SAVED,
  )
  if (candidateTabs.length === 0) {
    return -1
  }

  const minLen = Math.min(candidateTabs.length, openTabs.length)
  let score = 0

  for (let i = 0; i < minLen; i++) {
    const savedTab = candidateTabs[i]
    const openTab = openTabs[i]
    const savedUrl = savedTab.url || ''
    const openUrl = openTab.url || ''

    if (savedUrl !== '' && savedUrl === openUrl) {
      score += 4
    }
    if (savedTab.title && openTab.title && savedTab.title === openTab.title) {
      score += 1
    }
    if ((savedTab.pinned || false) === (openTab.pinned || false)) {
      score += 1
    }
  }

  score -= Math.abs(candidateTabs.length - openTabs.length) * 2
  return score
}

/**
 * Reconciles an open browser window with an existing saved session tree window.
 *
 * Tabs that match by URL/title/pinned state are reused, and any remaining open tabs are appended as new open tabs.
 *
 * @param {Window} savedWindow - The saved session tree window to update.
 * @param {browser.windows.Window} openWindow - The currently open browser window.
 */
function reconcileSavedWindowWithOpenWindow(
  savedWindow: Window,
  openWindow: browser.windows.Window,
): void {
  const openTabs = openWindow.tabs ?? []

  // Mark the saved window as currently open and refresh the browser-facing fields.
  savedWindow.id = openWindow.id ?? savedWindow.id
  savedWindow.state = State.OPEN
  savedWindow.active = openWindow.focused
  savedWindow.activeTabId = openTabs.find((tab) => tab.active)?.id
  savedWindow.selected = false

  // Only tabs that were open at shutdown participate in matching.
  const usedOpenTabIds = new Set<number>()
  const candidateTabs = savedWindow.tabs.filter(
    (tab) => tab.state !== State.SAVED,
  )
  for (const savedTab of candidateTabs) {
    // Try to pair each saved open tab with a browser tab that looks like the same tab.
    // The match is intentionally conservative to avoid reusing the wrong tab.
    const matchedOpenTab = findBestOpenTabMatch(
      savedTab,
      openTabs,
      usedOpenTabIds,
    )

    if (!matchedOpenTab) {
      // If no match is found, keep the saved tab in the tree but leave it saved.
      // This means it was not restored as an open browser tab during startup.
      savedTab.id = 0
      savedTab.state = State.SAVED
      savedTab.active = false
      savedTab.selected = false
      savedTab.windowUid = savedWindow.uid
      continue
    }

    // Record the browser tab so we do not match it again to another saved tab.
    if (matchedOpenTab.id !== undefined) {
      usedOpenTabIds.add(matchedOpenTab.id)
    }

    // Rehydrate the saved tab with the live browser tab state.
    savedTab.id = matchedOpenTab.id ?? 0
    savedTab.state = matchedOpenTab.discarded ? State.DISCARDED : State.OPEN
    savedTab.active = matchedOpenTab.active
    savedTab.selected = false
    savedTab.title = matchedOpenTab.title || savedTab.title || 'Untitled'
    savedTab.url = matchedOpenTab.url || savedTab.url || ''
    savedTab.pinned = matchedOpenTab.pinned || false
    savedTab.windowUid = savedWindow.uid
  }

  // Any browser tabs that were not matched to saved tabs are treated as new open tabs.
  for (const openTab of openTabs) {
    if (openTab.id === undefined || usedOpenTabIds.has(openTab.id)) {
      continue
    }

    // Create a new open session tree tab for each unmatched browser tab.
    savedWindow.tabs.push({
      uid: Utils.createUid(Tree.existingUidsSet),
      active: openTab.active,
      id: openTab.id,
      selected: false,
      state: openTab.discarded ? State.DISCARDED : State.OPEN,
      title: openTab.title || 'Untitled',
      url: openTab.url || '',
      windowUid: savedWindow.uid,
      indentLevel: 1,
      pinned: openTab.pinned || false,
    })
  }
}

/**
 * Finds the best matching non-saved tab for a saved tab.
 *
 * @param {Tab} savedTab - The saved session tree tab.
 * @param {browser.tabs.Tab[]} openTabs - The currently open tabs in the browser window.
 * @param {Set<number>} usedOpenTabIds - The browser tab IDs that were already matched.
 * @returns {browser.tabs.Tab | undefined} The best matching tab, or undefined if no match is good enough.
 */
function findBestOpenTabMatch(
  savedTab: Tab,
  openTabs: browser.tabs.Tab[],
  usedOpenTabIds: Set<number>,
): browser.tabs.Tab | undefined {
  let bestMatch: browser.tabs.Tab | undefined
  let bestScore = -1

  for (const openTab of openTabs) {
    if (openTab.id === undefined || usedOpenTabIds.has(openTab.id)) {
      continue
    }
    const score = scoreTabMatch(savedTab, openTab)
    if (score > bestScore) {
      bestScore = score
      bestMatch = openTab
    }
  }

  return bestScore >= 2 ? bestMatch : undefined
}

/**
 * Scores how well a saved tab matches an open browser tab.
 *
 * @param {Tab} savedTab - The candidate session tree tab.
 * @param {browser.tabs.Tab} openTab - The currently open browser tab.
 * @returns {number} A higher score indicates a better match.
 */
function scoreTabMatch(savedTab: Tab, openTab: browser.tabs.Tab): number {
  let score = 0
  if (savedTab.url && openTab.url && savedTab.url === openTab.url) {
    score += 3
  }
  if (savedTab.title && openTab.title && savedTab.title === openTab.title) {
    score += 1
  }
  if ((savedTab.pinned || false) === (openTab.pinned || false)) {
    score += 1
  }
  return score
}

/**
 * Verifys visibility and indent levels of tree items.
 *
 * @param {boolean = true} emitDelta - Whether to emit tree delta events for each tab updated.
 */
export function recomputeSessionTree(emitDelta: boolean = true): void {
  computeVisibility(emitDelta)
  setIndentLevel(emitDelta)
}

/**
 * Sets visibility of tree items based on collapsed state.
 *
 * @param {boolean = true} emitDelta - Whether to emit tree delta events for each tab updated.
 */
function computeVisibility(emitDelta: boolean = true): void {
  Tree.windowsList.forEach((win) => {
    if (win.collapsed) {
      win.tabs.forEach((tab) => {
        if (tab.isVisible) {
          Tree.updateTab({ tabUid: tab.uid }, { isVisible: false }, emitDelta)
        }
      })
    } else {
      const childrenMap = new Map<UID, Tab[]>()
      win.tabs.forEach((tab) => {
        if (tab.parentUid !== undefined) {
          if (!childrenMap.has(tab.parentUid)) {
            childrenMap.set(tab.parentUid, [])
          }
          childrenMap.get(tab.parentUid)!.push(tab)
        }
      })
      const roots = win.tabs.filter((t) => t.parentUid === undefined)
      Tree.setTabVisibilityRecursively(roots, childrenMap, true, emitDelta)
    }
  })
}

/**
 * Sets indent levels for windows and tabs if not already set.
 *
 * @param {boolean = true} emitDelta - Whether to emit tree delta events for each tab updated.
 */
function setIndentLevel(emitDelta: boolean = true): void {
  for (const w of Tree.windowsList) {
    if (w.indentLevel === undefined) {
      Tree.updateWindow(w.uid, { indentLevel: 0 }, emitDelta)
    }
    for (const tab of w.tabs) {
      if (tab.indentLevel === undefined) {
        Tree.updateTab({ tabUid: tab.uid }, { indentLevel: 1 }, emitDelta)
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
        ...sessionTree[STORAGE_KEY],
      )
      Tree.windowsList.forEach((window) => {
        window.id = 0
        window.active = false
        window.activeTabId = 0
        window.selected = false
        if (!window.savedTime) window.savedTime = Date.now()
        if (!window.uid) window.uid = Utils.createUid(Tree.existingUidsSet)
        Tree.windowsByUid.set(window.uid, window)
        window.tabs.forEach((tab) => {
          tab.active = false
          tab.id = 0
          tab.selected = false
          if (!tab.savedTime) tab.savedTime = Date.now()
          if (!tab.uid) tab.uid = Utils.createUid(Tree.existingUidsSet)
          Tree.tabsByUid.set(tab.uid, tab)
          tab.windowUid = window.uid
          if (!tab.pinned) tab.pinned = false
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
      (window) => window.id === Tree.sessionTreeWindowId,
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
      'sessionTreeWindowConfig',
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
 * Sets the session tree window id variable to the given window id.
 * Removes the window from the session tree if it exists there as a saved window.
 *
 */
export function registerSessionTreeWindow(windowId: number): void {
  Tree.sessionTreeWindowId = windowId
  // remove windowId from session tree if it exists there as a saved window, since it's now the live session tree window
  const existingWindow = Tree.windowsList.find((w) => w.id === windowId)
  if (existingWindow) {
    Tree.windowsList.splice(Tree.windowsList.indexOf(existingWindow), 1)
    emitTreeDelta({
      op: 'windowRemoved',
      windowUid: existingWindow.uid,
    })
    Tree.windowsByUid.delete(existingWindow.uid)
    Tree.existingUidsSet.delete(existingWindow.uid)
    saveSessionTreeToStorage()
  }
}

/**
 * Resets the session tree id variable.
 */
export async function removeSessionWindowId(windowId: number): Promise<void> {
  if (windowId === Tree.sessionTreeWindowId) {
    Tree.sessionTreeWindowId = undefined
  }
}

/**
 * Deselects all windows and tabs in the session tree.
 */
export function deselectAllItems(): void {
  Tree.windowsList.forEach((window) => {
    window.tabs.forEach((tab) => {
      tab.selected = false
    })
    window.selected = false
  })
}

/**
 * Rebuilds the windowsByUid and tabsByUid maps and existingUidsSet based on the current windowsList.
 */
function rebuildUIDMaps(): void {
  // Rebuild lookup maps and existing UID set to match the new contents.
  Tree.windowsByUid.clear()
  Tree.tabsByUid.clear()
  Tree.existingUidsSet.clear()
  for (const win of Tree.windowsList) {
    if (win.uid) {
      Tree.windowsByUid.set(win.uid, win)
      Tree.existingUidsSet.add(win.uid)
    }
    for (const tab of win.tabs) {
      if (tab.uid) {
        Tree.tabsByUid.set(tab.uid, tab)
        Tree.existingUidsSet.add(tab.uid)
      }
    }
  }
}

export function printSessionTree(): void {
  console.log('Background Session Tree:', Tree.windowsList)
}
