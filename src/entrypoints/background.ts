import {
  Window,
  State,
  PendingItem,
} from './sessiontree/sessiontree.interfaces'
export default defineBackground(() => {
  console.log('Hello, SessionFlow Background has Started!', {
    id: browser.runtime.id,
  })

  // Initialize variables
  let sessionTreeWindowId: number | undefined

  // Initialize Listeners
  browser.runtime.onInstalled.addListener(updateBadge)
  browser.tabs.onCreated.addListener(updateBadge)
  browser.tabs.onRemoved.addListener(updateBadge)
  // browser.action.onClicked.addListener(updateBadge)

  browser.browserAction.onClicked.addListener(async () => {
    openSessionTree()
  })

  // browser.windows.onFocusChanged.addListener((windowId) => {
  //   saveSessionWindowDetails(windowId)
  // })

  browser.windows.onRemoved.addListener((windowId) => {
    removeSessionWindowId(windowId)
  })

  async function removeSessionWindowId(windowId) {
    if (windowId === sessionTreeWindowId) {
      sessionTreeWindowId = undefined
    }
  }

  // async function saveSessionWindowDetails(windowId) {
  //   if (windowId === sessionTreeWindowId) {
  //     try {
  //       const window = await browser.windows.get(windowId, { populate: false })
  //       if (window) {
  //         const { width, height, top, left } = window
  //         await browser.storage.local.set({
  //           sessionTreeWindowConfig: { width, height, top, left },
  //         })
  //       }
  //     } catch (error) {
  //       console.error('Error retreiving window information', error)
  //     }
  //   }
  // }

  // Updates Extension badge Text and Title to show open tab/window count
  async function updateBadge() {
    const tabs = await browser.tabs.query({})
    const tabCount = tabs.length
    const windows = await browser.windows.getAll()
    const windowCount = windows.length
    await browser.browserAction.setBadgeText({ text: `${tabCount}` })
    await browser.browserAction.setTitle({
      title: `${windowCount} windows / ${tabCount} tabs`,
    })
  }

  async function openSessionTree() {
    if (sessionTreeWindowId) {
      const openWindows = await browser.windows.getAll()
      const exists = openWindows.some(
        (window) => window.id === sessionTreeWindowId
      )

      if (exists) {
        await browser.windows.update(sessionTreeWindowId, { focused: true })
        return // Window is already open
      }
    }
    // get last window position and size from storage
    let bounds
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

    const sessionTreeWindow = await createWindowAndWait({
      type: 'popup',
      url: 'sessiontree.html',
      width: bounds.width,
      height: bounds.height,
      top: bounds.top,
      left: bounds.left,
    })
    sessionTreeWindowId = sessionTreeWindow.id
    // Remove SessionTreeWindow from windows list when opened
    if (sessionTreeWindowId) {
      sessionTree.removeWindow(sessionTreeWindowId)
    }
  }

  // browser.menus.create({
  //   id: 'toggle-sessiontree-sidebar',
  //   title: 'Toggle Sidebar',
  //   contexts: ['browser_action'],
  // })

  browser.menus.create({
    id: 'open-sessiontree',
    title: 'Open SessionTree',
    contexts: ['browser_action'],
  })

  browser.menus.onClicked.addListener((info, tab) => {
    // if (info.menuItemId === 'toggle-sessiontree-sidebar') {
    //   browser.sidebarAction.toggle()
    // }
    if (info.menuItemId === 'open-sessiontree') {
      openSessionTree()
    }
  })

  // ==============================
  // Class Definitions
  // ==============================

  class SessionTree {
    windows: Array<Window>
    windowsBackup: Array<Window>

    constructor() {
      this.windows = []
      this.windowsBackup = []
      this.initializeWindows()
    }

    async initializeWindows() {
      try {
        const currentWindows = await browser.windows.getAll({ populate: true })
        currentWindows.forEach((win) => {
          const newWindow: Window = {
            id: win.id!,
            state: State.OPEN,
            tabs: win.tabs!.map((tab) => ({
              id: tab.id!,
              state: State.OPEN,
              title: tab.title!,
              url: tab.url!,
            })),
          }
          this.windows.push(newWindow)
        })
      } catch (error) {
        console.error('Error initializing windows:', error)
      }
    }

    addWindow(windowId: number) {
      console.log('Adding Window', windowId)
      if (!this.windows.some((w) => w.id === windowId)) {
        const newWindow = { id: windowId, state: State.OPEN, tabs: [] }
        this.windows.push(newWindow)
        this.updateWindowTabs(windowId)
      }
    }

    async updateWindowTabs(windowId: number) {
      try {
        const win = await browser.windows.get(windowId, { populate: true })
        const window = this.windows.find((w) => w.id === windowId)
        if (window) {
          window.tabs = win.tabs!.map((tab) => ({
            id: tab.id!,
            state: State.OPEN,
            title: tab.title!,
            url: tab.url!,
          }))
        }
      } catch (error) {
        console.error('Error updating window tabs:', error)
      }
    }

    removeWindow(windowId: number) {
      console.log('Remove Window', windowId)
      const index = this.windows.findIndex((w) => w.id === windowId)
      if (index !== -1) {
        console.log(`Success Removing Window ${windowId} from sessionTree`)
        this.windows.splice(index, 1)
      } else {
        console.error(`Error Removing Window ${windowId} from sessionTree`)
      }
    }

    addTab(
      windowId: number,
      tabId: number,
      state: State,
      title: string,
      url: string
    ) {
      console.log('Tab Added in background.ts', windowId, tabId, title, url)
      const window = this.windows.find((w) => w.id === windowId)
      if (window) {
        const newTab = { id: tabId, state, title, url }
        window.tabs.push(newTab)
        this.notifyUpdate('TREE_UPDATED')
      }
    }

    getTabTitle(windowId: number, tabId: number) {
      const window = this.windows.find((w) => w.id === windowId)
      if (window) {
        const tab = window.tabs.find((t) => t.id === tabId)
        if (tab) {
          return tab.title
        }
      }
      return ''
    }

    /**
     * Removes a tab from the session tree and updates the state.
     *
     * @param {number} windowId - The ID of the window containing the tab.
     * @param {number} tabId - The ID of the tab to be removed.
     */
    removeTab(windowId: number, tabId: number) {
      const window = this.windows.find((w) => w.id === windowId)
      if (window) {
        const index = window.tabs.findIndex((tab) => tab.id === tabId)
        if (index !== -1) {
          console.log('removeTab success', windowId, tabId)
          window.tabs.splice(index, 1)
          this.notifyUpdate('TREE_UPDATED')
        } else {
          console.error('Error removing tab:', windowId, tabId)
        }
      }
    }

    updateTabState(windowId: number, tabId: number, state: State) {
      const window = this.windows.find((w) => w.id === windowId)
      if (window) {
        const tab = window.tabs.find((t) => t.id === tabId)
        if (tab) {
          tab.state = state
        }
      }
    }

    /**
     * Updates the state of a window in the session tree.
     *
     * @param {number} windowId - The ID of the window to update.
     * @param {State} state - The new state to assign to the window.
     */
    updateWindowState(windowId: number, state: State) {
      const window = this.windows.find((w) => w.id === windowId)
      if (window) {
        window.state = state
      }
      return true
    }

    /**
     * Updates the state, title, URL and id of a tab in the session tree.
     *
     * @param {number} windowId - The ID of the window containing the tab.
     * @param {number} tabId - The current ID of the tab to be updated.
     * @param {number} newTabId - The new ID to assign to the tab.
     * @param {State} state - The new state to assign to the tab.
     * @param {string} title - The new title to assign to the tab.
     * @param {string} url - The new URL to assign to the tab.
     */
    updateTab(
      windowId: number,
      tabId: number,
      newTabId: number,
      state: State,
      title: string,
      url: string
    ) {
      const window = this.windows.find((w) => w.id === windowId)
      if (window) {
        const tab = window.tabs.find((t) => t.id === tabId)
        if (tab) {
          tab.state = state
          tab.title = title
          tab.url = url
          tab.id = newTabId
          this.notifyUpdate('TREE_UPDATED')
        }
      }
    }

    /**
     * Updates the id of a window in the session tree
     *
     * @param {number} windowId - The current ID of the window to be updated.
     * @param {number} newWindowId - The new ID to assign to the window.
     */
    updateWindowId(windowId: number, newWindowId: number) {
      const window = this.windows.find((w) => w.id === windowId)
      if (window) {
        window.id = newWindowId
      }
    }

    notifyUpdate(type: string) {
      // Send a message to the Vue component about the update
      browser.runtime.sendMessage({ type }).catch((error) => {
        console.error('Error sending message:', error)
      })
    }
  }

  // ==============================
  // Global Variables
  // ==============================

  const sessionTree = new SessionTree()
  const privilegedUrls = [
    'about:config',
    'about:addons',
    'about:debugging',
    'chrome:',
    'javascript:',
    'data:',
    'file:',
  ]
  let pendingWindowCount = 0
  const pendingWindows: Map<number, PendingItem> = new Map()

  let pendingTabCount = 0
  const pendingTabs: Map<number, PendingItem> = new Map()

  // ==============================
  // Utility Functions
  // ==============================

  /**
   * Checks if a window was created by the extension by tracking it in the pending windows queue.
   * Returns true if the window was created by the extension, false if created by user action.
   * This function is called be the onCreated listener for new windows.
   *
   * @param {number} windowId - The ID of the window to check.
   * @returns {Promise<boolean>} A promise that resolves to true if window was created by extension.
   */
  async function isNewWindowExtensionGenerated(
    windowId: number
  ): Promise<boolean> {
    const waitForWindowId = (windowId: number): Promise<boolean> => {
      return new Promise((resolve) => {
        const interval = setInterval(() => {
          if (pendingWindowCount > 0) {
            addPendingWindowToQueue(windowId, false, true)
            const window = pendingWindows.get(windowId)
            if (window && window.complete) {
              pendingWindowCount--
              pendingWindows.delete(windowId)
              clearInterval(interval)
              resolve(true)
            }
          } else {
            pendingWindows.delete(windowId)
            clearInterval(interval)
            resolve(false)
          }
        }, 100)
      })
    }
    return await waitForWindowId(windowId)
  }

  /**
   * Checks if a tab was created by the extension by tracking it in the pending tabs queue.
   * Returns true if the tab was created by the extension, false if created by user action.
   * This function is called be the onCreated listener for new tabs.
   *
   * @param {number} tabId - The ID of the tab to check.
   * @returns {Promise<boolean>} A promise that resolves to true if tab was created by extension.
   */
  async function isNewTabExtensionGenerated(tabId: number): Promise<boolean> {
    const waitForTabId = (tabId: number): Promise<boolean> => {
      return new Promise((resolve) => {
        const interval = setInterval(() => {
          if (pendingTabCount > 0) {
            addPendingTabToQueue(tabId, false, true)
            const tab = pendingTabs.get(tabId)
            if (tab && tab.complete) {
              pendingTabCount--
              pendingTabs.delete(tabId)
              clearInterval(interval)
              resolve(true)
            }
          } else {
            pendingTabs.delete(tabId)
            clearInterval(interval)
            resolve(false)
          }
        }, 100)
      })
    }
    return await waitForTabId(tabId)
  }

  /**
   * Creates a new browser window and waits for both the creation event and listener
   * acknowledgment before resolving. This ensures the window is fully initialized
   * before continuing.
   *
   * The function:
   * 1. Increments pending window count
   * 2. Creates new window
   * 3. Adds window to pending queue
   * 4. Waits for listener to resolve
   *
   * @param {Object} properties - The properties to create the window with
   * @returns {Promise<browser.windows.Window>} The fully initialized window object
   * @throws {Error} If window creation fails or window ID is undefined
   *
   */
  async function createWindowAndWait(
    properties?: browser.windows._CreateCreateData
  ): Promise<browser.windows.Window> {
    pendingWindowCount++
    const window = await browser.windows.create(properties || {})
    const waitForWindowId = (windowId: number): Promise<void> => {
      return new Promise((resolve) => {
        const interval = setInterval(() => {
          const window = pendingWindows.get(windowId)
          if (window && window.listenerResolved) {
            window.complete = true
            clearInterval(interval)
            resolve()
          }
        }, 100)
      })
    }
    if (window.id !== undefined) {
      addPendingWindowToQueue(window.id, true, false)
      await waitForWindowId(window.id)
    } else {
      console.error('Window ID is undefined')
    }
    return window
  }

  /**
   * Creates a new tab and waits for both the creation event and listener
   * acknowledgment before resolving. This ensures the tab is fully initialized
   * before continuing.
   *
   * The function:
   * 1. Increments pending tab count
   * 2. Creates new tab
   * 3. Adds tab to pending queue
   * 4. Waits for listener to resolve
   *
   * @param {Object} properties - The properties to create the tab with
   * @returns {Promise<browser.tabs.Tab>} The fully initialized tab object
   * @throws {Error} If tab creation fails or tab ID is undefined
   *
   */
  async function createTabAndWait(properties): Promise<browser.tabs.Tab> {
    pendingTabCount++
    const tab = await browser.tabs.create(properties)
    const waitForTabId = (tabId: number): Promise<void> => {
      return new Promise((resolve) => {
        const interval = setInterval(() => {
          const tab = pendingTabs.get(tabId)
          if (tab && tab.listenerResolved) {
            tab.complete = true
            clearInterval(interval)
            resolve()
          }
        }, 100)
      })
    }
    if (tab.id !== undefined) {
      addPendingTabToQueue(tab.id, true, false)
      await waitForTabId(tab.id)
    } else {
      console.error('Tab ID is undefined')
    }
    return tab
  }

  /**
   * Adds a window to the pending windows queue or updates an existing entry.
   * Windows in this queue are tracked to coordinate between window creation
   * and the onCreated event listener.
   *
   * When a window is created, both the creator and listener must resolve
   * before the window is considered complete. This function manages the
   * resolution flags for both parties.
   *
   * @param {number} windowId - The ID of the window to add/update
   * @param {boolean} creatorResolved - Flag indicating if creator has resolved
   * @param {boolean} listenerResolved - Flag indicating if listener has resolved
   */
  function addPendingWindowToQueue(
    windowId: number,
    creatorResolved: boolean,
    listenerResolved: boolean
  ): void {
    if (!pendingWindows.has(windowId)) {
      pendingWindows.set(windowId, {
        id: windowId,
        complete: false,
        creatorResolved: creatorResolved,
        listenerResolved: listenerResolved,
      })
    } else {
      const window = pendingWindows.get(windowId)
      if (window) {
        if (creatorResolved) {
          window.creatorResolved = true
        } else if (listenerResolved) {
          window.listenerResolved = true
        }
      }
      return
    }
  }

  /**
   * Adds a tab to the pending tabs queue or updates an existing entry.
   * Tabs in this queue are tracked to coordinate between tab creation
   * and the onCreated event listener.
   *
   * When a tab is created, both the creator and listener must resolve
   * before the tab is considered complete. This function manages the
   * resolution flags for both parties.
   *
   * @param {number} tabId - The ID of the tab to add/update
   * @param {boolean} creatorResolved - Flag indicating if creator has resolved
   * @param {boolean} listenerResolved - Flag indicating if listener has resolved
   */
  function addPendingTabToQueue(
    tabId: number,
    creatorResolved: boolean,
    listenerResolved: boolean
  ): void {
    if (!pendingTabs.has(tabId)) {
      pendingTabs.set(tabId, {
        id: tabId,
        complete: false,
        creatorResolved: creatorResolved,
        listenerResolved: listenerResolved,
      })
    } else {
      const tab = pendingTabs.get(tabId)
      if (tab) {
        if (creatorResolved) {
          tab.creatorResolved = true
        } else if (listenerResolved) {
          tab.listenerResolved = true
        }
      }
      return
    }
  }

  function getSessionTree(): Array<Window> {
    return sessionTree.windows
  }

  function setSessionTree(newTree: Array<Window>) {
    console.log(
      'Setting Session Tree',
      sessionTree.windows,
      sessionTree.windowsBackup
    )
    sessionTree.windowsBackup = sessionTree.windows
    sessionTree.windows = newTree
    console.log(
      'After Setting Session Tree',
      sessionTree.windows,
      sessionTree.windowsBackup
    )
  }

  function resetSessionTree() {
    console.log('Resetting Session Tree')
    sessionTree.windows = sessionTree.windowsBackup
  }

  // build the redirect URL for privileged URLs
  function getRedirectUrl(targetUrl: string, targetTitle: string) {
    const redirectUrl =
      browser.runtime.getURL('/redirect.html') +
      `?targetUrl=${encodeURIComponent(targetUrl)}` +
      `&targetTitle=${encodeURIComponent(targetTitle)}`
    return redirectUrl
  }

  // check if a URL is a privileged URL for Firefox
  function isPrivilegedUrl(url: string): boolean {
    return privilegedUrls.some((privilegedUrl) => url.startsWith(privilegedUrl))
  }

  /**
   * Closes a tab by removing it from the browser and removing it from the session tree.
   *
   * @param {Object} message - The message object containing tab and window information.
   * @param {number} message.tabId - The ID of the tab to be closed.
   * @param {number} message.windowId - The ID of the window containing the tab.
   * @param {Function} sendResponse - The function to send a response back to the sender.
   * @returns {boolean} - Indicates that the response will be sent asynchronously.
   */
  function closeTab(message, sendResponse) {
    sessionTree.removeTab(message.windowId, message.tabId)
    browser.tabs
      .remove(message.tabId)
      .then(() => {
        sendResponse({ success: true })
      })
      .catch((error) => {
        console.error('Error closing tab:', error)
        sendResponse({ success: false, error: error })
      })
    return true // Indicates that the response will be sent asynchronously
  }

  /**
   * Closes a window by removing it from the browser and removing it from the session tree.
   *
   * @param {Object} message - The message object containing window information.
   * @param {number} message.windowId - The ID of the window to be closed.
   * @param {Function} sendResponse - The function to send a response back to the sender.
   * @returns {boolean} - Indicates that the response will be sent asynchronously.
   */
  function closeWindow(message, sendResponse) {
    sessionTree.removeWindow(message.windowId)
    browser.windows
      .remove(message.windowId)
      .then(() => {
        sendResponse({ success: true })
      })
      .catch((error) => {
        console.error('Error closing window:', error)
        sendResponse({ success: false, error: error })
      })
    return true // Indicates that the response will be sent asynchronously
  }

  /**
   * Saves a tab by removing it from the browser and updating the session tree.
   *
   * @param {Object} message - The message object containing tab and window information.
   * @param {number} message.tabId - The ID of the tab to be saved.
   * @param {number} message.windowId - The ID of the window containing the tab.
   * @param {Function} sendResponse - The function to send a response back to the sender.
   * @returns {boolean} - Indicates that the response will be sent asynchronously.
   */
  function saveTab(message, sendResponse) {
    sessionTree.updateTabState(message.windowId, message.tabId, State.SAVED)
    browser.tabs
      .remove(message.tabId)
      .then(() => {
        sendResponse({ success: true })
      })
      .catch((error) => {
        console.error('Error saving tab:', error)
        sendResponse({ success: false, error: error })
      })
    return true // Indicates that the response will be sent asynchronously
  }

  /**
   * Saves a window by removing it from the browser and updating the session tree.
   *
   * @param {Object} message - The message object containing window information.
   * @param {number} message.windowId - The ID of the window to be saved.
   * @param {Function} sendResponse - The function to send a response back to the sender.
   * @returns {boolean} - Indicates that the response will be sent asynchronously.
   */
  function saveWindow(message, sendResponse) {
    sessionTree.updateWindowState(message.windowId, State.SAVED)
    const window = sessionTree.windows.find((w) => w.id === message.windowId)
    if (window) {
      for (const tab of window.tabs) {
        sessionTree.updateTabState(message.windowId, tab.id, State.SAVED)
      }
    }
    browser.windows
      .remove(message.windowId)
      .then(() => {
        sendResponse({ success: true })
      })
      .catch((error) => {
        console.error('Error saving window:', error)
        sendResponse({ success: false, error: error })
      })
    return true // Indicates that the response will be sent asynchronously
  }

  /**
   * Opens a tab by creating it in the browser and updating the session tree.
   *
   * @param {Object} message - The message object containing tab and window information.
   * @param {number} message.tabId - The ID of the tab to be opened.
   * @param {number} message.windowId - The ID of the window containing the tab.
   * @param {string} message.url - The URL to be opened in the tab.
   * @param {Function} sendResponse - The function to send a response back to the sender.
   * @returns {boolean} - Indicates that the response will be sent asynchronously.
   */
  async function openTab(message, sendResponse) {
    sessionTree.updateTabState(message.windowId, message.tabId, State.OPEN)
    let properties: { windowId: number; active: boolean; url?: string } = {
      windowId: message.windowId,
      active: true,
    }
    // if the URL is a privileged URL, open a redirect page instead
    if (isPrivilegedUrl(message.url)) {
      const title = sessionTree.getTabTitle(message.windowId, message.tabId)
      properties.url = getRedirectUrl(message.url, title)
    } else if (message.url !== 'about:newtab') {
      // don't set the URL for new tabs
      properties.url = message.url
    }
    try {
      const tab = await createTabAndWait(properties)
      // Update the old tab in sessionTree with the new tab details
      sessionTree.updateTab(
        message.windowId,
        message.tabId,
        tab.id!,
        State.OPEN,
        tab.title || '',
        tab.url || ''
      )
      sendResponse({ success: true })
    } catch (error) {
      console.error('Error opening tab:', error)
      sendResponse({ success: false, error: error })
    }
    return true // Indicates that the response will be sent asynchronously
  }

  function printSessionTree(string: string = '') {
    console.log('******************************')
    console.log(`Printing Session Tree: ${string}:`)
    for (const window of sessionTree.windows) {
      console.log(`Window ID: ${window.id}`)
      for (const tab of window.tabs) {
        console.log(`  Tab ID: ${tab.id}. Title: ${tab.title}. URL: ${tab.url}`)
      }
    }
    console.log('_____________________________')
  }

  /**
   * Opens a window by creating it in the browser and updating the session tree.
   *
   * @param {Object} message - The message object containing window information.
   * @param {number} message.windowId - The ID of the window to be opened from sessionTree.
   * @param {Function} sendResponse - The function to send a response back to the sender.
   * @returns {boolean} - Indicates that the response will be sent asynchronously.
   */
  async function openWindow(message, sendResponse) {
    // First change the state of the window in sessionTree to from SAVED to OPEN
    sessionTree.updateWindowState(message.windowId, State.OPEN)
    try {
      const window = await createWindowAndWait()

      if (window.id === undefined) {
        throw new Error('Window ID is undefined')
      } else {
        const newtab = window.tabs![0]
        // remove the new window object from the sessionTree
        // sessionTree.removeWindow(window.id)
        // then update the saved window object id to represent the newly opened window
        sessionTree.updateWindowId(message.windowId, window.id)
        // open up all the tabs in the window
        const savedWindow = sessionTree.windows.find((w) => w.id === window.id)
        if (savedWindow) {
          for (const tab of savedWindow.tabs) {
            await openTab(
              {
                tabId: tab.id,
                windowId: savedWindow.id,
                url: tab.url,
              },
              () => {}
            )
          }
        } else {
          console.error('Error opening window:', window.id)
        }
        // remove the default tab from the new window
        closeTab({ tabId: newtab.id, windowId: window.id }, () => {})
      }
      sendResponse({ success: true })
    } catch (error) {
      console.error('Error opening window:', error)
      sendResponse({ success: false, error: error })
    }
    return true // Indicates that the response will be sent asynchronously
  }

  // ==============================
  // Exposed Functions for the SessionTree Vue component
  // ==============================

  window.getSessionTree = getSessionTree
  window.setSessionTree = setSessionTree
  window.resetSessionTree = resetSessionTree

  // ==============================
  // Event Listeners
  // ==============================

  browser.windows.onCreated.addListener(async (window) => {
    if (window.id === undefined) {
      console.error('Window ID is undefined')
      return
    }
    console.log('Window Added, id: ', window.id)
    const extensionWindow = await isNewWindowExtensionGenerated(window.id)
    if (!extensionWindow) {
      console.log(
        'New window not Extension Generated, continuing to .addWindow'
      )
      sessionTree.addWindow(window.id)
    }
  })

  browser.windows.onRemoved.addListener((windowId) => {
    if (sessionTree) {
      const window = sessionTree.windows.find((w) => w.id === windowId)
      if (window) {
        if (window.state !== State.SAVED) {
          console.log('Removing Window from sessionTree: ', windowId)
          sessionTree.removeWindow(windowId)
        }
      }
    }
  })

  browser.tabs.onCreated.addListener(async (tab) => {
    if (tab.windowId === undefined || tab.id === undefined) {
      console.error('Tab or Window ID is undefined')
      return
    }
    console.error(
      `new tab detected, adding to sessionTree. windowId: ${tab.windowId} tabId: ${tab.id} title: ${tab.title} url: ${tab.url}`
    )
    const extensionTab = await isNewTabExtensionGenerated(tab.id)
    if (!extensionTab) {
      console.log('New tab not Extension Generated, continuing to .addTab')
      sessionTree.addTab(
        tab.windowId,
        tab.id,
        State.OPEN,
        tab.title || 'Untitled',
        tab.url || ''
      )
      printSessionTree('after browser.tabs.Created')
    }
  })

  browser.tabs.onRemoved.addListener((tabId, removeInfo) => {
    if (removeInfo.windowId === undefined) {
      console.error('Window ID is undefined')
      return
    }
    if (sessionTree) {
      const window = sessionTree.windows.find(
        (w) => w.id === removeInfo.windowId
      )
      if (window) {
        const index = window.tabs.findIndex((tab) => tab.id === tabId)
        if (index !== -1) {
          if (window.tabs[index].state !== State.SAVED) {
            sessionTree.removeTab(removeInfo.windowId, tabId)
          }
        }
      }
    }
  })

  browser.tabs.onUpdated.addListener((tabId, changeInfo, tab) => {
    if (tab.windowId === undefined || tab.id === undefined) {
      console.error('Tab or Window ID is undefined')
      return
    }
    sessionTree.updateTab(
      tab.windowId,
      tab.id,
      tab.id,
      State.OPEN,
      tab.title || '',
      tab.url || ''
    )
  })

  browser.runtime.onMessage.addListener((message, sender, sendResponse) => {
    if (message.action === 'closeTab' && message.tabId) {
      return closeTab(message, sendResponse)
    } else if (message.action === 'saveTab' && message.tabId) {
      return saveTab(message, sendResponse)
    } else if (message.action === 'openTab' && message.tabId) {
      return openTab(message, sendResponse)
    } else if (message.action === 'closeWindow' && message.windowId) {
      return closeWindow(message, sendResponse)
    } else if (message.action === 'saveWindow' && message.windowId) {
      return saveWindow(message, sendResponse)
    } else if (message.action === 'openWindow' && message.windowId) {
      return openWindow(message, sendResponse)
    }
  })
})
