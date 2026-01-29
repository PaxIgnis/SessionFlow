import { Browser } from '@/services/background-browser'
import { DeferredEventsQueue } from '@/services/background-deferred-events-queue'
import { OnCreatedQueue } from '@/services/background-on-created-queue'
import { Tree } from '@/services/background-tree'
import { Settings } from '@/services/settings'
import * as TreeUtils from '@/services/tree-utils'
import * as Utils from '@/services/utils'
import { State, Tab } from '@/types/session-tree'

/**
 * Adds a tab to the session tree.
 *
 * @param {boolean} active - Whether the tab is active.
 * @param {UID} windowUID - The UID of the window containing the tab.
 * @param {number} tabId - The ID of the tab to add.
 * @param {boolean} selected - Whether the tab is selected.
 * @param {State} state - The state of the tab.
 * @param {string} title - The title of the tab.
 * @param {string} url - The URL of the tab.
 * @param {boolean} pinned - Whether the tab is pinned.
 * @param {number} index - The index to insert the tab at, if not provided the tab is added to the end.
 * @param {UID} parentUid - The UID of the parent tab, if any.
 * @param {UID} tabUid - The UID of the tab, if passed it is expected to be unique.
 */
export function addTab(
  active: boolean,
  windowUID: UID,
  tabId: number,
  selected: boolean,
  state: State,
  title: string,
  url: string,
  pinned: boolean,
  index?: number,
  parentUid?: UID,
  tabUid?: UID,
): UID | void {
  console.log('Tab Added in background.ts', windowUID, tabId, title, url)
  const tabExists = Tree.tabsByUid.get(tabUid ?? '')
  if (tabExists) {
    console.error(
      'Error adding tab, tab with uid already exists:',
      tabExists.uid,
    )
    return
  }
  const window = Tree.windowsByUid.get(windowUID)
  if (!window) {
    console.error('Error adding tab, could not find window:', windowUID)
    return
  }
  const tab: Tab = {
    uid: tabUid ?? Utils.createUid(Tree.existingUidsSet),
    active: active,
    id: tabId,
    selected: selected,
    state: state,
    title: title,
    url: url,
    windowUid: window.uid,
    isParent: false,
    indentLevel: 1,
    pinned: pinned,
  }
  if (index !== undefined) {
    // if parentUid is provided, insert as child tab
    if (parentUid) {
      const parent = Tree.tabsByUid.get(parentUid)
      const siblingTabCount = window.tabs.filter(
        (tab) => tab.parentUid === parentUid,
      ).length

      // if this is the first child tab, set parent tab's isParent to true
      if (siblingTabCount === 0 && parent) parent.isParent = true

      tab.parentUid = parent?.uid
      // set indent level one more than parent, or default to 1
      tab.indentLevel = parent?.indentLevel ? parent?.indentLevel + 1 : 1
    } else {
      // else match indent level and parentUid of the tab to the right
      const tabToRight = window.tabs[index]

      tab.parentUid = tabToRight?.parentUid
      tab.indentLevel = tabToRight?.indentLevel ?? 1
    }

    window.tabs.splice(index, 0, tab)
  } else {
    // add to end of tree
    tab.indentLevel = 1
    window.tabs.push(tab)
  }
  // TODO: can use tab object instead when independent data source for foreground context implemented
  Tree.tabsByUid.set(tab.uid, window.tabs[window.tabs.indexOf(tab)])
  Tree.recomputeSessionTree()
  DeferredEventsQueue.processDeferredTabEvents(tabId)
  return tab.uid
}

/**
 * Removes a tab from the session tree.
 *
 * @param {UID} tabUid - The UID of the tab to be removed.
 */
export function removeTab(tabUid: UID): void {
  const tab = Tree.tabsByUid.get(tabUid)
  if (!tab) {
    console.error('Error removing tab, could not find tab:', tabUid)
    return
  }
  const window = Tree.windowsByUid.get(tab.windowUid)
  if (!window) {
    console.error('Error removing tab, could not find window:', tab.windowUid)
    return
  }
  const index = window.tabs.findIndex((tab) => tab.uid === tabUid)
  if (index === -1) {
    console.error('Error removing tab, could not find tab:', tabUid)
    return
  }

  // before removing the tab, adjust the indent levels and parentUid of its children

  const parentTab = tab.parentUid
    ? Tree.tabsByUid.get(tab.parentUid)
    : undefined
  const childrenMap = TreeUtils.buildChildrenMap(window.tabs)
  const directChildren = childrenMap.get(tab.uid) || []
  const siblings = childrenMap.get(tab.parentUid as UID) || []

  if (directChildren.length === 0 && siblings.length === 1 && parentTab) {
    // if no children and no siblings, remove parent status from parent tab
    parentTab.isParent = false
  } else if (directChildren.length > 0) {
    for (const child of directChildren) {
      child.parentUid = tab.parentUid
    }
    decreaseIndentRecursively(directChildren, childrenMap)
  }

  Tree.existingUidsSet.delete(tab.uid)
  Tree.tabsByUid.delete(tab.uid)
  window.tabs.splice(index, 1)
  // if this was the last tab in the window, remove the window
  if (window.tabs.length === 0) {
    Tree.removeWindow(window.uid)
  }
  Tree.recomputeSessionTree()
}

/**
 * Updates all shallow properties of a tab in the session tree.
 * Note: does not update nested objects within the tab.
 *
 * @param {Object} id - An object containing EITHER the (windowId and tabId) OR (tabUid) of the tab to be updated.
 * @param {Partial<Tab>} tabContents - An object containing the updated properties for the tab.
 */
export function updateTab(
  id: { windowId?: number; tabId?: number; tabUid?: UID },
  tabContents: Partial<Tab>,
): void {
  let tab: Tab | undefined = undefined
  if (id.tabUid) {
    tab = Tree.tabsByUid.get(id.tabUid)
    if (!tab) return
  } else {
    if (!id.windowId || !id.tabId) {
      console.error('Error updating tab, invalid id:', id)
      return
    }

    const window = Tree.windowsList.find((w) => w.id === id.windowId)
    if (!window) {
      DeferredEventsQueue.addDeferredWindowEvent(id.windowId, () =>
        Tree.updateTab(id, tabContents),
      )
      return
    }
    tab = window.tabs.find((t) => t.id === id.tabId) as Tab
    if (!tab) {
      DeferredEventsQueue.addDeferredTabEvent(id.tabId, () =>
        Tree.updateTab(id, tabContents),
      )
      return
    }
  }
  if (tabContents.pinned !== undefined && tabContents.pinned)
    Tree.pinTabInTree(tab.uid)
  if (tabContents.pinned !== undefined && !tabContents.pinned)
    Tree.unpinTabInTree(tab.uid)
  // If the tab object exists update the new values
  Object.assign(tab, tabContents)
}

/**
 * Updates the id of a tab in the session tree
 *
 * @param {UID} tabUid - The UID of the tab to be updated.
 * @param {number} newTabId - The new ID to assign to the tab.
 */
export function updateTabId(tabUid: UID, newTabId: number): void {
  const tab = Tree.tabsByUid.get(tabUid)
  if (tab) {
    tab.id = newTabId
  }
  DeferredEventsQueue.processDeferredTabEvents(newTabId)
}

/**
 * Updates the state of a tab in the session tree.
 *
 * @param {UID} tabUid - The UID of the tab to update.
 * @param {State} state - The new state to assign to the tab.
 */
export function updateTabState(tabUid: UID, state: State): void {
  const tab = Tree.tabsByUid.get(tabUid)
  if (tab) {
    tab.state = state
    if (state === State.SAVED) {
      tab.savedTime = Date.now()
    }
  }
}

/**
 * Sets the state of the tab to SAVED and resets the ID.
 *
 * @param {UID} tabUid - The UID of the tab to save.
 */
export function setTabSaved(tabUid: UID): void {
  const tab = Tree.tabsByUid.get(tabUid)
  if (tab) {
    tab.state = State.SAVED
    tab.id = -1
    tab.savedTime = Date.now()
    tab.active = false
  }
}

/**
 * Updates active tab status in session tree
 */
export function tabOnActivated(
  activeInfo: browser.tabs._OnActivatedActiveInfo,
  tries: number = 0,
): void {
  const window = Tree.windowsList.find((w) => w.id === activeInfo.windowId)
  const activeTab = Tree.windowsList
    .find((w) => w.id === activeInfo.windowId)
    ?.tabs.find((t) => t.id === activeInfo.tabId)
  const previousActiveTab = Tree.windowsList
    .find((w) => w.id === activeInfo.windowId)
    ?.tabs.find((t) => t.id === activeInfo.previousTabId)
  // remove active status from previous active tab (not when detached/attached)
  if (activeInfo.previousTabId !== activeInfo.tabId && previousActiveTab) {
    previousActiveTab.active = false
  }
  // if window or activeTab is undefined, wait and try again
  if (!window || !activeTab) {
    if (tries > 0) {
      setTimeout(() => {
        tabOnActivated(activeInfo, tries - 1)
      }, 100)
    }
    return
  }
  window.activeTabId = activeInfo.tabId
  activeTab.active = true
}

/**
 * Returns the title of a tab in the session tree.
 *
 * @param {UID} tabUid - The UID of the tab to get the title of.
 * @returns {string} The title of the tab, or an empty string if not found.
 */
export function getTabTitle(tabUid: UID): string {
  const tab = Tree.tabsByUid.get(tabUid)
  if (tab) {
    return tab.title
  }
  return ''
}

/**
 * Returns the state of a tab in the session tree.
 *
 * @param {UID} tabUid - The UID of the tab to get the state of.
 * @returns {State} The state of the tab.
 */
export function getTabState(tabUid: UID): State {
  const tab = Tree.tabsByUid.get(tabUid)
  if (tab) {
    return tab.state
  }
  return State.OTHER
}

/**
 * Closes a tab by removing it from the browser and removing it from the session tree.
 *
 * @param {Object} message - The message object containing tab and window information.
 * @param {number} message.tabId - The ID of the tab to be closed.
 * @param {UID} message.tabUid - The UID of the tab to be closed.
 */
export function closeTab(message: { tabId: number; tabUid: UID }): void {
  if (message.tabUid !== undefined) {
    const tab = Tree.tabsByUid.get(message.tabUid)
    if (!tab) {
      console.error('Error closing tab, could not find tab:', message.tabUid)
      return
    }
    const window = Tree.windowsByUid.get(tab.windowUid)
    Tree.removeTab(message.tabUid)
    // if this is the last open tab in the window but there are other saved tabs then
    // update the window state to SAVED and reset id
    if (window) {
      const openTabs = window.tabs.filter(
        (tab) => tab.state === State.OPEN || tab.state === State.DISCARDED,
      )
      if (window.tabs.length > 0 && openTabs.length === 0) {
        Tree.updateWindowState(window.uid, State.SAVED)
        Tree.updateWindowId(window.uid, -1)
      } else if (window.tabs.length === 0) {
        // if there are no tabs left in the window, remove the window
        Tree.removeWindow(window.uid)
      }
    }
  }
  // only close the tab if it is open
  if (message.tabId === -1 || message.tabId === 0) {
    return
  }
  browser.tabs
    .get(message.tabId)
    .then((tab) => {
      if (tab !== undefined) {
        browser.tabs.remove(message.tabId)
      }
    })
    .catch((error) => {
      console.debug('Error closing tab:', error)
    })
}

/**
 * Opens a tab by creating it in the browser and updating the session tree.
 *
 * @param {Object} message - The message object containing tab and window information.
 * @param {UID} message.tabUid - The UID of the tab to be opened.
 * @param {UID} message.windowUid - The UID of the window containing the tab.
 * @param {string} message.url - The URL to be opened in the tab.
 * @param {boolean} message.discarded - Whether the tab should be opened as discarded.
 */
export async function openTab(message: {
  tabUid: UID
  windowUid: UID
  url?: string
  discarded?: boolean
}): Promise<void> {
  const sessionTreeWindow = Tree.windowsByUid.get(message.windowUid)
  if (!sessionTreeWindow) {
    throw new Error('Saved window not found')
  }
  const sessionTreeTab = Tree.tabsByUid.get(message.tabUid)
  if (!sessionTreeTab) {
    throw new Error('Saved tab not found')
  }
  const pinned = sessionTreeTab.pinned || false
  if (pinned) message.discarded = false // pinned tabs cannot be opened as discarded with firefox api
  let url = message.url
  if (url === undefined) url = sessionTreeTab.url
  // if the URL is a privileged URL, open a redirect page instead
  if (Utils.isPrivilegedUrl(url)) {
    const title = Tree.getTabTitle(message.tabUid)
    url = Utils.getRedirectUrl(url, title)
  } else if (
    url === 'about:newtab' ||
    url === 'about:blank' ||
    url === 'chrome://browser/content/blanktab.html'
  ) {
    // don't set the URL for new tabs
    url = undefined
  }
  Tree.updateTabState(
    message.tabUid,
    message.discarded ? State.DISCARDED : State.OPEN,
  )
  if (sessionTreeWindow.state === State.SAVED) {
    // if the window is saved, open the window first
    Tree.updateWindowState(message.windowUid, State.OPEN)
    const properties: browser.windows._CreateCreateData = {}
    if (url) properties.url = url
    if (
      Settings.values.openWindowsInSameLocation &&
      sessionTreeWindow.windowPosition
    ) {
      properties.left = sessionTreeWindow.windowPosition.left
      properties.top = sessionTreeWindow.windowPosition.top
      properties.width = sessionTreeWindow.windowPosition.width
      properties.height = sessionTreeWindow.windowPosition.height
    }
    try {
      const window = await OnCreatedQueue.createWindowAndWait(properties).catch(
        (error) => {
          console.error('Error creating window:', error)
          // revert changes since window wasn't created
          Tree.updateWindowState(message.windowUid, State.SAVED)
          Tree.updateTabState(message.tabUid, State.SAVED)
          return
        },
      )
      if (!window) {
        console.error('Window is undefined')
        return
      }
      // because Firefox doesn't support opening unfocused windows, we send focus back
      if (!Settings.values.focusWindowOnOpen && Tree.sessionTreeWindowId) {
        Browser.focusWindow({ windowId: Tree.sessionTreeWindowId })
      }
      if (!window.id) {
        throw new Error('Window ID is undefined')
      }
      // then update the saved window object id to represent the newly opened window
      Tree.updateWindowId(message.windowUid, window.id)
      const tab = window.tabs![0]
      Tree.updateTabId(message.tabUid, tab.id!)
      Tree.updateTabState(message.tabUid, State.OPEN)
      if (pinned) Browser.pinTab(tab.id!)
    } catch (error) {
      console.error('Error opening window:', error)
    }
  } else {
    const properties: browser.tabs._CreateCreateProperties = {}
    if (url) properties.url = url
    // if the window is currently open
    properties.windowId = sessionTreeWindow.id
    if (message.discarded) {
      // some urls cannot be opened as discarded
      if (url && Utils.discardedUrlPrecheck(url)) {
        properties.discarded = true
        properties.active = false
        properties.title = sessionTreeTab.title
      } else {
        properties.active = false
        properties.discarded = false
      }
    } else {
      properties.active = true
    }
    if (sessionTreeTab.pinned) properties.pinned = true

    // find id of first open tab to the right
    const tabToRightIndex = sessionTreeWindow.tabs
      .filter(
        (tab) => tab.state === State.OPEN || tab.state === State.DISCARDED,
      )
      .findIndex(
        (tab, index, array) => array[index - 1]?.uid === message.tabUid,
      )
    if (tabToRightIndex !== -1) {
      properties.index = tabToRightIndex - 1
    }
    try {
      const tab = await OnCreatedQueue.createTabAndWait(properties).catch(
        (error) => {
          console.error('Error creating tab:', error)
          // revert changes since window wasn't created
          Tree.updateTabState(message.tabUid, State.SAVED)
          return
        },
      )
      if (!tab) {
        console.error('Tab is undefined')
        return
      }
      Tree.updateTabId(message.tabUid, tab.id!)
      Tree.updateTabState(
        message.tabUid,
        tab.discarded ? State.DISCARDED : State.OPEN,
      )
    } catch (error) {
      console.error('Error opening tab:', error)
    }
  }
}

/**
 * Saves a tab by removing it from the browser and updating the session tree.
 * If it is the last open tab in the window, the window state is updated to SAVED and the ID is reset.
 * Then the same is done for the tab and finally the tab is removed from the browser.
 *
 * @param {Object} message - The message object containing tab and window information.
 * @param {number} message.tabId - The ID of the tab to be saved.
 * @param {UID} message.tabUid - The UID of the tab to be saved.
 */
export function saveTab(message: { tabId: number; tabUid: UID }): void {
  if (message.tabUid !== undefined) {
    const tab = Tree.tabsByUid.get(message.tabUid)
    if (!tab) {
      console.error('Error saving tab, could not find tab:', message.tabUid)
      return
    }
    if (Tree.getTabState(message.tabUid) === State.SAVED) {
      // tab is already saved, do nothing
      return
    }
    // if this is the last open tab in the window, update the window state to SAVED and reset id
    const window = Tree.windowsByUid.get(tab.windowUid)
    if (window) {
      const openTabs = window.tabs.filter(
        (tab) => tab.state === State.OPEN || tab.state === State.DISCARDED,
      )
      if (openTabs.length === 1) {
        Tree.saveWindow(window.uid)
      }
    }
    Tree.setTabSaved(message.tabUid)
  }
  browser.tabs.remove(message.tabId).catch((error) => {
    console.error('Error saving tab:', error)
  })
}

/**
 * Pins a tab in the session tree, and in the browser if it is open.
 *
 * @param {UID} tabUid - The UID of the tab to be pinned.
 */
export function pinTab(tabUid: UID): void {
  const tab = Tree.tabsByUid.get(tabUid)
  if (!tab) {
    console.error('Error pinning tab, could not find tab:', tabUid)
    return
  }

  // if tab is saved, just update the session tree
  if (tab.state === State.SAVED) {
    Tree.pinTabInTree(tab.uid)
  } else {
    // if tab is open, pin tab in browser
    Browser.pinTab(tab.id)
  }
}

/**
 * Pins a tab in the session tree.
 *
 * @param {UID} tabUid - The UID of the tab to be pinned.
 */
export function pinTabInTree(tabUid: UID): void {
  const tab = Tree.tabsByUid.get(tabUid)
  if (!tab) {
    console.error('Error pinning tab, could not find tab:', tabUid)
    return
  }
  if (tab.pinned) return // already pinned

  const window = Tree.windowsByUid.get(tab.windowUid)
  if (!window) {
    console.error('Error pinning tab, could not find window:', tab.windowUid)
    return
  }
  // find index of last pinned tab
  const lastPinnedIndex = window.tabs.findLastIndex((t) => t.pinned)
  tab.pinned = true
  Tree.moveTab(tab.uid, window.uid, lastPinnedIndex + 1)
  return
}

/**
 * Unpins a tab in the session tree, and in the browser if it is open.
 *
 * @param {UID} tabUid - The UID of the tab to be unpinned.
 */
export function unpinTab(tabUid: UID): void {
  const tab = Tree.tabsByUid.get(tabUid)
  if (!tab) {
    console.error('Error unpinning tab, could not find tab:', tabUid)
    return
  }
  if (tab.state === State.SAVED) {
    // move to after last pinned tab in window
    Tree.unpinTabInTree(tab.uid)
  } else {
    // if tab is open, let browser unpin the tab and handle logic in handlers
    Browser.unpinTab(tab.id)
  }
}

/**
 * Unpins a tab in the session tree.
 *
 * @param {UID} tabUid - The UID of the tab to be unpinned.
 */
export function unpinTabInTree(tabUid: UID): void {
  const tab = Tree.tabsByUid.get(tabUid)
  if (!tab) {
    console.error('Error unpinning tab, could not find tab:', tabUid)
    return
  }

  const window = Tree.windowsByUid.get(tab.windowUid)
  if (!window) {
    console.error('Error unpinning tab, could not find window:', tab.windowUid)
    return
  }
  const lastPinnedIndex = window.tabs.findLastIndex((t) => t.pinned)
  tab.pinned = false
  Tree.moveTab(tab.uid, window.uid, Math.max(lastPinnedIndex, 0))
  return
}

/**
 * Toggles the collapsed state of a tab.
 * When collapsing, all child tabs are hidden.
 * When expanding, child tab visibility respects their own collapsed states and ancestor states.
 *
 * @param {UID} tabUid - The UID of the tab to toggle.
 */
export function toggleCollapseTab(tabUid: UID): void {
  console.log(`Toggling collapse for tab ${tabUid}`)
  const tab = Tree.tabsByUid.get(tabUid)
  if (!tab) {
    console.error(`Tab with UID ${tabUid} not found`)
    return
  }
  const window = Tree.windowsByUid.get(tab.windowUid)
  if (!window) {
    console.error(`Window with UID ${tab.windowUid} not found`)
    return
  }

  tab.collapsed = !tab.collapsed
  const childrenMap = TreeUtils.buildChildrenMap(window.tabs)
  const children = childrenMap.get(tab.uid) || []

  if (tab.collapsed) {
    // hiding this tab's subtree
    setTabVisibilityRecursively(children, childrenMap, false)
  } else {
    // before showing children, ensure no ancestor is collapsed
    let ancestorCollapsed = false
    let currentParentUid = tab.parentUid
    while (currentParentUid !== undefined) {
      const parent = Tree.tabsByUid.get(currentParentUid)
      if (!parent) break
      if (parent.collapsed) {
        ancestorCollapsed = true
        break
      }
      currentParentUid = parent.parentUid
    }

    if (!ancestorCollapsed) {
      setTabVisibilityRecursively(children, childrenMap, true)
    }
  }
}

/**
 * Recursively sets isVisible property for tabs and their children.
 *
 * @param {Tab[]} tabs - The list of tabs to set visibility for.
 * @param {Map<UID, Tab[]>} childrenMap - A map of parent UIDs to their child tabs.
 * @param {boolean} isVisible - The visibility state to set.
 */
export function setTabVisibilityRecursively(
  tabs: Tab[],
  childrenMap: Map<UID, Tab[]>,
  isVisible: boolean,
): void {
  for (const tab of tabs) {
    tab.isVisible = isVisible
    const children = childrenMap.get(tab.uid) || []
    if (children.length > 0) {
      const childVisibility = isVisible && !tab.collapsed
      setTabVisibilityRecursively(children, childrenMap, childVisibility)
    }
  }
}

/**
 * Increases indent level for the given tabs (and descendants),
 * making them children of the nearest preceding sibling.
 *
 * @param {UID[]} tabUids - The list of tabs to increase indent for.
 */
export function tabIndentIncrease(tabUids: UID[]): void {
  const tabs: Tab[] = []
  for (const uid of tabUids) {
    const tab = Tree.tabsByUid.get(uid)
    if (tab) {
      tabs.push(tab)
    }
  }
  const win = Tree.windowsByUid.get(tabs[0].windowUid)
  if (!win) {
    console.error(
      `Window with uid ${tabs[0].windowUid} not found for indent increase`,
    )
    return
  }

  const childrenMap = TreeUtils.buildChildrenMap(win.tabs)

  // remove any tabs from the selection that are descendants of other selected tabs
  const filteredTabs = removeDescendantTabs(tabs, childrenMap)

  for (const tab of filteredTabs) {
    if (tab.uid === undefined) continue
    const tabIndex = win.tabs.findIndex((t) => t.uid === tab.uid)
    if (tabIndex === 0) continue // skip root tabs
    const parentIndex = win.tabs.findIndex((t) => t.uid === tab.parentUid)
    if (parentIndex === tabIndex - 1) continue // already indented under immediate previous tab
    // if tab has a sibling tab with same indent level above it, indent is possible
    if (tabHasSiblingsAbove(tab) === false) continue
    tab.indentLevel += 1

    // find new parent tab (nearest preceding sibling with indentLevel one less than this tab)
    const newParent = findParentTab(tab)
    if (!newParent) {
      console.error(
        `Failed to find new parent for tab ${tab.uid} during indent increase`,
      )
      return
    }

    tab.parentUid = newParent.uid
    newParent.isParent = true

    // increase indent level for all descendants of this tab
    const children = childrenMap.get(tab.uid) || []

    // match visibility of new parent for tab and all decendants
    tab.isVisible = newParent.collapsed ? false : true
    setTabVisibilityRecursively(children, childrenMap, tab.isVisible)

    if (children.length) increaseIndentRecursively(children, childrenMap)
  }
}

/**
 * Decreases indent level for the given tabs (and descendants),
 * converting previous siblings below tab into children.
 *
 * @param {UID[]} tabUids - The list of tabs to decrease indent for.
 */
export function tabIndentDecrease(tabUids: UID[]): void {
  const tabs: Tab[] = []
  for (const uid of tabUids) {
    const tab = Tree.tabsByUid.get(uid)
    if (tab) {
      tabs.push(tab)
    }
  }
  const win = Tree.windowsByUid.get(tabs[0].windowUid)
  if (!win) {
    console.error(`Window not found for tab indent decrease`)
    return
  }

  const childrenMap = TreeUtils.buildChildrenMap(win.tabs)

  // remove any tabs from the selection that are descendants of other selected tabs
  const filteredTabs = removeDescendantTabs(tabs, childrenMap)

  for (const tab of filteredTabs) {
    if (tab.uid === undefined) continue
    const tabIndex = win.tabs.findIndex((t) => t.uid === tab.uid)
    if (tabIndex === 0) continue // skip root tabs
    if (tab.indentLevel <= 1) continue // already at root level
    tab.indentLevel -= 1
    const oldParent = Tree.tabsByUid.get(tab.parentUid as UID)
    const oldParentIndex = win.tabs.findIndex((t) => t.uid === tab.parentUid)
    // if this was the only child or first child, clear isParent flag on old parent
    if (
      tab.parentUid &&
      oldParentIndex &&
      oldParent &&
      (childrenMap.get(tab.parentUid)?.length === 1 ||
        oldParentIndex === tabIndex - 1)
    )
      oldParent.isParent = false

    // siblings directly below the tab now become its children
    const siblings = childrenMap.get(tab.parentUid!) || []
    const lowerSiblings = siblings.filter(
      (s) => win.tabs.findIndex((t) => t.uid === s.uid) > tabIndex,
    )
    if (lowerSiblings.length > 0) {
      tab.isParent = true // now a parent
      for (const child of lowerSiblings) child.parentUid = tab.uid
    }
    if (tab.indentLevel === 1) {
      tab.parentUid = undefined
    } else {
      const newParent = findParentTab(tab)
      if (newParent) {
        tab.parentUid = newParent.uid
        newParent.isParent = true
      } else {
        console.error(
          `Failed to find new parent for tab ${tab.uid} during indent decrease`,
        )
      }
    }
    // decrease indent level for all descendants of this tab
    const children = childrenMap.get(tab.uid) || []
    if (children.length) decreaseIndentRecursively(children, childrenMap)
  }
}

/**
 * Given a list of selected tabs and a children map for the full window,
 * return a new array containing only those tabs that are not descendants
 * of any other tab in the selected list. This prevents double-processing
 * when the input selection contains both a parent and its children.
 *
 * @param {Tab[]} selectedTabs - The list of selected tabs.
 * @param {Map<UID, Tab[]>} childrenMap - A map of parent UIDs to their child tabs.
 * @returns {Tab[]} A filtered list of tabs excluding descendants of other selected tabs.
 */
function removeDescendantTabs(
  selectedTabs: Tab[],
  childrenMap: Map<UID, Tab[]>,
): Tab[] {
  const skip = new Set<UID>()
  const result: Tab[] = []

  for (const t of selectedTabs) {
    if (t.uid === undefined) continue
    if (skip.has(t.uid)) continue
    result.push(t)
    // mark all descendants so they will be skipped
    const children = childrenMap.get(t.uid) || []
    if (children.length) collectDescendantTabIds(children, childrenMap, skip)
  }

  return result
}

/**
 * Recursively collects the UIDs of all descendant tabs of the given tabs.
 * Updates the provided set with the collected UIDs.
 *
 * @param {Tab[]} tabs - The list of tabs whose descendants are to be collected.
 * @param {Map<UID, Tab[]>} childrenMap - A map of parent UIDs to their child tabs.
 * @param {Set<UID>} set - A set to store the collected descendant UIDs.
 */
function collectDescendantTabIds(
  tabs: Tab[],
  childrenMap: Map<UID, Tab[]>,
  set: Set<UID>,
): void {
  for (const tab of tabs) {
    if (tab.uid !== undefined) set.add(tab.uid)
    const children = childrenMap.get(tab.uid) || []
    if (children.length) collectDescendantTabIds(children, childrenMap, set)
  }
}

/**
 * Checks if the given tab has siblings above it with the same indent level.
 *
 * @param {Tab} tab - The tab to check for siblings above.
 * @returns {boolean} True if there are siblings above, false otherwise.
 */
function tabHasSiblingsAbove(tab: Tab): boolean {
  const win = Tree.windowsByUid.get(tab.windowUid)
  if (!win) return false

  // Find the index of the current tab in the window's tabs array and scan backwards
  const currentIndex = win.tabs.findIndex((t) => t.uid === tab.uid)
  if (currentIndex > 0) {
    const targetIndent = tab.indentLevel ?? 1
    for (let i = currentIndex - 1; i >= 0; i--) {
      const candidate = win.tabs[i]
      if ((candidate.indentLevel ?? 1) === targetIndent) return true
      if ((candidate.indentLevel ?? 1) < targetIndent) return false
    }
  }

  return false
}

/**
 * Finds the parent tab for a given tab based on its indent level.
 *
 * @param {Tab} tab - The tab to find the parent for.
 * @returns {Tab | undefined} The parent tab if found, otherwise undefined.
 */
function findParentTab(tab: Tab): Tab | undefined {
  const win = Tree.windowsByUid.get(tab.windowUid)
  if (!win) return undefined

  // Find the index of the current tab in the window's tabs array and scan backwards
  const currentIndex = win.tabs.findIndex((t) => t.uid === tab.uid)
  if (currentIndex > 0) {
    const targetIndent = (tab.indentLevel ?? 1) - 1
    for (let i = currentIndex - 1; i >= 0; i--) {
      const candidate = win.tabs[i]
      if ((candidate.indentLevel ?? 1) === targetIndent) {
        return candidate
      }
    }
  }
  return undefined
}

/**
 * Decreases indent level recursively for child tabs.
 *
 * @param {Tab[]} nodes - The list of tabs to decrease indent for.
 * @param {Map<UID, Tab[]>} childrenMap - A map of parent UIDs to their child tabs.
 */
function decreaseIndentRecursively(nodes: Tab[], childrenMap: Map<UID, Tab[]>) {
  for (const node of nodes) {
    node.indentLevel = Math.max((node.indentLevel ?? 1) - 1, 1)
    const children = childrenMap.get(node.uid) || []
    if (children.length) decreaseIndentRecursively(children, childrenMap)
  }
}

/**
 * Increases indent level recursively for child tabs.
 *
 * @param {Tab[]} nodes - The list of tabs to increase indent for.
 * @param {Map<UID, Tab[]>} childrenMap - A map of parent UIDs to their child tabs.
 */
function increaseIndentRecursively(nodes: Tab[], childrenMap: Map<UID, Tab[]>) {
  for (const node of nodes) {
    node.indentLevel = (node.indentLevel ?? 1) + 1
    const children = childrenMap.get(node.uid) || []
    if (children.length) increaseIndentRecursively(children, childrenMap)
  }
}

/**
 * Moves a list of tabs to a specified position within a target window.
 * Tabs can be from more than one window.
 *
 * @param {UID[]} tabUIDs - Unsorted list of tabs to move in the tree
 * @param {UID} targetWindowUid - The UID of the target window where tabs will be moved
 * @param {number} targetIndex - The index in the target window's tab list where tabs will be inserted
 * @param {boolean} copy - Whether to copy the tabs instead of moving them
 */
export async function moveTabs(
  tabUIDs: UID[],
  targetWindowUid: UID,
  targetIndex: number,
  parentUid?: UID,
  copy: boolean = false,
): Promise<void> {
  // TODO: implement copy functionality
  console.log(
    `moveTabs: Moving tabs to window ${targetWindowUid} at index ${targetIndex}`,
  )
  const tabs: Tab[] = []
  for (const uid of tabUIDs) {
    const tab = Tree.tabsByUid.get(uid)
    if (tab) {
      tabs.push({ ...tab })
    } else {
      console.error(`Tab with UID ${uid} not found`)
    }
  }

  // first sort tabs in descending order of how they appear in the tree
  tabs.sort((a, b) => {
    const winIndexA = Tree.windowsList.findIndex((w) => w.uid === a.windowUid)
    const winIndexB = Tree.windowsList.findIndex((w) => w.uid === b.windowUid)
    if (winIndexA === -1 || winIndexB === -1) return 0
    if (winIndexA !== winIndexB) return winIndexA - winIndexB

    const win = Tree.windowsByUid.get(a.windowUid)
    if (!win) return 0
    const indexA = win.tabs.findIndex((t) => t.uid === a.uid)
    const indexB = win.tabs.findIndex((t) => t.uid === b.uid)
    if (indexA === -1 || indexB === -1) return 0
    return indexA - indexB
  })

  // check if destination window and target index are valid
  const targetWindow = Tree.windowsByUid.get(targetWindowUid)
  if (!targetWindow) {
    console.error(`Target window with UID ${targetWindowUid} not found`)
    return
  }
  if (targetIndex < 0 || targetIndex > targetWindow.tabs.length) {
    console.error(
      `Invalid target index ${targetIndex} for window ${targetWindowUid}`,
    )
    // if index is invalid, set to last position
    targetIndex = targetWindow.tabs.length
  }

  const newUidMapping: Map<UID, UID> = new Map()

  // move each tab
  for (const tab of tabs) {
    // check if target index needs to be adjusted depending on tab pinned state
    // i.e. pinned tabs cannot be moved after unpinned tabs and vice versa
    const isPinned = tab.pinned || false
    let originalTargetIndex = targetIndex
    let targetIndexAdjusted = false
    if (isPinned) {
      const lastPinnedIndex = targetWindow.tabs.findLastIndex((t) => t.pinned)
      // if tab is pinned and target index is after last pinned tab, move it to after last pinned tab
      if (lastPinnedIndex + 1 < targetIndex) {
        targetIndex = lastPinnedIndex + 1
        targetIndexAdjusted = true
      }
    } else {
      let firstUnpinnedIndex = targetWindow.tabs.findIndex((t) => !t.pinned)
      if (firstUnpinnedIndex === -1)
        firstUnpinnedIndex = targetWindow.tabs.length
      // if tab is unpinned and target index is before first unpinned tab, move it to first unpinned tab
      if (firstUnpinnedIndex > targetIndex) {
        targetIndex = firstUnpinnedIndex
        targetIndexAdjusted = true
      }
    }
    const sourceIndex = targetWindow.tabs.findIndex((t) => t.uid === tab.uid)
    // check if removing tab will affect index
    if (
      !copy &&
      tab.windowUid === targetWindowUid &&
      sourceIndex < targetIndex
    ) {
      targetIndex--
    }

    let newParentUid: UID | undefined = undefined
    if (
      Settings.values.tryToMaintainHierarchyOfDraggedItems &&
      tab.parentUid &&
      newUidMapping.has(tab.parentUid as UID)
    ) {
      newParentUid = newUidMapping.get(tab.parentUid as UID)
    }

    const newTabUid = await moveTab(
      tab.uid,
      targetWindowUid,
      targetIndex,
      targetIndexAdjusted ? undefined : (newParentUid ?? parentUid), // only use parentUid if target index was not adjusted
    )
    if (newTabUid) newUidMapping.set(tab.uid, newTabUid)
    if (targetIndexAdjusted) {
      // reset target index for next tab
      if (targetIndex <= originalTargetIndex) originalTargetIndex++
      if (
        !copy &&
        tab.windowUid === targetWindowUid &&
        sourceIndex < originalTargetIndex
      ) {
        originalTargetIndex--
      }

      targetIndex = originalTargetIndex
    } else {
      targetIndex++
    }
  }

  // loop through moved tabs that were collapsed and re-collapse them if they have children
  if (Settings.values.tryToMaintainCollapsedStateOfDraggedItems) {
    for (const tab of tabs) {
      if (!tab.collapsed) continue
      const newTabUid = newUidMapping.get(tab.uid)
      if (!newTabUid) continue
      const newTab = Tree.tabsByUid.get(newTabUid)
      if (!newTab) continue
      if (newTab.isParent) {
        toggleCollapseTab(newTabUid)
      }
    }
  }
}

/**
 * Moves a single tab to a specified position within a target window.
 * Handles both saved and open tabs.
 *
 * @param {UID} tabUID - The UID of the tab to move.
 * @param {UID} targetWindowUid - The UID of the target window where the tab will be moved.
 * @param {number} targetIndex - The index in the target window's tab list where the tab will be inserted.
 * @param {UID} [parentUid] - Optional UID of the parent tab, used to calculate indent.
 * @param {boolean} [copy=false] - Whether to copy the tab instead of moving.
 */
export async function moveTab(
  tabUID: UID,
  targetWindowUid: UID,
  targetIndex: number,
  parentUid?: UID,
  copy: boolean = false,
): Promise<UID | void> {
  // TODO: implement copy functionality
  console.log(
    'moveTab: ',
    tabUID,
    targetWindowUid,
    targetIndex,
    parentUid,
    copy,
  )

  // check if tab and target window exists
  const tab = Tree.tabsByUid.get(tabUID)
  const targetWindow = Tree.windowsByUid.get(targetWindowUid)

  if (!tab || !targetWindow) {
    console.error(`moveTab: Tab or target window not found`)
    return
  }
  // determine if tab should be active in new window
  const tabActive =
    targetWindow.state === State.OPEN &&
    (targetWindow.activeTabId === undefined ||
      targetWindow.uid === tab.windowUid) &&
    tab.active
      ? true
      : false

  const currentIndexInBrowser = targetWindow.tabs
    .filter((t) => t.state === State.OPEN || t.state === State.DISCARDED)
    .findIndex((t) => t.uid === tab.uid)

  // if tab is already in correct position and indent lvl in the session tree, do nothing
  if (
    tab.windowUid === targetWindowUid &&
    (targetWindow.tabs.length === 1 ||
      (targetWindow.tabs.findIndex((t) => t.uid === tab.uid) === targetIndex &&
        tab.parentUid === parentUid))
  ) {
    return tab.uid
  }

  // remove and add tab in session tree to simulate move
  removeTab(tab.uid)

  addTab(
    tabActive,
    targetWindow.uid,
    tab.id,
    tab.selected,
    tab.state,
    tab.title,
    tab.url,
    tab.pinned || false,
    targetIndex,
    parentUid,
    tab.uid,
  )

  const targetIndexInBrowser = targetWindow.tabs.filter(
    (t, index) =>
      index < targetIndex &&
      // t.uid !== tab.uid && // removed this line to allow moving within same window
      (t.state === State.OPEN || t.state === State.DISCARDED),
  ).length

  // if tab is open in browser but target window is not open then create the window first
  if (
    (tab.state === State.OPEN || tab.state === State.DISCARDED) &&
    targetWindow.state === State.SAVED
  ) {
    Tree.updateWindowState(targetWindowUid, State.OPEN)
    const properties: browser.windows._CreateCreateData = {}
    properties.tabId = tab.id
    // TODO: use window position from saved window if setting is enabled

    try {
      const window = await OnCreatedQueue.createWindowAndWait(properties).catch(
        (error) => {
          console.error('Error creating window:', error)
          // revert changes since window wasn't created
          Tree.updateWindowState(targetWindowUid, State.SAVED)
          Tree.updateTabState(tab.uid, State.SAVED)
          return
        },
      )
      if (!window) {
        console.error('Window is undefined')
        return
      }
      // because Firefox doesn't support opening unfocused windows, we send focus back
      if (Tree.sessionTreeWindowId) {
        Browser.focusWindow({ windowId: Tree.sessionTreeWindowId })
      }
      if (!window.id) {
        throw new Error('Window ID is undefined')
      }
      // then update the saved window object id to represent the newly opened window
      Tree.updateWindowId(targetWindowUid, window.id)
      const newTab = window.tabs![0]
      Tree.updateTabId(tab.uid, newTab.id!)
      Tree.updateTabState(tab.uid, State.OPEN)
      return tab.uid
    } catch (error) {
      console.error('Error opening window:', error)
    }
  }

  // if the target window is already open, just handle the move
  if (
    (tab.state === State.OPEN || tab.state === State.DISCARDED) &&
    targetWindow.state === State.OPEN
  ) {
    console.debug(
      `moveTab: currentIndexInBrowser: ${currentIndexInBrowser} targetIndexInBrowser: ${targetIndexInBrowser}`,
    )
    // check if move is actually needed in browser
    if (
      tab.windowUid === targetWindowUid &&
      currentIndexInBrowser === targetIndexInBrowser
    ) {
      return tab.uid
    }
    // TODO: create a 'moveTabAndWait' flow to safeguard against the tabid changing after move?
    // handle move
    await browser.tabs
      .move(tab.id, {
        windowId: targetWindow.id,
        index: targetIndexInBrowser,
      })
      .catch((error) => {
        console.error('Error moving tab in browser:', error)
        return
      })
      .then((moved) => {
        const movedTab = Array.isArray(moved) ? moved[0] : moved
        // tab moved successfully in browser, now verify tab id in session tree matches
        const newTab = targetWindow.tabs.find((t) => t.id === movedTab?.id)
        if (!newTab) console.error('Moved tab not found in session tree')
        if (newTab && newTab.id !== tab.id)
          console.error(
            'Tab ID mismatch after move. TabID:',
            newTab.id,
            'Expected:',
            tab.id,
          )
      })
    return tab.uid
  }
  return tab.uid
}
