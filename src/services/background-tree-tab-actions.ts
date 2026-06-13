import { Browser } from '@/services/background-browser'
import { DeferredEventsQueue } from '@/services/background-deferred-events-queue'
import { OnCreatedQueue } from '@/services/background-on-created-queue'
import { Tree } from '@/services/background-tree'
import { emitTreeDelta } from '@/services/runtime-port-service'
import { Settings } from '@/services/settings'
import * as Utils from '@/services/utils'
import { State, Tab, TreeItemType, WindowChild } from '@/types/session-tree'

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
  emitDelta: boolean = true,
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
    type: TreeItemType.TAB,
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
    // if not pinned but index before last pinned tab, change index to
    // after last pinned tab
    if (!tab.pinned) {
      const lastPinnedIndex = window.children.reduce(
        (maxIndex, currentTab, currentIndex) => {
          return currentTab.type === TreeItemType.TAB &&
            currentTab.pinned &&
            currentIndex > maxIndex
            ? currentIndex
            : maxIndex
        },
        -1,
      )
      if (lastPinnedIndex !== -1 && index <= lastPinnedIndex) {
        index = lastPinnedIndex + 1
        // if moving to after last pinned tab, remove parentUid to avoid issues with parent-child relationships
        parentUid = undefined
      }
    }
    // if parentUid is provided, insert as child item
    if (parentUid) {
      const parent =
        Tree.tabsByUid.get(parentUid) ?? Tree.notesByUid.get(parentUid)
      const siblingItemCount = window.children.filter(
        (item) => item.parentUid === parentUid,
      ).length

      // if this is the first child item, set parent's isParent to true
      if (siblingItemCount === 0 && parent) {
        if (parent.type === TreeItemType.TAB) {
          Tree.updateTab({ tabUid: parentUid }, { isParent: true }, emitDelta)
        } else {
          Tree.updateNote(parentUid, { isParent: true }, emitDelta)
        }
      }

      tab.parentUid = parent?.uid
      // set indent level one more than parent, or default to 1
      tab.indentLevel = parent?.indentLevel ? parent?.indentLevel + 1 : 1
    } else {
      // else match indent level and parentUid of the item to the right
      const itemToRight = window.children[index]

      tab.parentUid = itemToRight?.parentUid
      tab.indentLevel = itemToRight?.indentLevel ?? 1
    }

    window.children.splice(index, 0, tab)
  } else {
    // add to end of tree
    tab.indentLevel = 1
    window.children.push(tab)
  }
  // TODO: can use tab object instead when independent data source for foreground context implemented (i.e. use 'tab' instead of windws.children... lookup)
  Tree.tabsByUid.set(
    tab.uid,
    window.children[window.children.indexOf(tab)] as Tab,
  )
  Tree.existingUidsSet.add(tab.uid)
  Tree.recomputeSessionTree(emitDelta)
  if (emitDelta) {
    emitTreeDelta({
      op: 'tabCreated',
      windowUid: window.uid,
      tab: structuredClone(tab),
      index: window.children.indexOf(tab),
    })
  }
  DeferredEventsQueue.processDeferredTabEvents(tabId)
  return tab.uid
}

/**
 * Removes a tab from the session tree.
 *
 * @param {UID} tabUid - The UID of the tab to be removed.
 * @param {boolean = true} emitDelta - Whether to emit a tree delta event.
 */
export function removeTab(tabUid: UID, emitDelta: boolean = true): void {
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
  const index = window.children.findIndex((tab) => tab.uid === tabUid)
  if (index === -1) {
    console.error('Error removing tab, could not find tab:', tabUid)
    return
  }

  // before removing the tab, adjust the indent levels and parentUid of its children

  const parentItem = tab.parentUid
    ? (Tree.tabsByUid.get(tab.parentUid) ?? Tree.notesByUid.get(tab.parentUid))
    : undefined
  const childrenMap = Tree.buildChildrenMap(window.children)
  const directChildren = childrenMap.get(tab.uid) || []
  const siblings = childrenMap.get(tab.parentUid as UID) || []

  if (directChildren.length === 0 && siblings.length === 1 && parentItem) {
    // if no children and no siblings, remove parent status from parent item
    if (parentItem.type === TreeItemType.TAB) {
      Tree.updateTab({ tabUid: parentItem.uid }, { isParent: false }, emitDelta)
    } else {
      Tree.updateNote(parentItem.uid, { isParent: false }, emitDelta)
    }
  } else if (directChildren.length > 0) {
    for (const child of directChildren) {
      if (child.type === TreeItemType.TAB) {
        Tree.updateTab(
          { tabUid: child.uid },
          { parentUid: tab.parentUid },
          emitDelta,
        )
      } else {
        Tree.updateNote(child.uid, { parentUid: tab.parentUid }, emitDelta)
      }
    }
  }

  Tree.existingUidsSet.delete(tab.uid)
  Tree.tabsByUid.delete(tab.uid)
  window.children.splice(index, 1)
  if (emitDelta) {
    emitTreeDelta({
      op: 'tabRemoved',
      windowUid: window.uid,
      tabUid: tab.uid,
    })
  }
  // if this was the last tab in the window, remove the window
  if (window.children.length === 0) {
    Tree.removeWindow(window.uid)
  }
  Tree.recomputeSessionTree(emitDelta)
}

/**
 * Updates all shallow properties of a tab in the session tree.
 * Note: does not update nested objects within the tab.
 *
 * @param {Object} id - An object containing EITHER the (windowId and tabId) OR (tabUid) of the tab to be updated.
 * @param {Partial<Tab>} tabContents - An object containing the updated properties for the tab.
 * @param {boolean = true} emitDelta - Whether to emit a tree delta event for this update.
 */
export function updateTab(
  id: { windowId?: number; tabId?: number; tabUid?: UID },
  tabContents: Partial<Tab>,
  emitDelta: boolean = true,
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

    const window = Tree.Items.filter(Tree.isWindow).find(
      (w) => w.id === id.windowId,
    )
    if (!window) {
      DeferredEventsQueue.addDeferredWindowEvent(id.windowId, () =>
        Tree.updateTab(id, tabContents, emitDelta),
      )
      return
    }
    tab = window.children.find(
      (t): t is Tab => t.type === TreeItemType.TAB && t.id === id.tabId,
    )
    if (!tab) {
      DeferredEventsQueue.addDeferredTabEvent(id.tabId, () =>
        Tree.updateTab(id, tabContents, emitDelta),
      )
      return
    }
  }
  // If the tab object exists update the new values
  Object.assign(tab, tabContents)
  if (emitDelta) {
    emitTreeDelta({
      op: 'tabUpdated',
      tab: structuredClone(tab),
    })
  }
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
    Tree.updateTab({ tabUid: tabUid }, { id: newTabId })
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
    const updatedTab = { state: state } as Partial<Tab>
    if (state === State.SAVED) {
      updatedTab.savedTime = Date.now()
    }
    Tree.updateTab({ tabUid: tabUid }, updatedTab)
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
    const updatedTab = {
      state: State.SAVED,
      id: -1,
      savedTime: Date.now(),
      active: false,
    } as Partial<Tab>
    Tree.updateTab({ tabUid: tabUid }, updatedTab)
  }
}

/**
 * Updates active tab status in session tree
 */
export function tabOnActivated(
  activeInfo: browser.tabs._OnActivatedActiveInfo,
  tries: number = 0,
): void {
  const window = Tree.Items.filter(Tree.isWindow).find(
    (w) => w.id === activeInfo.windowId,
  )
  const activeTab = Tree.Items.filter(Tree.isWindow)
    .find((w) => w.id === activeInfo.windowId)
    ?.children.find(
      (t): t is Tab => t.type === TreeItemType.TAB && t.id === activeInfo.tabId,
    )
  const previousActiveTab = Tree.Items.filter(Tree.isWindow)
    .find((w) => w.id === activeInfo.windowId)
    ?.children.find(
      (t): t is Tab =>
        t.type === TreeItemType.TAB && t.id === activeInfo.previousTabId,
    )
  // remove active status from previous active tab (not when detached/attached)
  if (activeInfo.previousTabId !== activeInfo.tabId && previousActiveTab) {
    Tree.updateTab({ tabUid: previousActiveTab.uid }, { active: false })
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
  Tree.updateWindow(window.uid, { activeTabId: activeInfo.tabId })
  Tree.updateTab({ tabUid: activeTab.uid }, { active: true })
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
    const windowUid = tab.windowUid
    Tree.removeTab(message.tabUid)
    // if this is the last open tab in the window but there are other saved tabs then
    // update the window state to SAVED and reset id
    const window = Tree.windowsByUid.get(windowUid)
    if (window) {
      const openTabs = Tree.getTabs(window.children).filter(
        (tab) => tab.state === State.OPEN || tab.state === State.DISCARDED,
      )
      if (window.children.length > 0 && openTabs.length === 0) {
        Tree.updateWindowState(window.uid, State.SAVED)
        Tree.updateWindowId(window.uid, -1)
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
 *
 * Duplicates a tab by creating a new tab in the browser with the same URL and title,
 * and adding it to the session tree as a sibling of the original tab.
 *
 * @param {Object} message - The message object containing the tab id and UID
 * @param {number} message.tabId - The ID of the tab to be duplicated
 * @param {UID} message.tabUid - The UID of the tab to be duplicated
 */
export function duplicateTab(message: { tabId: number; tabUid: UID }): void {
  const tab = Tree.tabsByUid.get(message.tabUid)
  // if tab open let browser duplicate the tab and handle logic in onCreated handler
  if (tab && tab.state === State.OPEN) {
    browser.tabs.duplicate(message.tabId).catch((error) => {
      console.error('Error duplicating tab:', error)
    })
  }
  // if tab is saved create a new tab with the same URL and title and add to session tree
  else if (tab && tab.state === State.SAVED) {
    const window = Tree.windowsByUid.get(tab.windowUid)
    if (!window) {
      console.error(
        'Error duplicating tab, could not find window:',
        tab.windowUid,
      )
      return
    }
    const index = window.children.indexOf(tab)
    const nextBoundaryIndex = window.children.findIndex(
      (t, i) => i > index && t.indentLevel <= tab.indentLevel,
    )
    const newIndex =
      nextBoundaryIndex === -1 ? window.children.length : nextBoundaryIndex
    addTab(
      false,
      tab.windowUid,
      -1,
      false,
      tab.state,
      tab.title,
      tab.url,
      false,
      newIndex,
      tab.parentUid,
    )
  }
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
        Tree.updateWindowState(message.windowUid, State.SAVED)
        Tree.updateTabState(message.tabUid, State.SAVED)
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
    const tabToRightIndex = Tree.getTabs(sessionTreeWindow.children)
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
      const openTabs = Tree.getTabs(window.children).filter(
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
 * @param {boolean = true} emitDelta - Whether to emit a tree delta event for this update.
 */
export function pinTabInTree(tabUid: UID, emitDelta: boolean = true): void {
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
  const lastPinnedIndex = window.children.findLastIndex(
    (t) => t.type === TreeItemType.TAB && t.pinned,
  )
  const index = window.children.indexOf(tab)
  Tree.updateTab({ tabUid: tab.uid }, { pinned: true }, emitDelta)
  Tree.moveTab(
    tab.uid,
    window.uid,
    lastPinnedIndex + 1,
    lastPinnedIndex + 1 === index ? tab.parentUid : undefined,
    emitDelta,
  )
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
 * @param {boolean = true} emitDelta - Whether to emit a tree delta event for this update.
 */
export function unpinTabInTree(tabUid: UID, emitDelta: boolean = true): void {
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
  const lastPinnedIndex = window.children.findLastIndex(
    (t) => t.type === TreeItemType.TAB && t.pinned,
  )
  const index = window.children.indexOf(tab)
  Tree.updateTab({ tabUid: tab.uid }, { pinned: false }, emitDelta)
  Tree.moveTab(
    tab.uid,
    window.uid,
    Math.max(lastPinnedIndex, 0),
    lastPinnedIndex === index ? tab.parentUid : undefined,
    emitDelta,
  )
  return
}

/**
 * Toggles the collapsed state of a tab.
 * When collapsing, all child tabs are hidden.
 * When expanding, child tab visibility respects their own collapsed states and ancestor states.
 *
 * @param {UID} tabUid - The UID of the tab to toggle.
 * @param {boolean = true} emitDelta - Whether to emit tree delta events for this update.
 */
export function toggleCollapseTab(
  tabUid: UID,
  emitDelta: boolean = true,
): void {
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

  Tree.updateTab({ tabUid: tab.uid }, { collapsed: !tab.collapsed }, emitDelta)

  if (tab.collapsed) {
    // hiding this tab's subtree
    Tree.setItemChildrenVisibility(tab.uid, window.children, false, emitDelta)
  } else {
    // before showing children, ensure no ancestor is collapsed
    let ancestorCollapsed = false
    let currentParentUid = tab.parentUid
    while (currentParentUid !== undefined) {
      const parent =
        Tree.tabsByUid.get(currentParentUid) ??
        Tree.notesByUid.get(currentParentUid) ??
        Tree.windowsByUid.get(currentParentUid)
      if (!parent) break
      if (parent.collapsed) {
        ancestorCollapsed = true
        break
      }
      currentParentUid = parent.parentUid
    }

    if (!ancestorCollapsed) {
      Tree.setItemChildrenVisibility(tab.uid, window.children, true, emitDelta)
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

  // repairInvalidTabParentUids(win, false)
  const childrenMap = Tree.buildChildrenMap(Tree.getTabs(win.children))

  // remove any tabs from the selection that are descendants of other selected tabs
  const filteredTabs = removeDescendantTabs(tabs, childrenMap)

  for (const tab of filteredTabs) {
    if (tab.uid === undefined) continue
    const tabIndex = win.children.findIndex((t) => t.uid === tab.uid)
    if (tabIndex === 0) continue // skip root tabs
    const parentIndex = win.children.findIndex((t) => t.uid === tab.parentUid)
    if (parentIndex === tabIndex - 1) continue // already indented under immediate previous tab
    // if tab has a sibling tab with same indent level above it, indent is possible
    if (tabHasSiblingsAbove(tab) === false) continue
    const newIndent = (tab.indentLevel ?? 1) + 1
    Tree.updateTab({ tabUid: tab.uid }, { indentLevel: newIndent })

    // find new parent tab (nearest preceding sibling with indentLevel one less than this tab)
    const newParent = findParent(tab)
    if (!newParent) {
      console.error(
        `Failed to find new parent for tab ${tab.uid} during indent increase`,
      )
      return
    }

    Tree.updateTab({ tabUid: tab.uid }, { parentUid: newParent.uid })
    updateParentItemFlag(newParent.uid, true)

    // increase indent level for all descendants of this tab
    const children = childrenMap.get(tab.uid) || []

    // if new parent is collapsed, match visibility of new parent for tab and all decendants
    if (newParent.collapsed) {
      Tree.updateTab(
        { tabUid: tab.uid },
        { isVisible: newParent.collapsed ? false : true },
      )

      Tree.setItemChildrenVisibility(
        tab.uid,
        children,
        tab.isVisible ? true : false,
        true,
      )
    }

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

  // repairInvalidTabParentUids(win, false)
  const childrenMap = Tree.buildChildrenMap(Tree.getTabs(win.children))

  // remove any tabs from the selection that are descendants of other selected tabs
  const filteredTabs = removeDescendantTabs(tabs, childrenMap)

  for (const tab of filteredTabs) {
    if (tab.uid === undefined) continue
    const tabIndex = win.children.findIndex((t) => t.uid === tab.uid)
    if (tabIndex === 0) continue // skip root tabs
    const minimumIndent = (win.indentLevel ?? 0) + 1
    if (tab.indentLevel <= minimumIndent) continue // already at root level
    const newIndent = tab.indentLevel - 1
    Tree.updateTab({ tabUid: tab.uid }, { indentLevel: newIndent })

    const oldParentUid = tab.parentUid
    const oldParent = getParentItem(oldParentUid)

    // siblings directly below the tab now become its children
    const siblings = oldParentUid ? childrenMap.get(oldParentUid) || [] : []
    const lowerSiblings = siblings.filter(
      (s) => win.children.findIndex((t) => t.uid === s.uid) > tabIndex,
    )
    if (lowerSiblings.length > 0) {
      Tree.updateTab({ tabUid: tab.uid }, { isParent: true }) // now a parent
      for (const child of lowerSiblings) {
        Tree.updateTab({ tabUid: child.uid }, { parentUid: tab.uid })
      }
    }
    if (tab.indentLevel === minimumIndent) {
      Tree.updateTab({ tabUid: tab.uid }, { parentUid: undefined })
    } else {
      const newParent = findParent(tab)
      if (newParent) {
        Tree.updateTab({ tabUid: tab.uid }, { parentUid: newParent.uid })
        updateParentItemFlag(newParent.uid, true)
      } else {
        console.error(
          `Failed to find new parent for tab ${tab.uid} during indent decrease`,
        )
      }
    }
    // decrease indent level for all descendants of this tab
    const children = childrenMap.get(tab.uid) || []
    if (children.length)
      decreaseIndentRecursively(children, childrenMap, minimumIndent)

    if (oldParent) {
      updateParentItemFlag(
        oldParent.uid,
        win.children.some((child) => child.parentUid === oldParent.uid),
      )
    }
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

function tabHasSiblingsAbove(tab: Tab): boolean {
  const win = Tree.windowsByUid.get(tab.windowUid)
  if (!win) return false

  // Find the index of the current tab in the window's tabs array and scan backwards
  const currentIndex = win.children.findIndex((t) => t.uid === tab.uid)
  if (currentIndex > 0) {
    const targetIndent = tab.indentLevel ?? 1
    for (let i = currentIndex - 1; i >= 0; i--) {
      const candidate = win.children[i]
      if ((candidate.indentLevel ?? 1) === targetIndent) return true
      if ((candidate.indentLevel ?? 1) < targetIndent) return false
    }
  }

  return false
}

/**
 * Finds the parent tab for a given tab based on its indent level.
 *
 * @param {WindowChild} item - The tab to find the parent for.
 * @returns {Tab | undefined} The parent tab if found, otherwise undefined.
 */
function findParent(item: WindowChild): WindowChild | undefined {
  const win = Tree.windowsByUid.get(item.windowUid ? item.windowUid : '')
  if (!win) return undefined

  // Find the index of the current tab in the window's tabs array and scan backwards
  const currentIndex = win.children.findIndex((t) => t.uid === item.uid)
  if (currentIndex > 0) {
    const targetIndent = (item.indentLevel ?? 1) - 1
    for (let i = currentIndex - 1; i >= 0; i--) {
      const candidate = win.children[i]
      if (
        // candidate.type === TreeItemType.TAB &&
        (candidate.indentLevel ?? 1) === targetIndent
      ) {
        return candidate
      }
    }
  }
  return undefined
}

function getParentItem(parentUid: UID | undefined): WindowChild | undefined {
  if (!parentUid) return undefined
  return Tree.tabsByUid.get(parentUid) ?? Tree.notesByUid.get(parentUid)
}

function updateParentItemFlag(parentUid: UID, isParent: boolean): void {
  if (Tree.tabsByUid.has(parentUid)) {
    Tree.updateTab({ tabUid: parentUid }, { isParent })
  } else if (Tree.notesByUid.has(parentUid)) {
    Tree.updateNote(parentUid, { isParent })
  }
}

/**
 * Decreases indent level recursively for child tabs.
 *
 * @param {Tab[]} nodes - The list of tabs to decrease indent for.
 * @param {Map<UID, Tab[]>} childrenMap - A map of parent UIDs to their child tabs.
 * @param {boolean = true} emitDelta - Whether to emit a tree delta event for this update.
 */
function decreaseIndentRecursively(
  nodes: Tab[],
  childrenMap: Map<UID, Tab[]>,
  minimumIndent: number = 1,
  emitDelta: boolean = true,
) {
  for (const node of nodes) {
    Tree.updateTab(
      { tabUid: node.uid },
      { indentLevel: Math.max((node.indentLevel ?? 1) - 1, minimumIndent) },
      emitDelta,
    )
    const children = childrenMap.get(node.uid) || []
    if (children.length)
      decreaseIndentRecursively(children, childrenMap, minimumIndent, emitDelta)
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
    Tree.updateTab(
      { tabUid: node.uid },
      { indentLevel: (node.indentLevel ?? 1) + 1 },
    )
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
    const winIndexA = Tree.Items.findIndex((w) => w.uid === a.windowUid)
    const winIndexB = Tree.Items.findIndex((w) => w.uid === b.windowUid)
    if (winIndexA === -1 || winIndexB === -1) return 0
    if (winIndexA !== winIndexB) return winIndexA - winIndexB

    const win = Tree.windowsByUid.get(a.windowUid)
    if (!win) return 0
    const indexA = win.children.findIndex((t) => t.uid === a.uid)
    const indexB = win.children.findIndex((t) => t.uid === b.uid)
    if (indexA === -1 || indexB === -1) return 0
    return indexA - indexB
  })

  // check if destination window and target index are valid
  const targetWindow = Tree.windowsByUid.get(targetWindowUid)
  if (!targetWindow) {
    console.error(`Target window with UID ${targetWindowUid} not found`)
    return
  }
  if (targetIndex < 0 || targetIndex > targetWindow.children.length) {
    console.error(
      `Invalid target index ${targetIndex} for window ${targetWindowUid}`,
    )
    // if index is invalid, set to last position
    targetIndex = targetWindow.children.length
  }

  const newUidMapping: Map<UID, UID> = new Map()
  const updatedWindows: Set<UID> = new Set() // to track which windows have been updated for emitting deltas at the end
  updatedWindows.add(targetWindowUid)

  // move each tab
  for (const tab of tabs) {
    updatedWindows.add(tab.windowUid)
    // check if target index needs to be adjusted depending on tab pinned state
    // i.e. pinned tabs cannot be moved after unpinned tabs and vice versa
    const isPinned = tab.pinned || false
    let originalTargetIndex = targetIndex
    let targetIndexAdjusted = false
    if (isPinned) {
      const lastPinnedIndex = targetWindow.children.findLastIndex(
        (t) => t.type === TreeItemType.TAB && t.pinned,
      )
      // if tab is pinned and target index is after last pinned tab, move it to after last pinned tab
      if (lastPinnedIndex + 1 < targetIndex) {
        targetIndex = lastPinnedIndex + 1
        targetIndexAdjusted = true
      }
    } else {
      const lastPinnedIndex = targetWindow.children.findLastIndex(
        (t) => t.type === TreeItemType.TAB && t.pinned,
      )
      // if tab is unpinned and target index is before pinned tabs, move it to after pinned tabs
      if (lastPinnedIndex !== -1 && targetIndex <= lastPinnedIndex) {
        targetIndex = lastPinnedIndex + 1
        targetIndexAdjusted = true
      }
    }
    const sourceIndex = targetWindow.children.findIndex(
      (t) => t.uid === tab.uid,
    )
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
      copy,
      false, // emitDelta is set to false here to batch updates until the end of the loop
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
        toggleCollapseTab(newTabUid, false) // emitDelta is set to false here to batch updates until the end of the loop
      }
    }
  }

  // emit tree delta events for all updated windows at the end to batch changes
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
 * Moves a single tab to a specified position within a target window.
 * Handles both saved and open tabs.
 *
 * @param {UID} tabUID - The UID of the tab to move.
 * @param {UID} targetWindowUid - The UID of the target window where the tab will be moved.
 * @param {number} targetIndex - The index in the target window's item list where the tab will be inserted.
 * @param {UID} [parentUid] - Optional UID of the parent tab or note, used to calculate indent.
 * @param {boolean} [copy=false] - Whether to copy the tab instead of moving.
 */
export async function moveTab(
  tabUID: UID,
  targetWindowUid: UID,
  targetIndex: number,
  parentUid?: UID,
  copy: boolean = false,
  emitDelta: boolean = true,
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
  const effectiveParentUid =
    parentUid === targetWindowUid ? undefined : parentUid

  if (!tab || !targetWindow) {
    console.error(`moveTab: Tab or target window not found`)
    return
  }

  const parentItem = effectiveParentUid
    ? (Tree.tabsByUid.get(effectiveParentUid) ??
      Tree.notesByUid.get(effectiveParentUid))
    : undefined
  if (
    effectiveParentUid &&
    (!parentItem || parentItem.windowUid !== targetWindowUid)
  ) {
    console.error(
      `moveTab: Parent item ${effectiveParentUid} not found in target window`,
    )
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

  const currentIndexInBrowser = Tree.getTabs(targetWindow.children)
    .filter((t) => t.state === State.OPEN || t.state === State.DISCARDED)
    .findIndex((t) => t.uid === tab.uid)

  // if tab is already in correct position and indent lvl in the session tree, do nothing
  if (
    tab.windowUid === targetWindowUid &&
    targetWindow.children.findIndex((t) => t.uid === tab.uid) === targetIndex &&
    tab.parentUid === effectiveParentUid
  ) {
    return tab.uid
  }

  // remove and add tab in session tree to simulate move
  removeTab(tab.uid, emitDelta)

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
    effectiveParentUid,
    tab.uid,
    emitDelta,
  )

  const targetIndexInBrowser = targetWindow.children.filter(
    (t, index) =>
      index < targetIndex &&
      t.type === TreeItemType.TAB &&
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
        const newTab = targetWindow.children.find(
          (t): t is Tab => t.type === TreeItemType.TAB && t.id === movedTab?.id,
        )
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
