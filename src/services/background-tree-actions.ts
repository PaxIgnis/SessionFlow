import { STORAGE_KEY } from '@/defaults/constants'
import { OnCreatedQueue } from '@/services/background-on-created-queue'
import { Tree } from '@/services/background-tree'
import { Favicons } from '@/services/favicons'
import { Settings } from '@/services/settings'
import * as Utils from '@/services/utils'
import {
  Note,
  Separator,
  State,
  Tab,
  TreeItem,
  TreeItemType,
  Window,
} from '@/types/session-tree'
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
    const tabUIDsToOpenOnStartup = new Set<UID>()
    Tree.Items.filter(Tree.isWindow).forEach((w) => {
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
        const tabsToOpen = reconcileSavedWindowWithOpenWindow(bestMatch, win)
        // track tabs to restore later if the setting is enabled, since they were not matched to open tabs
        if (tabsToOpen) {
          tabsToOpen.forEach((uid) => tabUIDsToOpenOnStartup.add(uid))
        }
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
          type: TreeItemType.WINDOW,
          children: win.tabs!.map((tab) => ({
            type: TreeItemType.TAB,
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
        Tree.Items.push(newWindow)
      }
    })
    // collect uids for session restore and cleanup states
    for (const uid of openWindowUIDs) {
      if (matchedWindowUids.has(uid)) {
        continue
      }

      const orphanedWindow = Tree.windowsByUid.get(uid)
      if (!orphanedWindow) {
        continue
      }

      if (Settings.values.restorePreviousSessionOnStartup) {
        const tabsToOpen = Tree.getTabs(orphanedWindow.children).filter(
          (tab) => tab.state !== State.SAVED,
        )

        if (tabsToOpen.length === 0) {
          markWindowSavedAfterStartup(orphanedWindow)
          continue
        }

        markWindowSavedAfterStartup(orphanedWindow)
        for (const tab of tabsToOpen) {
          tabUIDsToOpenOnStartup.add(tab.uid)
        }
      } else {
        markWindowSavedAfterStartup(orphanedWindow)
      }
    }
    rebuildUIDMaps()
    Tree.recomputeSessionTree()
    Tree.initialized = true
    // Open tabs for any saved windows that were not matched to open windows, if the setting is enabled.
    if (Settings.values.restorePreviousSessionOnStartup) {
      for (const tabUid of tabUIDsToOpenOnStartup) {
        const tab = Tree.tabsByUid.get(tabUid)
        if (!tab) {
          continue
        }
        Tree.openTab({
          tabUid: tab.uid,
          windowUid: tab.windowUid,
          discarded: Settings.values.openWindowWithTabsDiscarded,
          url: tab.url,
        })
      }
    }
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

  for (const savedWindow of Tree.Items.filter(Tree.isWindow)) {
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
  const candidateTabs = Tree.getTabs(savedWindow.children).filter(
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
): UID[] | void {
  const openTabs = openWindow.tabs ?? []

  // Mark the saved window as currently open and refresh the browser-facing fields.
  savedWindow.id = openWindow.id ?? savedWindow.id
  savedWindow.state = State.OPEN
  savedWindow.active = openWindow.focused
  savedWindow.activeTabId = openTabs.find((tab) => tab.active)?.id
  savedWindow.selected = false

  // Only tabs that were open at shutdown participate in matching.
  const usedOpenTabIds = new Set<number>()
  const tabsToOpen: UID[] = []
  const candidateTabs = Tree.getTabs(savedWindow.children).filter(
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

      // track uid to open it later if the setting is enabled, since it was not matched to an open tab
      if (Settings.values.restorePreviousSessionOnStartup) {
        tabsToOpen.push(savedTab.uid)
      }
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
    savedWindow.children.push({
      type: TreeItemType.TAB,
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
  if (tabsToOpen.length > 0) {
    return tabsToOpen
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
  setItemVisibilityInList(Tree.Items as TreeItem[], true, emitDelta)
}

/**
 * Sets the visibility of a tree item's children.
 *
 * @param itemUid - The UID of the parent tree item.
 * @param items - The list of all tree items.
 * @param visible - Whether the children should be visible.
 * @param emitDelta - Whether to emit tree delta events for each item updated.
 */
export function setItemChildrenVisibility(
  itemUid: UID,
  items: TreeItem[],
  visible: boolean,
  emitDelta: boolean,
): void {
  const childrenMap = Tree.buildChildrenMap(items)
  const roots = items.filter((item) => item.parentUid === itemUid)
  for (const item of roots) {
    setItemVisibilityRecursively(item, childrenMap, visible, emitDelta)
  }
}

/**
 * Sets the visibility of tree items in a list starting from the root items.
 *
 * @param items - The list of tree items.
 * @param parentVisible - Whether the parent items should be visible.
 * @param emitDelta - Whether to emit tree delta events for each item updated.
 */
export function setItemVisibilityInList(
  items: TreeItem[],
  parentVisible: boolean,
  emitDelta: boolean,
): void {
  const childrenMap = Tree.buildChildrenMap(items)
  const roots = items.filter((item) => item.parentUid === undefined)
  for (const item of roots) {
    setItemVisibilityRecursively(item, childrenMap, parentVisible, emitDelta)
  }
}

function setItemVisibilityRecursively(
  item: TreeItem,
  childrenMap: Map<UID, TreeItem[]>,
  parentVisible: boolean,
  emitDelta: boolean,
): void {
  const visible = parentVisible
  updateItemVisibility(item, visible, emitDelta)

  const childrenVisible = visible && !item.collapsed
  if (item.type === TreeItemType.WINDOW) {
    setItemVisibilityInList(
      item.children as TreeItem[],
      childrenVisible,
      emitDelta,
    )
  }

  const children = childrenMap.get(item.uid) || []
  for (const child of children) {
    setItemVisibilityRecursively(child, childrenMap, childrenVisible, emitDelta)
  }
}

function updateItemVisibility(
  item: TreeItem,
  isVisible: boolean,
  emitDelta: boolean,
): void {
  if (item.isVisible === isVisible) return
  if (item.type === TreeItemType.TAB) {
    Tree.updateTab({ tabUid: item.uid }, { isVisible }, emitDelta)
  } else if (item.type === TreeItemType.NOTE) {
    Tree.updateNote(item.uid, { isVisible }, emitDelta)
  } else if (item.type === TreeItemType.SEPARATOR) {
    Tree.updateSeparator(item.uid, { isVisible }, emitDelta)
  } else if (item.type === TreeItemType.WINDOW) {
    Tree.updateWindow(item.uid, { isVisible }, emitDelta)
  }
}

/**
 * Sets indent levels for windows and tabs if not already set.
 *
 * @param {boolean = true} emitDelta - Whether to emit tree delta events for each tab updated.
 */
function setIndentLevel(emitDelta: boolean = true): void {
  setIndentLevelsInList(Tree.Items as TreeItem[], undefined, emitDelta)
}

function setIndentLevelsInList(
  items: TreeItem[],
  containerParent: TreeItem | undefined,
  emitDelta: boolean,
): void {
  const byUid = new Map(items.map((item) => [item.uid, item] as const))
  for (const item of items) {
    const parent = item.parentUid ? byUid.get(item.parentUid) : containerParent
    const indentLevel = parent ? (parent.indentLevel ?? 0) + 1 : 0
    if (item.indentLevel !== indentLevel) {
      updateItemIndentLevel(item, indentLevel, emitDelta)
    }

    if (item.type === TreeItemType.WINDOW) {
      setIndentLevelsInList(item.children as TreeItem[], item, emitDelta)
    }
  }
}

function updateItemIndentLevel(
  item: TreeItem,
  indentLevel: number,
  emitDelta: boolean,
): void {
  if (item.type === TreeItemType.TAB) {
    Tree.updateTab({ tabUid: item.uid }, { indentLevel }, emitDelta)
  } else if (item.type === TreeItemType.NOTE) {
    Tree.updateNote(item.uid, { indentLevel }, emitDelta)
  } else if (item.type === TreeItemType.SEPARATOR) {
    Tree.updateSeparator(item.uid, { indentLevel }, emitDelta)
  } else {
    Tree.updateWindow(item.uid, { indentLevel }, emitDelta)
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
      Tree.Items.splice(0, Tree.Items.length, ...sessionTree[STORAGE_KEY])
      Tree.Items.forEach((window) => {
        if (window.type === TreeItemType.NOTE) {
          normalizeNote(window, undefined)
          return
        }
        if (window.type === TreeItemType.SEPARATOR) {
          normalizeSeparator(window, undefined)
          return
        }
        window.id = 0
        window.active = false
        window.activeTabId = undefined
        window.selected = false
        if (!window.savedTime) window.savedTime = Date.now()
        if (!window.uid) window.uid = Utils.createUid(Tree.existingUidsSet)
        Tree.windowsByUid.set(window.uid, window)
        normalizeWindowChildren(window)
      })
      rebuildUIDMaps()
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
      [STORAGE_KEY]: structuredClone(Tree.Items),
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
  const existingWindow = Tree.Items.find(
    (w) => w.type === TreeItemType.WINDOW && w.id === windowId,
  ) as Window | undefined
  if (existingWindow) {
    Tree.Items.splice(Tree.Items.indexOf(existingWindow), 1)
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
  Tree.walkTreeItems(Tree.Items, (item) => {
    item.selected = false
  })
}

/**
 * Rebuilds the windowsByUid and tabsByUid maps and existingUidsSet based on the current TreeItems.
 */
function rebuildUIDMaps(): void {
  // Rebuild lookup maps and existing UID set to match the new contents.
  Tree.windowsByUid.clear()
  Tree.tabsByUid.clear()
  Tree.notesByUid.clear()
  Tree.separatorsByUid.clear()
  Tree.existingUidsSet.clear()
  Tree.walkTreeItems(Tree.Items, (item) => indexTreeItem(item))
}

function markWindowSavedAfterStartup(window: Window): void {
  window.state = State.SAVED
  window.active = false
  window.activeTabId = undefined
  Tree.getTabs(window.children).forEach((tab) => {
    tab.state = State.SAVED
    tab.active = false
    tab.selected = false
    tab.id = 0
  })
}

function normalizeWindowChildren(window: Window): void {
  Tree.windowsByUid.set(window.uid, window)
  window.children ??= []
  window.children.forEach((child) => {
    if (child.type === TreeItemType.NOTE) {
      child.windowUid = window.uid
      normalizeNote(child, window.uid)
      return
    }
    if (child.type === TreeItemType.SEPARATOR) {
      child.windowUid = window.uid
      normalizeSeparator(child, window.uid)
      return
    }
    child.type = TreeItemType.TAB
    child.active = false
    child.id = 0
    child.selected = false
    child.state = State.SAVED
    if (!child.savedTime) child.savedTime = Date.now()
    if (!child.uid) child.uid = Utils.createUid(Tree.existingUidsSet)
    Tree.tabsByUid.set(child.uid, child)
    child.windowUid = window.uid
    if (!child.pinned) child.pinned = false
  })
}

function normalizeNote(note: Note, windowUid: UID | undefined): void {
  note.type = TreeItemType.NOTE
  note.selected = false
  note.windowUid = windowUid
  if (!note.uid) note.uid = Utils.createUid(Tree.existingUidsSet)
  Tree.notesByUid.set(note.uid, note)
}

function normalizeSeparator(
  separator: Separator,
  windowUid: UID | undefined,
): void {
  separator.type = TreeItemType.SEPARATOR
  separator.selected = false
  separator.windowUid = windowUid
  separator.isParent = false
  separator.collapsed = false
  if (!separator.uid) separator.uid = Utils.createUid(Tree.existingUidsSet)
  Tree.separatorsByUid.set(separator.uid, separator)
}

function indexTreeItem(item: TreeItem): void {
  Tree.existingUidsSet.add(item.uid)
  if (item.type === TreeItemType.WINDOW) Tree.windowsByUid.set(item.uid, item)
  else if (item.type === TreeItemType.NOTE) Tree.notesByUid.set(item.uid, item)
  else if (item.type === TreeItemType.SEPARATOR)
    Tree.separatorsByUid.set(item.uid, item)
  else Tree.tabsByUid.set(item.uid, item)
}

export function printSessionTree(): void {
  console.log('Background Session Tree:', Tree.Items)
}

interface ItemLocation {
  item: TreeItem
  children: TreeItem[]
  index: number
}

interface MoveBlock {
  root: TreeItem
  children: TreeItem[]
  startIndex: number
  items: TreeItem[]
}

/**
 * Gets the item list that should contain new or moved items for a target parent.
 * Handles top-level items, window children, and nested tab or note parents.
 *
 * @param {UID} [parentUid] - Optional UID of the parent window, tab, or note.
 * @param {UID} [targetWindowUid] - Optional UID of the target window when inserting at the window root.
 * @returns {{ children: TreeItem[]; parent?: TreeItem }} The containing item list and resolved parent item.
 */
export function getContainerForParent(
  parentUid?: UID,
  targetWindowUid?: UID,
): {
  children: TreeItem[]
  parent?: TreeItem
} {
  if (!parentUid && targetWindowUid) {
    const window = Tree.windowsByUid.get(targetWindowUid)
    if (window) {
      return { children: window.children as TreeItem[], parent: window }
    }
  }

  if (!parentUid) return { children: Tree.Items as TreeItem[] }

  const parent = getItemByUid(parentUid)
  if (!parent) return { children: Tree.Items as TreeItem[] }

  if (parent.type === TreeItemType.WINDOW) {
    return { children: parent.children as TreeItem[], parent }
  }

  if (parent.type === TreeItemType.TAB) {
    const window = Tree.windowsByUid.get(parent.windowUid)
    return { children: (window?.children ?? []) as TreeItem[], parent }
  }

  if (parent.windowUid) {
    const window = Tree.windowsByUid.get(parent.windowUid)
    return { children: (window?.children ?? []) as TreeItem[], parent }
  }

  return { children: Tree.Items as TreeItem[], parent }
}

/**
 * Finds a tree item by UID across all background lookup maps.
 *
 * @param {UID} uid - The UID of the window, tab, or note to find.
 * @returns {TreeItem | undefined} The matching tree item, or undefined when no item exists.
 */
export function getItemByUid(uid: UID): TreeItem | undefined {
  return (
    Tree.windowsByUid.get(uid) ??
    Tree.tabsByUid.get(uid) ??
    Tree.notesByUid.get(uid) ??
    Tree.separatorsByUid.get(uid)
  )
}

/**
 * Gets the window UID that should be assigned to a child under the given parent.
 *
 * @param {TreeItem} [parent] - Optional parent window, tab, or note.
 * @returns {UID | undefined} The containing window UID, or undefined for top-level items.
 */
export function getWindowUidForParent(parent?: TreeItem): UID | undefined {
  if (!parent) return undefined
  if (parent.type === TreeItemType.WINDOW) return parent.uid
  if (parent.type === TreeItemType.TAB) return parent.windowUid
  return parent.windowUid
}

/**
 * Calculates the insertion index for a new or moved item in a containing list.
 * If no explicit index is provided, inserts after the parent's full descendant subtree.
 *
 * @param {TreeItem[]} children - The containing item list.
 * @param {TreeItem | undefined} parent - Optional parent item for the insertion.
 * @param {number} [index] - Optional requested insertion index.
 * @returns {number} The clamped insertion index in the containing list.
 */
export function getTargetIndex(
  children: TreeItem[],
  parent: TreeItem | undefined,
  index: number | undefined,
): number {
  if (index !== undefined) return Math.max(0, Math.min(index, children.length))
  if (!parent) return children.length

  const parentIndex = children.findIndex((item) => item.uid === parent.uid)
  if (parentIndex === -1) return children.length
  return getSubtreeEndIndex(children, parentIndex)
}

function getSubtreeEndIndex(children: TreeItem[], parentIndex: number): number {
  const parent = children[parentIndex]
  const byUid = new Map(children.map((item) => [item.uid, item] as const))
  let index = parentIndex + 1
  while (
    index < children.length &&
    isDescendantOf(children[index], parent.uid, byUid)
  ) {
    index++
  }
  return index
}

function isDescendantOf(
  item: TreeItem,
  ancestorUid: UID,
  byUid: Map<UID, TreeItem>,
): boolean {
  let parentUid = item.parentUid
  while (parentUid !== undefined) {
    if (parentUid === ancestorUid) return true
    parentUid = byUid.get(parentUid)?.parentUid
  }
  return false
}

/**
 * Checks whether an item has children in the provided containing list.
 *
 * @param {TreeItem} parent - The window, tab, or note to check.
 * @param {TreeItem[]} children - The containing item list to inspect.
 * @returns {boolean} Whether the item currently has child items.
 */
export function hasChildrenInContainer(
  parent: TreeItem,
  children: TreeItem[],
): boolean {
  if (parent.type === TreeItemType.WINDOW) return children.length > 0
  return children.some((item) => item.parentUid === parent.uid)
}

/**
 * Moves one or more tree items to a target list position.
 * Handles windows, tabs, notes, mixed descendants, top-level moves, and window child moves.
 *
 * @param {UID[]} itemUIDs - UIDs of the items to move.
 * @param {number} targetIndex - Index in the target containing list where the items will be inserted.
 * @param {UID} [parentUid] - Optional UID of the parent window, tab, or note.
 * @param {UID} [targetWindowUid] - Optional UID of the target window when moving to the window root.
 * @param {boolean} [copy=false] - Whether to copy the items instead of moving.
 * @param {boolean} [includeDescendants=true] - Whether to move selected items with their descendants.
 */
export async function moveTreeItems(
  itemUIDs: UID[],
  targetIndex: number,
  parentUid?: UID,
  targetWindowUid?: UID,
  copy: boolean = false,
  includeDescendants: boolean = true,
): Promise<void> {
  if (copy) {
    console.warn('moveTreeItems: copy is not implemented')
    return
  }

  if (moveIncludesBrowserBackedTabs(itemUIDs, includeDescendants)) {
    const preparedMove = prepareItemsForBrowserBackedTreeMove(
      itemUIDs,
      parentUid,
      targetWindowUid,
      includeDescendants,
    )
    if (preparedMove.items.length === 0) return
    if (itemsContainBrowserBackedTabs(preparedMove.items)) {
      await moveTreeItemsIncludingTabs(
        preparedMove.items,
        targetIndex,
        preparedMove.parentUid,
        targetWindowUid,
      )
    } else {
      moveNonTabTreeItems(
        itemUIDs,
        targetIndex,
        preparedMove.parentUid,
        targetWindowUid,
        includeDescendants,
      )
    }
    return
  }

  moveNonTabTreeItems(
    itemUIDs,
    targetIndex,
    parentUid,
    targetWindowUid,
    includeDescendants,
  )
}

/**
 * Checks whether a requested tree item move includes live browser-backed tabs.
 *
 * @param {UID[]} itemUIDs - UIDs of the requested move roots.
 * @param {boolean} includeDescendants - Whether descendants should be included in the check.
 * @returns {boolean} Whether the move includes an open or discarded tab.
 */
function moveIncludesBrowserBackedTabs(
  itemUIDs: UID[],
  includeDescendants: boolean,
): boolean {
  const moveBlocks = buildMoveBlocks(itemUIDs)
  return moveBlocks.some((block) => {
    const items = includeDescendants ? block.items : [block.root]
    return itemsContainBrowserBackedTabs(items)
  })
}

/**
 * Checks whether a list of tree items contains open or discarded tabs.
 *
 * @param {TreeItem[]} items - Tree items to inspect.
 * @returns {boolean} Whether any item is backed by a live browser tab.
 */
function itemsContainBrowserBackedTabs(items: TreeItem[]): boolean {
  return items.some(
    (item) =>
      item.type === TreeItemType.TAB &&
      (item.state === State.OPEN || item.state === State.DISCARDED),
  )
}

/**
 * Prepares a browser-backed tree item move without mutating until validation passes.
 * Handles descendant drops, self drops, top-level restrictions, and root-only moves.
 *
 * @param {UID[]} itemUIDs - UIDs of the requested move roots.
 * @param {UID | undefined} parentUid - Requested parent UID for the move.
 * @param {UID | undefined} targetWindowUid - Target window UID for window child moves.
 * @param {boolean} includeDescendants - Whether selected roots should move with descendants.
 * @returns {{ items: TreeItem[]; parentUid: UID | undefined }} Prepared items and effective parent UID.
 */
function prepareItemsForBrowserBackedTreeMove(
  itemUIDs: UID[],
  parentUid: UID | undefined,
  targetWindowUid: UID | undefined,
  includeDescendants: boolean,
): { items: TreeItem[]; parentUid: UID | undefined } {
  let effectiveParentUid = parentUid
  let destination = getContainerForParent(effectiveParentUid, targetWindowUid)
  const moveBlocks = buildMoveBlocks(itemUIDs)
  if (moveBlocks.length === 0)
    return { items: [], parentUid: effectiveParentUid }
  const blocksToMoveWithoutDescendants = new Set<MoveBlock>()

  const movingToTopLevel = !destination.parent && !targetWindowUid
  const destinationParent = destination.parent
  const blocksDroppedOntoDescendants = destinationParent
    ? moveBlocks.filter((block) =>
        isDestinationDescendantOfBlock(destinationParent, block),
      )
    : []
  const blocksDroppedOntoMovedRoots = destinationParent
    ? moveBlocks.filter((block) => destinationParent.uid === block.root.uid)
    : []

  if (
    blocksDroppedOntoDescendants.length > 0 &&
    !Settings.values.allowDropOntoDescendantItems
  ) {
    return { items: [], parentUid: effectiveParentUid }
  }

  if (!includeDescendants) {
    for (const block of moveBlocks) {
      if (destinationParent?.uid === block.root.uid) {
        // Dropping relative to a detached root should use the root's old parent
        // because the root will no longer be a parent of its former children.
        effectiveParentUid = block.root.parentUid
      }
      blocksToMoveWithoutDescendants.add(block)
    }
  } else if (movingToTopLevel) {
    for (const block of moveBlocks) {
      if (blockHasInvalidTopLevelDescendants(block)) {
        // Tabs cannot live at the top level, so keep invalid descendants in
        // their current container and move only the requested root.
        blocksToMoveWithoutDescendants.add(block)
      }
    }
  }
  if (includeDescendants) {
    for (const block of [
      ...blocksDroppedOntoDescendants,
      ...blocksDroppedOntoMovedRoots,
    ]) {
      if (destinationParent?.uid === block.root.uid) {
        // Dropping onto the root itself means "drop relative to where the root
        // used to be" after descendants are detached.
        effectiveParentUid = block.root.parentUid
      }
      blocksToMoveWithoutDescendants.add(block)
    }
  }
  destination = getContainerForParent(effectiveParentUid, targetWindowUid)
  // Validate against the planned root-only blocks before mutating live parent
  // metadata. Rejected browser-backed moves must leave the tree untouched.
  const preparedMoveBlocks = moveBlocks.map((block) =>
    blocksToMoveWithoutDescendants.has(block)
      ? { ...block, items: [block.root] }
      : block,
  )
  const rootsMovedWithoutDescendants = new Set(
    [...blocksToMoveWithoutDescendants].map((block) => block.root.uid),
  )
  if (
    !isValidDestination(
      destination.parent,
      preparedMoveBlocks,
      rootsMovedWithoutDescendants,
    )
  ) {
    return { items: [], parentUid: effectiveParentUid }
  }
  for (const block of blocksToMoveWithoutDescendants) {
    prepareBlockForMoveWithoutDescendants(block)
  }

  return {
    items: preparedMoveBlocks.flatMap((block) => block.items),
    parentUid: effectiveParentUid,
  }
}

/**
 * Moves tree items that do not require browser tab movement.
 * Handles top-level moves, window child moves, and parent metadata updates.
 *
 * @param {UID[]} itemUIDs - UIDs of the items to move.
 * @param {number} targetIndex - Index in the destination list where items should be inserted.
 * @param {UID} [parentUid] - Optional destination parent UID.
 * @param {UID} [targetWindowUid] - Optional target window UID for window child moves.
 * @param {boolean} [includeDescendants=true] - Whether to move roots with their descendants.
 */
function moveNonTabTreeItems(
  itemUIDs: UID[],
  targetIndex: number,
  parentUid?: UID,
  targetWindowUid?: UID,
  includeDescendants: boolean = true,
): void {
  let effectiveParentUid = parentUid
  let destination = getContainerForParent(effectiveParentUid, targetWindowUid)
  const moveBlocks = buildMoveBlocks(itemUIDs)
  if (moveBlocks.length === 0) return
  const movingToTopLevel = !destination.parent && !targetWindowUid
  const destinationParent = destination.parent
  const blocksDroppedOntoDescendants = destinationParent
    ? moveBlocks.filter((block) =>
        isDestinationDescendantOfBlock(destinationParent, block),
      )
    : []

  if (
    blocksDroppedOntoDescendants.length > 0 &&
    !Settings.values.allowDropOntoDescendantItems
  ) {
    return
  }

  if (!includeDescendants) {
    for (const block of moveBlocks) {
      if (destinationParent?.uid === block.root.uid) {
        // Dropping relative to a detached root should use the root's old parent
        // because the root will no longer be a parent of its former children.
        effectiveParentUid = block.root.parentUid
      }
      prepareBlockForMoveWithoutDescendants(block)
    }
  } else if (movingToTopLevel) {
    for (const block of moveBlocks) {
      if (blockHasInvalidTopLevelDescendants(block)) {
        prepareBlockForMoveWithoutDescendants(block)
      }
    }
  }
  if (includeDescendants) {
    for (const block of blocksDroppedOntoDescendants) {
      if (destinationParent?.uid === block.root.uid) {
        effectiveParentUid = block.root.parentUid
      }
      prepareBlockForMoveWithoutDescendants(block)
    }
  }
  destination = getContainerForParent(effectiveParentUid, targetWindowUid)
  if (!isValidDestination(destination.parent, moveBlocks)) return

  let adjustedTargetIndex = Math.max(
    0,
    Math.min(targetIndex, destination.children.length),
  )

  const removalBlocks = [...moveBlocks].sort((a, b) => {
    if (a.children === b.children) return b.startIndex - a.startIndex
    return 0
  })
  const emptiedSourceWindows = new Set<Window>()

  for (const block of removalBlocks) {
    const sourceWindow =
      block.root.type !== TreeItemType.WINDOW && block.root.windowUid
        ? Tree.windowsByUid.get(block.root.windowUid)
        : undefined
    if (
      block.children === destination.children &&
      block.startIndex < adjustedTargetIndex
    ) {
      adjustedTargetIndex -= block.items.length
    }
    block.children.splice(block.startIndex, block.items.length)
    const oldParent = block.root.parentUid
      ? getItemByUid(block.root.parentUid)
      : undefined
    if (oldParent)
      oldParent.isParent = hasChildrenInContainer(oldParent, block.children)
    if (
      sourceWindow &&
      sourceWindow.children !== destination.children &&
      sourceWindow.children.length === 0
    ) {
      emptiedSourceWindows.add(sourceWindow)
    }
  }

  const movingItems = moveBlocks.flatMap((block) => block.items)
  destination.children.splice(adjustedTargetIndex, 0, ...movingItems)

  for (const block of moveBlocks) {
    updateMovedBlockHierarchy(block.items, destination.parent, targetWindowUid)
  }
  if (destination.parent) destination.parent.isParent = true
  for (const window of emptiedSourceWindows) {
    Tree.removeWindow(window.uid)
  }

  Tree.recomputeSessionTree(false)
  emitTreeDelta({
    op: 'treeReplaced',
    treeItems: structuredClone(Tree.Items),
  })
}

/**
 * Moves tree items when the requested move includes live browser-backed tabs.
 * Uses browser tab movement for tabs and then replays non-tab items into place.
 *
 * @param {TreeItem[]} requestedItems - Prepared items to move.
 * @param {number} targetIndex - Index in the target window child list.
 * @param {UID | undefined} parentUid - Effective parent UID for moved root items.
 * @param {UID | undefined} targetWindowUid - Target window UID for the move.
 */
async function moveTreeItemsIncludingTabs(
  requestedItems: TreeItem[],
  targetIndex: number,
  parentUid: UID | undefined,
  targetWindowUid: UID | undefined,
): Promise<void> {
  if (requestedItems.length === 0) return
  if (!targetWindowUid) {
    console.error('moveTreeItems: target window is required when moving tabs')
    return
  }

  const targetWindow = Tree.windowsByUid.get(targetWindowUid)
  if (!targetWindow) {
    console.error(
      `moveTreeItems: Target window with UID ${targetWindowUid} not found`,
    )
    return
  }

  let tabTargetIndex = targetIndex
  if (tabTargetIndex < 0 || tabTargetIndex > targetWindow.children.length) {
    console.error(
      `moveTreeItems: Invalid target index ${targetIndex} for window ${targetWindowUid}`,
    )
    tabTargetIndex = targetWindow.children.length
  }

  const movedItemUids = new Set(requestedItems.map((item) => item.uid))
  const originalParentUidByUid = new Map(
    requestedItems.map((item) => [item.uid, item.parentUid] as const),
  )
  const originalOrderByUid = new Map(
    requestedItems.map((item, index) => [item.uid, index] as const),
  )
  const tabs = requestedItems
    .filter((item): item is Tab => item.type === TreeItemType.TAB)
    .sort(compareTabsByTreeOrder)
  const nonTabItems = requestedItems.filter(
    (item) => item.type !== TreeItemType.TAB,
  )

  const newUidMapping: Map<UID, UID> = new Map()
  const updatedWindows: Set<UID> = new Set([targetWindowUid])

  for (const tab of tabs) {
    updatedWindows.add(tab.windowUid)
    const isPinned = tab.pinned || false
    let originalTargetIndex = tabTargetIndex
    let targetIndexAdjusted = false
    if (isPinned) {
      const lastPinnedIndex = targetWindow.children.findLastIndex(
        (item) => item.type === TreeItemType.TAB && item.pinned,
      )
      if (lastPinnedIndex + 1 < tabTargetIndex) {
        tabTargetIndex = lastPinnedIndex + 1
        targetIndexAdjusted = true
      }
    } else {
      const lastPinnedIndex = targetWindow.children.findLastIndex(
        (item) => item.type === TreeItemType.TAB && item.pinned,
      )
      if (lastPinnedIndex !== -1 && tabTargetIndex <= lastPinnedIndex) {
        tabTargetIndex = lastPinnedIndex + 1
        targetIndexAdjusted = true
      }
    }

    const sourceIndex = targetWindow.children.findIndex(
      (item) => item.uid === tab.uid,
    )
    if (tab.windowUid === targetWindowUid && sourceIndex < tabTargetIndex) {
      // Moving downward inside the same window shifts the browser target left
      // once the source tab is removed.
      tabTargetIndex--
    }

    let newParentUid: UID | undefined = undefined
    if (
      Settings.values.tryToMaintainHierarchyOfDraggedItems &&
      originalParentUidByUid.get(tab.uid) &&
      newUidMapping.has(originalParentUidByUid.get(tab.uid) as UID)
    ) {
      newParentUid = newUidMapping.get(
        originalParentUidByUid.get(tab.uid) as UID,
      )
    }

    const newTabUid = await Tree.moveTab(
      tab.uid,
      targetWindowUid,
      tabTargetIndex,
      targetIndexAdjusted ? undefined : (newParentUid ?? parentUid),
      false,
      false,
    )
    if (newTabUid) newUidMapping.set(tab.uid, newTabUid)
    if (targetIndexAdjusted) {
      if (tabTargetIndex <= originalTargetIndex) originalTargetIndex++
      if (
        tab.windowUid === targetWindowUid &&
        sourceIndex < originalTargetIndex
      ) {
        originalTargetIndex--
      }
      tabTargetIndex = originalTargetIndex
    } else {
      tabTargetIndex++
    }
  }

  Tree.recomputeSessionTree(false)

  if (Settings.values.tryToMaintainCollapsedStateOfDraggedItems) {
    for (const tab of tabs) {
      if (!tab.collapsed) continue
      const newTabUid = newUidMapping.get(tab.uid)
      if (!newTabUid) continue
      const newTab = Tree.tabsByUid.get(newTabUid)
      if (!newTab) continue
      if (newTab.isParent) Tree.toggleCollapseTab(newTabUid, false)
    }
  }

  nonTabItems.forEach((item, index) => {
    const currentItem = getItemByUid(item.uid)
    if (!currentItem) return
    // Tabs are moved first through the browser API. Non-tabs are replayed
    // afterward at their original relative positions in the requested block.
    moveNonTabTreeItems(
      [currentItem.uid],
      targetIndex + (originalOrderByUid.get(item.uid) ?? tabs.length + index),
      getMovedTreeItemParentUid(
        originalParentUidByUid.get(currentItem.uid),
        movedItemUids,
        parentUid,
      ),
      targetWindowUid,
      false,
    )
  })

  for (const windowUid of updatedWindows) {
    const window = Tree.windowsByUid.get(windowUid)
    if (window) {
      emitTreeDelta({
        op: 'windowUpdated',
        window: structuredClone(window),
      })
    }
  }
}

/**
 * Resolves the parent UID for a moved non-tab item after tab roots are moved.
 *
 * @param {UID | undefined} originalParentUid - The item's parent UID before the move.
 * @param {Set<UID>} movedItemUids - UIDs included in the current move.
 * @param {UID | undefined} dropParentUid - Parent UID requested by the drop target.
 * @returns {UID | undefined} The parent UID to use for the moved item.
 */
function getMovedTreeItemParentUid(
  originalParentUid: UID | undefined,
  movedItemUids: Set<UID>,
  dropParentUid: UID | undefined,
): UID | undefined {
  return originalParentUid && movedItemUids.has(originalParentUid)
    ? originalParentUid
    : dropParentUid
}

/**
 * Compares tabs by their current order in the session tree.
 * Tabs in earlier top-level windows sort before tabs in later windows.
 *
 * @param {Tab} a - First tab to compare.
 * @param {Tab} b - Second tab to compare.
 * @returns {number} Sort order by window and child index.
 */
function compareTabsByTreeOrder(a: Tab, b: Tab): number {
  const winIndexA = Tree.Items.findIndex((item) => item.uid === a.windowUid)
  const winIndexB = Tree.Items.findIndex((item) => item.uid === b.windowUid)
  if (winIndexA === -1 || winIndexB === -1) return 0
  if (winIndexA !== winIndexB) return winIndexA - winIndexB

  const window = Tree.windowsByUid.get(a.windowUid)
  if (!window) return 0
  const indexA = window.children.findIndex((item) => item.uid === a.uid)
  const indexB = window.children.findIndex((item) => item.uid === b.uid)
  if (indexA === -1 || indexB === -1) return 0
  return indexA - indexB
}

export function duplicateTreeItems(itemUIDs: UID[]): void {
  const openTabUids = new Set(
    itemUIDs.filter((uid) => {
      const tab = Tree.tabsByUid.get(uid)
      return tab?.state === State.OPEN
    }),
  )
  for (const uid of openTabUids) {
    const tab = Tree.tabsByUid.get(uid)
    if (tab) Tree.duplicateTab({ tabId: tab.id, tabUid: tab.uid })
  }

  const moveBlocks = buildMoveBlocks(
    itemUIDs.filter((uid) => !openTabUids.has(uid)),
  )
  if (moveBlocks.length === 0) return

  const insertionBlocks = [...moveBlocks].sort((a, b) => {
    if (a.children === b.children) return b.startIndex - a.startIndex
    return 0
  })

  for (const block of insertionBlocks) {
    const duplicates = cloneTreeItemBlock(block.items)
    block.children.splice(
      block.startIndex + block.items.length,
      0,
      ...duplicates,
    )
  }

  Tree.recomputeSessionTree(false)
  emitTreeDelta({
    op: 'treeReplaced',
    treeItems: structuredClone(Tree.Items),
  })
}

export async function treeItemIndentIncrease(itemUIDs: UID[]): Promise<void> {
  const separatorUids: UID[] = []

  for (const uid of itemUIDs) {
    const location = findItemLocation(uid)
    if (!location) continue

    if (location.item.type === TreeItemType.SEPARATOR) {
      separatorUids.push(uid)
      continue
    }
    if (location.index === 0) continue

    const previous = findPreviousSiblingAtSameIndent(
      location.children,
      location.index,
      location.item.indentLevel ?? 0,
    )
    if (!previous || previous.type === TreeItemType.SEPARATOR) continue

    const targetWindowUid =
      previous.type === TreeItemType.WINDOW
        ? previous.uid
        : Tree.getWindowUidForParent(previous)
    const targetIndex =
      previous.type === TreeItemType.WINDOW
        ? previous.children.length
        : location.index

    await Tree.moveTreeItems(
      [uid],
      targetIndex,
      previous.uid,
      targetWindowUid,
      false,
      includeChildrenWhenIndenting(location.item),
    )
  }

  if (separatorUids.length) Tree.separatorIndentIncrease(separatorUids)
}

export async function treeItemIndentDecrease(itemUIDs: UID[]): Promise<void> {
  for (const uid of itemUIDs) {
    const location = findItemLocation(uid)
    if (!location) continue

    if (location.item.parentUid) {
      await decreaseItemFromParent(
        location.item,
        includeChildrenWhenIndenting(location.item),
      )
    } else if (
      location.item.type !== TreeItemType.WINDOW &&
      location.item.windowUid
    ) {
      await decreaseItemFromWindowRoot(
        location.item,
        includeChildrenWhenIndenting(location.item),
      )
    }
  }
}

function includeChildrenWhenIndenting(item: TreeItem): boolean {
  const setting = Settings.values.includeChildrenOfSelectedItemsWhenIndenting
  if (setting === 'always') return true
  if (setting === 'never') return false
  return item.collapsed === true
}

function cloneTreeItemBlock(items: TreeItem[]): TreeItem[] {
  const uidMap = new Map<UID, UID>()
  for (const item of items) {
    reserveCloneUid(item, uidMap)
  }
  return items.map((item) => cloneTreeItem(item, uidMap))
}

function reserveCloneUid(item: TreeItem, uidMap: Map<UID, UID>): void {
  uidMap.set(item.uid, Utils.createUid(Tree.existingUidsSet))
  if (item.type === TreeItemType.WINDOW) {
    for (const child of item.children) reserveCloneUid(child, uidMap)
  }
}

function cloneTreeItem<T extends TreeItem>(item: T, uidMap: Map<UID, UID>): T {
  const clone = structuredClone(item) as T
  applyClonedTreeItemIdentity(clone, item, uidMap)
  registerClonedTreeItem(clone)
  return clone
}

function applyClonedTreeItemIdentity(
  clone: TreeItem,
  source: TreeItem,
  uidMap: Map<UID, UID>,
): void {
  clone.uid = uidMap.get(source.uid)!
  clone.selected = false
  clone.parentUid = source.parentUid
    ? (uidMap.get(source.parentUid) ?? source.parentUid)
    : undefined

  if (
    clone.type === TreeItemType.WINDOW &&
    source.type === TreeItemType.WINDOW
  ) {
    clone.id = -1
    clone.state = State.SAVED
    clone.active = false
    clone.activeTabId = undefined
    clone.children.forEach((child, index) => {
      applyClonedTreeItemIdentity(child, source.children[index], uidMap)
      child.windowUid = clone.uid
    })
    return
  }

  if (clone.type === TreeItemType.TAB) {
    clone.id = -1
    clone.state = State.SAVED
    clone.active = false
  }
}

function registerClonedTreeItem(item: TreeItem): void {
  Tree.existingUidsSet.add(item.uid)
  if (item.type === TreeItemType.WINDOW) {
    Tree.windowsByUid.set(item.uid, item)
    for (const child of item.children) registerClonedTreeItem(child)
  } else if (item.type === TreeItemType.TAB) {
    Tree.tabsByUid.set(item.uid, item)
  } else if (item.type === TreeItemType.NOTE) {
    Tree.notesByUid.set(item.uid, item)
  } else {
    Tree.separatorsByUid.set(item.uid, item)
  }
}

function findPreviousSiblingAtSameIndent(
  items: TreeItem[],
  index: number,
  indentLevel: number,
): TreeItem | undefined {
  for (let i = index - 1; i >= 0; i--) {
    const itemIndent = items[i].indentLevel ?? 0
    if (itemIndent === indentLevel) return items[i]
    if (itemIndent < indentLevel) return undefined
  }
  return undefined
}

async function decreaseItemFromParent(
  item: TreeItem,
  includeDescendants: boolean,
): Promise<void> {
  if (!item.parentUid) return
  const parent = getItemByUid(item.parentUid)
  if (!parent) return
  const parentLocation = findItemLocation(parent.uid)
  if (!parentLocation) return

  const targetIndex = getSubtreeEndIndex(
    parentLocation.children,
    parentLocation.index,
  )
  const targetWindowUid =
    parent.type === TreeItemType.WINDOW
      ? parent.uid
      : Tree.getWindowUidForParent(parent)
  const newParentUid =
    parent.type === TreeItemType.WINDOW ? undefined : parent.parentUid

  await Tree.moveTreeItems(
    [item.uid],
    targetIndex,
    newParentUid,
    targetWindowUid,
    false,
    includeDescendants,
  )
}

async function decreaseItemFromWindowRoot(
  item: TreeItem,
  includeDescendants: boolean,
): Promise<void> {
  if (
    item.type !== TreeItemType.TAB &&
    item.type !== TreeItemType.NOTE &&
    item.type !== TreeItemType.SEPARATOR
  ) {
    return
  }
  if (!item.windowUid) return
  const window = Tree.windowsByUid.get(item.windowUid)
  if (!window) return
  const windowLocation = findItemLocation(window.uid)
  if (!windowLocation) return

  await Tree.moveTreeItems(
    [item.uid],
    getSubtreeEndIndex(windowLocation.children, windowLocation.index),
    window.parentUid,
    undefined,
    false,
    includeDescendants,
  )
}

function buildMoveBlocks(itemUIDs: UID[]): MoveBlock[] {
  const selected = new Set(itemUIDs)
  const locations = itemUIDs
    .map((uid) => findItemLocation(uid))
    .filter((location): location is ItemLocation => Boolean(location))
    .filter((location) => !hasSelectedAncestor(location.item, selected))

  locations.sort((a, b) => {
    if (a.children === b.children) return a.index - b.index
    return 0
  })

  return locations.map((location) => {
    const endIndex = getSubtreeEndIndex(location.children, location.index)
    return {
      root: location.item,
      children: location.children,
      startIndex: location.index,
      items: location.children.slice(location.index, endIndex),
    }
  })
}

function prepareBlockForMoveWithoutDescendants(block: MoveBlock): void {
  if (block.root.type === TreeItemType.WINDOW || block.items.length <= 1) {
    return
  }

  const oldParentUid = block.root.parentUid
  for (const item of block.items.slice(1)) {
    if (item.parentUid === block.root.uid) {
      item.parentUid = oldParentUid
    }
  }
  block.root.isParent = false
  block.root.collapsed = false
  block.items = [block.root]
}

function blockHasInvalidTopLevelDescendants(block: MoveBlock): boolean {
  return block.items
    .slice(1)
    .some(
      (item) =>
        item.type !== TreeItemType.WINDOW &&
        item.type !== TreeItemType.NOTE &&
        item.type !== TreeItemType.SEPARATOR,
    )
}

/**
 * Checks whether a destination parent is inside a move block.
 *
 * @param {TreeItem} parent - Destination parent item.
 * @param {MoveBlock} block - Move block to inspect.
 * @returns {boolean} Whether the destination parent is a descendant of the block root.
 */
function isDestinationDescendantOfBlock(
  parent: TreeItem,
  block: MoveBlock,
): boolean {
  const byUid = new Map(block.children.map((item) => [item.uid, item] as const))
  return isDescendantOf(parent, block.root.uid, byUid)
}

function hasSelectedAncestor(item: TreeItem, selected: Set<UID>): boolean {
  let parentUid = item.parentUid
  while (parentUid !== undefined) {
    if (selected.has(parentUid)) return true
    parentUid = getItemByUid(parentUid)?.parentUid
  }
  return false
}

/**
 * Finds the containing list and index for an item in the background session tree.
 * Searches top-level items first, then each window's child item list.
 *
 * @param {UID} uid - The UID of the item to locate.
 * @returns {ItemLocation | undefined} The item location, or undefined when the item is not found.
 */
export function findItemLocation(uid: UID): ItemLocation | undefined {
  const topLevelItems = Tree.Items as TreeItem[]
  const topLevelIndex = topLevelItems.findIndex((item) => item.uid === uid)
  if (topLevelIndex !== -1) {
    return {
      item: topLevelItems[topLevelIndex],
      children: topLevelItems,
      index: topLevelIndex,
    }
  }

  for (const window of Tree.windowsByUid.values()) {
    const children = window.children as TreeItem[]
    const index = children.findIndex((item) => item.uid === uid)
    if (index !== -1) return { item: children[index], children, index }
  }
  return undefined
}

function isValidDestination(
  parent: TreeItem | undefined,
  moveBlocks: MoveBlock[],
  rootsMovedWithoutDescendants: Set<UID> = new Set(),
) {
  const movingItems = moveBlocks.flatMap((block) => block.items)

  if (!parent) {
    return movingItems.every(
      (item) =>
        item.type === TreeItemType.WINDOW ||
        item.type === TreeItemType.NOTE ||
        item.type === TreeItemType.SEPARATOR,
    )
  }

  if (
    moveBlocks.some((block) => {
      if (parent.uid === block.root.uid) return true
      if (rootsMovedWithoutDescendants.has(block.root.uid)) return false
      const location = findItemLocation(parent.uid)
      if (!location) return false
      const byUid = new Map(
        location.children.map((child) => [child.uid, child] as const),
      )
      return isDescendantOf(parent, block.root.uid, byUid)
    })
  ) {
    return false
  }

  if (parent.type === TreeItemType.WINDOW) {
    return movingItems.every(
      (item) =>
        item.type === TreeItemType.TAB ||
        item.type === TreeItemType.NOTE ||
        item.type === TreeItemType.SEPARATOR,
    )
  }

  if (parent.type === TreeItemType.NOTE && !parent.windowUid) {
    return movingItems.every(
      (item) =>
        item.type === TreeItemType.WINDOW ||
        item.type === TreeItemType.NOTE ||
        item.type === TreeItemType.SEPARATOR,
    )
  }

  if (parent.type === TreeItemType.SEPARATOR) {
    return false
  }

  return movingItems.every(
    (item) =>
      item.type === TreeItemType.TAB ||
      item.type === TreeItemType.NOTE ||
      item.type === TreeItemType.SEPARATOR,
  )
}

function updateMovedBlockHierarchy(
  items: TreeItem[],
  parent: TreeItem | undefined,
  targetWindowUid: UID | undefined,
): void {
  const root = items[0]
  const oldRootIndent = root.indentLevel ?? 0
  const newRootIndent = parent ? (parent.indentLevel ?? 0) + 1 : 0
  const indentDelta = newRootIndent - oldRootIndent
  const windowUid = getMovedItemWindowUid(parent, targetWindowUid)

  root.parentUid =
    parent?.type === TreeItemType.WINDOW ? undefined : parent?.uid
  for (const item of items) {
    item.indentLevel = (item.indentLevel ?? 0) + indentDelta
    updateItemWindowUid(item, windowUid)
  }
}

function getMovedItemWindowUid(
  parent: TreeItem | undefined,
  targetWindowUid: UID | undefined,
): UID | undefined {
  if (parent?.type === TreeItemType.WINDOW) return parent.uid
  if (parent?.type === TreeItemType.TAB) return parent.windowUid
  if (targetWindowUid) return targetWindowUid
  if (parent?.type === TreeItemType.NOTE) return parent.windowUid
  return undefined
}

function updateItemWindowUid(item: TreeItem, windowUid: UID | undefined): void {
  if (
    item.type === TreeItemType.TAB ||
    item.type === TreeItemType.NOTE ||
    item.type === TreeItemType.SEPARATOR
  ) {
    item.windowUid = windowUid as UID
  } else if (item.type === TreeItemType.WINDOW) {
    updateNestedWindowChildren(item, item.uid)
  }
}

function updateNestedWindowChildren(window: Window, windowUid: UID): void {
  for (const child of window.children) {
    child.windowUid = windowUid
  }
}
