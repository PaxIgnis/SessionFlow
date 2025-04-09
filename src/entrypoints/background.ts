import {
  Window,
  State,
  PendingItem,
  WindowPosition,
} from './sessiontree/sessiontree.interfaces'
import { Settings } from '@/services/settings'

export default defineBackground(() => {
  console.log('Hello, SessionFlow Background has Started!', {
    id: browser.runtime.id,
  })

  const initializeSettings = () => {
    return Settings.loadSettingsFromStorage()
  }
  // Call initialization when background starts
  initializeSettings()
    .then(() => {
      if (Settings.values.openSessionTreeOnStartup) {
        setTimeout(() => {
          openSessionTree()
        }, 1000)
      }
      updateWindowPositionInterval()
    })
    .catch((error) => {
      console.error('Failed to initialize settings:', error)
    })

  // Initialize variables
  let sessionTreeWindowId: number | undefined

  // Initialize Listeners
  browser.runtime.onInstalled.addListener(updateBadge)
  browser.tabs.onCreated.addListener(updateBadge)
  browser.tabs.onRemoved.addListener(updateBadge)
  // browser.action.onClicked.addListener(updateBadge)

  browser.browserAction.onClicked.addListener(() => {
    openSessionTree().catch((error) => {
      console.error('Error opening SessionTree:', error)
    })
  })

  // browser.windows.onFocusChanged.addListener((windowId) => {
  //   saveSessionWindowDetails(windowId)
  // })

  browser.windows.onRemoved.addListener((windowId) => {
    removeSessionWindowId(windowId)
  })

  async function removeSessionWindowId(windowId: number) {
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

    const sessionTreeWindow = await createWindowAndWait(properties)
    sessionTreeWindowId = sessionTreeWindow.id
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

  browser.menus.create({
    id: 'open-settings',
    title: 'Settings',
    contexts: ['browser_action'],
  })

  browser.menus.onClicked.addListener((info, tab) => {
    // if (info.menuItemId === 'toggle-sessiontree-sidebar') {
    //   browser.sidebarAction.toggle()
    // }
    if (info.menuItemId === 'open-sessiontree') {
      openSessionTree()
    } else if (info.menuItemId === 'open-settings') {
      browser.runtime.openOptionsPage()
    }
  })

  // ==============================
  // Class Definitions
  // ==============================

  class SessionTree {
    private readonly STORAGE_KEY = 'sessionTree'
    windows: Array<Window>
    windowsBackup: Array<Window>

    constructor() {
      this.windows = []
      this.windowsBackup = []
      this.initializeWindows()
    }

    /**
     * Initializes the session tree by first loading the save tree from storage,
     * and then updating it with the current state of the browser.
     *
     * @returns {Promise<void>} A promise that resolves when the session tree has been initialized.
     */
    async initializeWindows() {
      try {
        await this.loadSessionTreeFromStorage()
        const currentWindows = await browser.windows.getAll({ populate: true })
        currentWindows.forEach((win) => {
          const newWindow: Window = {
            id: win.id!,
            serialId: 0,
            state: State.OPEN,
            tabs: win.tabs!.map((tab) => ({
              id: tab.id!,
              serialId: 0,
              state: State.OPEN,
              title: tab.title!,
              url: tab.url!,
            })),
          }
          this.windows.push(newWindow)
        })
        this.serializeSessionTree()
      } catch (error) {
        console.error('Error initializing windows:', error)
      }
    }

    /**
     * Serializes the session tree by assigning serial IDs to windows and tabs.
     */
    serializeSessionTree() {
      this.windows.forEach((window, windowIndex) => {
        window.serialId = windowIndex
        window.tabs.forEach((tab, tabIndex) => {
          tab.serialId = tabIndex
        })
      })
    }

    /**
     * Loads the session tree from local storage.
     *
     * @returns {Promise<void>} A promise that resolves when the session tree has been loaded.
     */
    async loadSessionTreeFromStorage() {
      try {
        const sessionTree = await browser.storage.local.get(this.STORAGE_KEY)
        console.debug('Session Tree from storage:', sessionTree)
        if (sessionTree[this.STORAGE_KEY]) {
          this.windows = sessionTree[this.STORAGE_KEY]
          this.windows.forEach((window) => {
            window.id = 0
            window.state = State.SAVED
            if (!window.savedTime) window.savedTime = Date.now()
            window.tabs.forEach((tab) => {
              tab.id = 0
              tab.state = State.SAVED
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
    async saveSessionTreeToStorage() {
      try {
        await browser.storage.local.set({ [this.STORAGE_KEY]: this.windows })
      } catch (error) {
        console.error('Error saving session tree to storage:', error)
      }
    }

    /**
     * Adds a blank window to the session tree,
     * and then updates it with the current state in the browser.
     *
     * @param {number} windowId - The ID of the window to add.
     */
    addWindow(windowId: number) {
      console.log('Adding Window', windowId)
      if (!this.windows.some((w) => w.id === windowId)) {
        const newWindow = {
          id: windowId,
          serialId: 0,
          state: State.OPEN,
          tabs: [],
          collapsed: false,
        }
        this.windows.push(newWindow)
        this.serializeSessionTree()
        this.updateWindowTabs(windowId)
      }
    }

    /**
     * Updates a window in the session tree to match the current state in the browser.
     *
     * @param {number} windowId - The ID of the window to update.
     * @returns {Promise<void>} A promise that resolves when the window has been updated.
     */
    async updateWindowTabs(windowId: number) {
      try {
        const win = await browser.windows.get(windowId, { populate: true })
        const window = this.windows.find((w) => w.id === windowId)
        if (window) {
          window.tabs = win.tabs!.map((tab) => ({
            id: tab.id!,
            serialId: 0,
            state: State.OPEN,
            title: tab.title!,
            url: tab.url!,
          }))
          this.serializeSessionTree()
        }
      } catch (error) {
        console.error('Error updating window tabs:', error)
      }
    }

    /**
     * Removes a window from the session tree.
     *
     * @param {number} windowSerialId - The serial ID of the window to remove.
     */
    removeWindow(windowSerialId: number) {
      console.debug('Remove Window', windowSerialId)
      const index = this.windows.findIndex((w) => w.serialId === windowSerialId)
      if (index !== -1) {
        console.log(
          `Success Removing Window ${windowSerialId} from sessionTree`
        )
        this.windows.splice(index, 1)
        this.serializeSessionTree()
      } else {
        console.error(
          `Error Removing Window ${windowSerialId} from sessionTree`
        )
      }
    }

    /**
     * Adds a tab to the session tree.
     *
     * @param {number} windowId - The ID of the window containing the tab.
     * @param {number} tabId - The ID of the tab to add.
     * @param {State} state - The state of the tab.
     * @param {string} title - The title of the tab.
     * @param {string} url - The URL of the tab.
     * @param {number} index - The index to insert the tab at, if not provided the tab is added to the end.
     */
    addTab(
      windowId: number,
      tabId: number,
      state: State,
      title: string,
      url: string,
      index?: number
    ) {
      console.log('Tab Added in background.ts', windowId, tabId, title, url)
      const window = this.windows.find((w) => w.id === windowId)
      if (!window) {
        console.error('Error adding tab, could not find window:', windowId)
        return
      }
      if (index !== undefined) {
        window.tabs.splice(index, 0, {
          id: tabId,
          serialId: 0,
          state,
          title,
          url,
        })
      } else {
        window.tabs.push({ id: tabId, serialId: 0, state, title, url })
      }
      this.serializeSessionTree()
    }

    /**
     * Returns the title of a tab in the session tree.
     *
     * @param {number} windowSerialId - The serial ID of the window containing the tab.
     * @param {number} tabSerialId - The serial ID of the tab to get the title of.
     * @returns {string} The title of the tab, or an empty string if not found.
     */
    getTabTitle(windowSerialId: number, tabSerialId: number) {
      const window = this.windows.find((w) => w.serialId === windowSerialId)
      if (window) {
        const tab = window.tabs.find((t) => t.serialId === tabSerialId)
        if (tab) {
          return tab.title
        }
      }
      return ''
    }

    /**
     * Returns the state of a tab in the session tree.
     *
     * @param {number} windowSerialId - The serial ID of the window containing the tab.
     * @param {number} tabSerialId - The serial ID of the tab to get the state of.
     * @returns {State} The state of the tab.
     */
    getTabState(windowSerialId: number, tabSerialId: number) {
      const window = this.windows.find((w) => w.serialId === windowSerialId)
      if (window) {
        const tab = window.tabs.find((t) => t.serialId === tabSerialId)
        if (tab) {
          return tab.state
        }
      }
      return State.OTHER
    }

    /**
     * Removes a tab from the session tree and updates the state.
     *
     * @param {number} windowSerialId - The serial ID of the window containing the tab.
     * @param {number} tabSerialId - The serial ID of the tab to be removed.
     */
    removeTab(windowSerialId: number, tabSerialId: number) {
      const window = this.windows.find((w) => w.serialId === windowSerialId)
      if (window) {
        const index = window.tabs.findIndex(
          (tab) => tab.serialId === tabSerialId
        )
        if (index !== -1) {
          console.log('removeTab success', windowSerialId, tabSerialId)
          window.tabs.splice(index, 1)
          this.serializeSessionTree()
        } else {
          console.error('Error removing tab:', windowSerialId, tabSerialId)
        }
      }
    }

    /**
     * Updates the state of a tab in the session tree.
     *
     * @param {number} windowSerialId - The serial ID of the window containing the tab.
     * @param {number} tabSerialId - The serial ID of the tab to update.
     * @param {State} state - The new state to assign to the tab.
     */
    updateTabState(windowSerialId: number, tabSerialId: number, state: State) {
      const window = this.windows.find((w) => w.serialId === windowSerialId)
      if (window) {
        const tab = window.tabs.find((t) => t.serialId === tabSerialId)
        if (tab) {
          tab.state = state
        }
      }
    }

    /**
     * Updates the state of a window in the session tree.
     *
     * @param {number} windowSerialId - The serial ID of the window to update.
     * @param {State} state - The new state to assign to the window.
     */
    updateWindowState(windowSerialId: number, state: State) {
      const window = this.windows.find((w) => w.serialId === windowSerialId)
      if (window) {
        window.state = state
        if (state === State.SAVED) {
          window.savedTime = Date.now()
        }
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
        }
      }
    }

    /**
     * Updates the id of a window in the session tree
     *
     * @param {number} windowSerialId - The current Serial ID of the window to be updated.
     * @param {number} newWindowId - The new ID to assign to the window.
     */
    updateWindowId(windowSerialId: number, newWindowId: number) {
      const window = this.windows.find((w) => w.serialId === windowSerialId)
      if (window) {
        window.id = newWindowId
      }
    }

    /**
     * Updates the id of a tab in the session tree
     *
     * @param {number} windowSerialId - The current Serial ID of the window to be updated.
     * @param {number} tabSerialId - The current Serial ID of the tab to be updated.
     * @param {number} newTabId - The new ID to assign to the tab.
     */
    updateTabId(windowSerialId: number, tabSerialId: number, newTabId: number) {
      const window = this.windows.find((w) => w.serialId === windowSerialId)
      if (window) {
        const tab = window.tabs.find((t) => t.serialId === tabSerialId)
        if (tab) {
          tab.id = newTabId
        }
      }
    }

    notifyUpdate(type: string) {
      // Send a message to the Vue component about the update
      browser.runtime.sendMessage({ type }).catch((error) => {
        console.error('Error sending message:', error)
      })
    }

    /**
     * Sets the state of the window and all tabs to SAVED and resets the IDs.
     *
     * @param {number} windowSerialId - The Serial ID of the window to save.
     */
    saveWindow(windowSerialId: number) {
      const window = this.windows.find((w) => w.serialId === windowSerialId)
      if (window) {
        window.state = State.SAVED
        window.id = -1
        window.savedTime = Date.now()
        window.tabs.forEach((tab) => {
          tab.state = State.SAVED
          tab.id = -1
        })
      }
    }

    /**
     * Sets the state of the tab to SAVED and resets the ID.
     *
     * @param {number} windowSerialId - The Serial ID of the window containing the tab.
     * @param {number} tabSerialId - The Serial ID of the tab to save.
     */
    saveTab(windowSerialId: number, tabSerialId: number) {
      const window = this.windows.find((w) => w.serialId === windowSerialId)
      if (window) {
        const tab = window.tabs.find((t) => t.serialId === tabSerialId)
        if (tab) {
          tab.state = State.SAVED
          tab.id = -1
        }
      }
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

  let windowPositionInterval: NodeJS.Timeout | undefined

  // ==============================
  // Utility Functions
  // ==============================

  /**
   * Updates the stored position of a window in the session tree.
   *
   * @param {number} windowId - The ID of the window to update.
   * @param {WindowPosition} position - The new position of the window.
   */
  function updateWindowPosition(windowId: number, position: WindowPosition) {
    const window = sessionTree.windows.find((w) => w.id === windowId)
    if (window) {
      window.windowPosition = position
    }
  }

  /**
   * Updates the interval for periodically checking and updating the position of open windows.
   * This function clears the existing interval and sets a new one based on the configured update interval.
   * Is called when the related settings are changed.
   *
   */
  function updateWindowPositionInterval() {
    // Clear existing interval
    if (windowPositionInterval) {
      clearInterval(windowPositionInterval)
    }
    if (!Settings.values.openWindowsInSameLocation) {
      return
    }
    // Calculate interval in milliseconds
    const intervalMs =
      Settings.values.openWindowsInSameLocationUpdateInterval *
      (Settings.values.openWindowsInSameLocationUpdateIntervalUnit === 'seconds'
        ? 1000
        : 60000)
    windowPositionInterval = setInterval(async () => {
      try {
        const windows = await browser.windows.getAll()
        windows.forEach((window) => {
          if (
            window.id &&
            window.id !== sessionTreeWindowId &&
            window.left &&
            window.top &&
            window.width &&
            window.height
          ) {
            updateWindowPosition(window.id, {
              left: window.left,
              top: window.top,
              width: window.width,
              height: window.height,
            })
          }
        })
      } catch (error) {
        console.error('Error updating window positions:', error)
      }
    }, intervalMs)
  }

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
    let tabCount = 0
    if (properties?.url) {
      // Handle both string and string[] cases
      tabCount = Array.isArray(properties.url) ? properties.url.length : 1
      pendingTabCount += tabCount
    }
    const window = await browser.windows
      .create(properties || {})
      .catch((error) => {
        console.error('Error creating window:', error)
        pendingTabCount -= tabCount
        throw error
      })
    // Update window position if provided. This is necessary
    // because top/left are ignored before Firefox 109.
    if (properties?.left && properties?.top) {
      await browser.windows.update(window.id!, {
        left: properties.left,
        top: properties.top,
      })
    }

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
    if (!window.id || !window.tabs) {
      throw new Error('Window creation failed: ID or tabs undefined')
    }
    addPendingWindowToQueue(window.id, true, false)
    await waitForWindowId(window.id)
    if (tabCount > 0) {
      const promises: Promise<void>[] = []
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
      for (const tab of window.tabs) {
        if (!tab.id) {
          throw new Error('Tab ID is undefined')
        }
        addPendingTabToQueue(tab.id, true, false)
        promises.push(waitForTabId(tab.id))
      }
      await Promise.all(promises)
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
    const tab = await browser.tabs.create(properties).catch((error) => {
      console.error('Error creating tab:', error)
      pendingTabCount--
      throw error
    })
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

  /**
   * Returns the session tree.
   *
   * @returns {Array<Window>} The session tree
   */
  function getSessionTree(): Array<Window> {
    return sessionTree.windows
  }

  /**
   * Sets the session tree to a new tree, saving the current tree as a backup.
   *
   * @param {Array<Window>} newTree - The new session tree
   */
  function setSessionTree(newTree: Array<Window>) {
    sessionTree.windowsBackup = sessionTree.windows
    sessionTree.windows = newTree
  }

  /**
   * Resets the session tree to the backup session tree.
   */
  function resetSessionTree() {
    console.log('Resetting Session Tree')
    sessionTree.windows = sessionTree.windowsBackup
    sessionTree.saveSessionTreeToStorage()
  }

  /**
   * Builds the redirect URL for privileged Firefox URLs
   *
   * @param {string} targetUrl - The URL to redirect to
   * @param {string} targetTitle - The title of the target URL
   * @returns {string} The redirect URL
   */
  function getRedirectUrl(targetUrl: string, targetTitle: string) {
    const redirectUrl =
      browser.runtime.getURL('/redirect.html') +
      `?targetUrl=${encodeURIComponent(targetUrl)}` +
      `&targetTitle=${encodeURIComponent(targetTitle)}`
    return redirectUrl
  }

  /**
   * Checks if a URL is a privileged URL for Firefox
   *
   * @param {string} url - The URL to check
   * @returns {boolean} True if the URL is a privileged URL, false otherwise
   */
  function isPrivilegedUrl(url: string): boolean {
    const isPrivilegedUrl = privilegedUrls.some((privilegedUrl) =>
      url.startsWith(privilegedUrl)
    )
    const startsWithAbout =
      url.startsWith('about:') &&
      !url.startsWith('about:blank') &&
      !url.startsWith('about:newtab')
    return isPrivilegedUrl || startsWithAbout
  }

  /**
   * Checks if a url can be discarded without error.
   *
   * @param {string} url - The URL to check
   * @returns {boolean} True if the URL can be discarded, false otherwise
   */
  function discardedUrlPrecheck(url: string): boolean {
    const about = url.startsWith('about:')
    const empty = url === ''
    return !(about || empty || isPrivilegedUrl(url))
  }

  /**
   * Closes a tab by removing it from the browser and removing it from the session tree.
   *
   * @param {Object} message - The message object containing tab and window information.
   * @param {number} message.tabId - The ID of the tab to be closed.
   * @param {number} message.tabSerialId - The Serial ID of the tab to be closed.
   * @param {number} message.windowSerialId - The Serial ID of the window containing the tab.
   * @param {Function} sendResponse - The function to send a response back to the sender.
   */
  function closeTab(message: {
    tabId: number
    tabSerialId: number
    windowSerialId: number
  }) {
    if (
      message.tabSerialId !== undefined &&
      message.windowSerialId !== undefined
    ) {
      sessionTree.removeTab(message.windowSerialId, message.tabSerialId)
      // if this is the last open tab in the window but there are other saved tabs then
      // update the window state to SAVED and reset id
      const window = sessionTree.windows.find(
        (w) => w.serialId === message.windowSerialId
      )
      if (window) {
        const openTabs = window.tabs.filter((tab) => tab.state === State.OPEN)
        if (window.tabs.length > 0 && openTabs.length === 0) {
          sessionTree.updateWindowState(message.windowSerialId, State.SAVED)
          sessionTree.updateWindowId(message.windowSerialId, -1)
        } else if (window.tabs.length === 0) {
          // if there are no tabs left in the window, remove the window
          sessionTree.removeWindow(message.windowSerialId)
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
    return
  }

  /**
   * Closes a window by removing it from the browser and removing it from the session tree.
   *
   * @param {Object} message - The message object containing window information.
   * @param {number} message.windowId - The ID of the window to be closed.
   * @param {number} message.windowSerialId - The Serial ID of the window to be closed.
   * @param {Function} sendResponse - The function to send a response back to the sender.
   */
  function closeWindow(message: { windowId: number; windowSerialId: number }) {
    if (message.windowSerialId !== undefined) {
      sessionTree.removeWindow(message.windowSerialId)
    }
    if (message.windowId === -1 || message.windowId === 0) {
      return
    }
    browser.windows
      .get(message.windowId)
      .then((window) => {
        if (window) {
          browser.windows.remove(message.windowId).catch((error) => {
            console.error('Error closing window:', error)
          })
        }
      })
      .catch(() => {
        console.debug('Window ID not found.', message.windowId)
      })
    return
  }

  /**
   * Saves a tab by removing it from the browser and updating the session tree.
   * If it is the last open tab in the window, the window state is updated to SAVED and the ID is reset.
   * Then the same is done for the tab and finally the tab is removed from the browser.
   *
   * @param {Object} message - The message object containing tab and window information.
   * @param {number} message.tabId - The ID of the tab to be saved.
   * @param {number} message.tabSerialId - The Serial ID of the tab to be saved.
   * @param {number} message.windowSerialId - The Serial ID of the window containing the tab.
   * @param {Function} sendResponse - The function to send a response back to the sender.
   */
  function saveTab(message: {
    tabId: number
    tabSerialId: number
    windowSerialId: number
  }) {
    if (
      message.tabSerialId !== undefined &&
      message.windowSerialId !== undefined
    ) {
      if (
        sessionTree.getTabState(message.windowSerialId, message.tabSerialId) ===
        State.SAVED
      ) {
        // tab is already saved, do nothing
        return true
      }
      // if this is the last open tab in the window, update the window state to SAVED and reset id
      const window = sessionTree.windows.find(
        (w) => w.serialId === message.windowSerialId
      )
      if (window) {
        const openTabs = window.tabs.filter((tab) => tab.state === State.OPEN)
        if (openTabs.length === 1) {
          sessionTree.saveWindow(message.windowSerialId)
        }
      }
      sessionTree.saveTab(message.windowSerialId, message.tabSerialId)
    }
    browser.tabs.remove(message.tabId).catch((error) => {
      console.error('Error saving tab:', error)
    })
    return
  }

  /**
   * Saves a window by removing it from the browser and updating the session tree.
   *
   * @param {Object} message - The message object containing window information.
   * @param {number} message.windowId - The ID of the window to be saved.
   * @param {number} message.windowSerialId - The Serial ID of the window to be saved.
   * @param {Function} sendResponse - The function to send a response back to the sender.
   */
  function saveWindow(message: { windowId: number; windowSerialId: number }) {
    sessionTree.updateWindowState(message.windowSerialId, State.SAVED)
    sessionTree.updateWindowId(message.windowSerialId, -1)
    const window = sessionTree.windows.find(
      (w) => w.serialId === message.windowSerialId
    )
    if (window) {
      for (const tab of window.tabs) {
        sessionTree.updateTabState(
          message.windowSerialId,
          tab.serialId,
          State.SAVED
        )
        sessionTree.updateTabId(message.windowSerialId, tab.serialId, -1)
      }
    }
    browser.windows.remove(message.windowId).catch((error) => {
      console.error('Error saving window:', error)
    })
    return
  }

  /**
   * Opens a tab by creating it in the browser and updating the session tree.
   *
   * @param {Object} message - The message object containing tab and window information.
   * @param {number} message.tabSerialId - The Serial ID of the tab to be opened.
   * @param {number} message.windowSerialId - The Serial ID of the window containing the tab.
   * @param {string} message.url - The URL to be opened in the tab.
   */
  async function openTab(message: {
    tabSerialId: number
    windowSerialId: number
    url?: string
    discarded?: boolean
  }) {
    const sessionTreeWindow = sessionTree.windows.find(
      (w) => w.serialId === message.windowSerialId
    )
    if (!sessionTreeWindow) {
      throw new Error('Saved window not found')
    }
    const sessionTreeTab = sessionTreeWindow.tabs.find(
      (t) => t.serialId === message.tabSerialId
    )
    if (!sessionTreeTab) {
      throw new Error('Saved tab not found')
    }
    let url = message.url
    if (url === undefined) url = sessionTreeTab.url
    // if the URL is a privileged URL, open a redirect page instead
    if (isPrivilegedUrl(url)) {
      const title = sessionTree.getTabTitle(
        message.windowSerialId,
        message.tabSerialId
      )
      url = getRedirectUrl(url, title)
    } else if (
      url === 'about:newtab' ||
      url === 'about:blank' ||
      url === 'chrome://browser/content/blanktab.html'
    ) {
      // don't set the URL for new tabs
      url = undefined
    }
    sessionTree.updateTabState(
      message.windowSerialId,
      message.tabSerialId,
      State.OPEN
    )
    if (sessionTreeWindow.state === State.SAVED) {
      // if the window is saved, open the window first
      sessionTree.updateWindowState(message.windowSerialId, State.OPEN)
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
        const window = await createWindowAndWait(properties).catch((error) => {
          console.error('Error creating window:', error)
          // revert changes since window wasn't created
          sessionTree.updateWindowState(message.windowSerialId, State.SAVED)
          sessionTree.updateTabState(
            message.windowSerialId,
            message.tabSerialId,
            State.SAVED
          )
          return
        })
        if (!window) {
          console.error('Window is undefined')
          return
        }
        // because Firefox doesn't support opening unfocused windows, we send focus back
        if (!Settings.values.focusWindowOnOpen && sessionTreeWindowId) {
          focusWindow({ windowId: sessionTreeWindowId })
        }
        if (!window.id) {
          throw new Error('Window ID is undefined')
        }
        // then update the saved window object id to represent the newly opened window
        sessionTree.updateWindowId(message.windowSerialId, window.id)
        const tab = window.tabs![0]
        sessionTree.updateTabId(
          message.windowSerialId,
          message.tabSerialId,
          tab.id!
        )
        sessionTree.updateTabState(
          message.windowSerialId,
          message.tabSerialId,
          State.OPEN
        )
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
        if (url && discardedUrlPrecheck(url)) {
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

      // find id of first open tab to the right
      const tabToRightIndex = sessionTreeWindow.tabs
        .filter((tab) => tab.state === State.OPEN)
        .findIndex(
          (tab, index, array) =>
            array[index - 1]?.serialId === message.tabSerialId
        )
      if (tabToRightIndex !== -1) {
        properties.index = tabToRightIndex - 1
      }
      try {
        const tab = await createTabAndWait(properties).catch((error) => {
          console.error('Error creating tab:', error)
          // revert changes since window wasn't created
          sessionTree.updateTabState(
            message.windowSerialId,
            message.tabSerialId,
            State.SAVED
          )
          return
        })
        if (!tab) {
          console.error('Tab is undefined')
          return
        }
        sessionTree.updateTabId(
          message.windowSerialId,
          message.tabSerialId,
          tab.id!
        )
        sessionTree.updateTabState(
          message.windowSerialId,
          message.tabSerialId,
          State.OPEN
        )
      } catch (error) {
        console.error('Error opening tab:', error)
      }
    }
    return
  }

  /**
   * Focuses a tab by updating the browser tab to be active.
   *
   * @param {Object} message - The message object containing tab information.
   * @param {number} message.tabId - The ID of the tab to be focused.
   * @param {Function} sendResponse - The function to send a response back to the sender.
   */
  function focusTab(message: { tabId: number }) {
    browser.tabs.update(message.tabId, { active: true }).catch((error) => {
      console.error('Error focusing tab:', error)
    })
    return
  }

  /**
   * Focuses a window by updating the browser window to be active.
   *
   * @param {Object} message - The message object containing window information.
   * @param {number} message.windowId - The ID of the window to be focused.
   * @param {Function} sendResponse - The function to send a response back to the sender.
   */
  function focusWindow(message: { windowId: number }) {
    browser.windows
      .update(message.windowId, { focused: true })
      .catch((error) => {
        console.error('Error focusing window:', error)
      })
    return
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
   * @param {number} message.windowSerialId - The Serial ID of the window to be opened from sessionTree.
   * @param {Function} sendResponse - The function to send a response back to the sender.
   */
  async function openWindow(message: { windowSerialId: number }) {
    // First change the state of the window in sessionTree to from SAVED to OPEN
    sessionTree.updateWindowState(message.windowSerialId, State.OPEN)
    try {
      const sessionTreeWindow = sessionTree.windows.find(
        (w) => w.serialId === message.windowSerialId
      )
      if (!sessionTreeWindow) {
        throw new Error('Saved window not found')
      }
      const urls: string[] = []
      for (const tab of sessionTreeWindow.tabs) {
        let url = String(tab.url)
        // if the URL is a privileged URL, open a redirect page instead
        if (isPrivilegedUrl(url)) {
          const title = sessionTree.getTabTitle(
            sessionTreeWindow.serialId,
            tab.serialId
          )
          url = getRedirectUrl(url, title)
        } else if (
          url === 'about:newtab' ||
          url === 'chrome://browser/content/blanktab.html'
        ) {
          // don't set the URL for new tabs
          url = 'about:blank'
        }
        urls.push(url)
      }
      const properties: browser.windows._CreateCreateData = {}
      if (urls.length > 0) properties.url = urls
      if (Settings.values.openWindowWithTabsDiscarded) {
        if (urls.length > 1) {
          properties.url = urls[0]
        }
      }
      if (
        Settings.values.openWindowsInSameLocation &&
        sessionTreeWindow.windowPosition
      ) {
        properties.left = sessionTreeWindow.windowPosition.left
        properties.top = sessionTreeWindow.windowPosition.top
        properties.width = sessionTreeWindow.windowPosition.width
        properties.height = sessionTreeWindow.windowPosition.height
      }
      const window = await createWindowAndWait(properties)
      if (!Settings.values.focusWindowOnOpen && sessionTreeWindowId) {
        focusWindow({ windowId: sessionTreeWindowId })
      }
      if (!window.id || !window.tabs) {
        throw new Error('Window ID is undefined')
      }

      // then update the saved window object id to represent the newly opened window
      sessionTree.updateWindowId(message.windowSerialId, window.id)
      window.tabs.forEach((tab, index) => {
        sessionTree.updateTabId(
          sessionTreeWindow?.serialId,
          sessionTreeWindow?.tabs[index].serialId,
          tab.id!
        )
        sessionTree.updateTabState(
          sessionTreeWindow?.serialId,
          sessionTreeWindow?.tabs[index].serialId,
          State.OPEN
        )
      })
      if (Settings.values.openWindowWithTabsDiscarded && urls.length > 1) {
        for (const tab of sessionTreeWindow.tabs) {
          if (tab.state === State.SAVED) {
            openTab({
              tabSerialId: tab.serialId,
              windowSerialId: message.windowSerialId,
              discarded: true,
            })
          }
        }
      }
    } catch (error) {
      console.error('Error opening window:', error)
    }
    return
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

  /**
   * Event listener for when a tab is updated. This is used to detect when a tab's favicon is updated.
   * When a favicon is updated, a message is sent to the Vue component to update the favicon in the cache.
   * This is done in the SessionTree.vue file.
   *
   */
  browser.tabs.onUpdated.addListener((tabId, changeInfo, tab) => {
    if (changeInfo.favIconUrl && browser.extension.getViews().length > 0) {
      window.browser.runtime
        .sendMessage({
          type: 'FAVICON_UPDATED',
          favIconUrl: changeInfo.favIconUrl,
          tab: tab,
        })
        .catch(() => {
          console.debug('No receivers for favicon update')
        })
    }
  })

  /**
   * When a window is created, add it to the session tree.
   * If the window is created by the extension, do nothing as it is already in the session tree.
   */
  browser.windows.onCreated.addListener(async (window) => {
    if (window.id === undefined) {
      console.error('Window ID is undefined')
      return
    }
    const extensionWindow = await isNewWindowExtensionGenerated(window.id)
    if (!extensionWindow) {
      sessionTree.addWindow(window.id)
    }
  })

  /**
   * When a window is removed, remove it from the session tree.
   * If the window is saved, do nothing.
   * If the window has saved tabs, save the window instead of removing.
   * If the window only has 1 tab, save the window instead of removing.
   */
  browser.windows.onRemoved.addListener((windowId) => {
    if (!sessionTree) {
      return
    }
    const window = sessionTree.windows.find((w) => w.id === windowId)
    if (!window) {
      return
    }
    if (window.state === State.SAVED) {
      return
    }
    // if window has saved tabs, save the window instead of removing
    const savedTabs = window.tabs.filter((tab) => tab.state === State.SAVED)
    if (
      Settings.values.saveWindowOnClose ||
      (savedTabs.length > 0 &&
        Settings.values.saveWindowOnCloseIfContainsSavedTabs) ||
      (Settings.values.saveWindowOnCloseIfPreviouslySaved &&
        window.savedTime! > 0)
    ) {
      sessionTree.saveWindow(window.serialId)
      return
    }
    const tabCount = window.tabs.length
    // if this window only has 1 tab, then save the window instead of removing
    if (tabCount === 1 && Settings.values.saveTabOnClose) {
      sessionTree.saveWindow(window.serialId)
    } else {
      sessionTree.removeWindow(window.serialId)
    }
  })

  /**
   * When a tab is created, add it to the session tree.
   * If the tab is created by the extension, do nothing as it is already in the session tree.
   */
  browser.tabs.onCreated.addListener(async (tab) => {
    if (tab.windowId === undefined || tab.id === undefined) {
      console.error('Tab or Window ID is undefined')
      return
    }
    const extensionTab = await isNewTabExtensionGenerated(tab.id)
    if (!extensionTab) {
      const window = sessionTree.windows.find((w) => w.id === tab.windowId)
      // if Window ID is not in session tree, then the window was just opened,
      // so window listener will handle adding the tab to the session tree.
      if (!window) {
        return
      }
      sessionTree.addTab(
        tab.windowId,
        tab.id,
        State.OPEN,
        tab.title || 'Untitled',
        tab.url || ''
      )
    }
  })

  /**
   * When a tab is removed, remove it from the session tree.
   * If the tab is saved, do nothing.
   * If the window is also closing, do nothing.
   */
  browser.tabs.onRemoved.addListener((tabId, removeInfo) => {
    if (removeInfo.windowId === undefined) {
      console.error('Window ID is undefined')
      return
    }
    if (!sessionTree) {
      return
    }
    const window = sessionTree.windows.find((w) => w.id === removeInfo.windowId)
    if (!window) {
      return
    }
    const index = window.tabs.findIndex((tab) => tab.id === tabId)
    if (index === -1) {
      return
    }
    if (window.tabs[index].state === State.SAVED) {
      return
    }
    if (removeInfo.isWindowClosing) {
      return
    }
    if (Settings.values.saveTabOnClose) {
      sessionTree.saveTab(window.serialId, window.tabs[index].serialId)
      return
    }
    sessionTree.removeTab(window.serialId, window.tabs[index].serialId)
  })

  /**
   * When a tab is updated, update the session tree to match the new tab state.
   * This includes tab id, title and url.
   */
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

  /**
   * When a tab is moved within a window, update the session tree to match the new tab order.
   */
  browser.tabs.onMoved.addListener(async (tabId, moveInfo) => {
    console.debug('Tab Moved:', tabId, moveInfo)
    if (
      moveInfo.windowId === undefined ||
      moveInfo.toIndex === undefined ||
      tabId === undefined
    ) {
      console.error('Tab or Window ID is undefined')
      return
    }
    const window = sessionTree.windows.find((w) => w.id === moveInfo.windowId)
    if (!window) {
      return
    }
    const openSessionTreeTabs = window.tabs.filter(
      (tab) => tab.state === State.OPEN
    )
    const openBrowserTabs = await browser.tabs.query({
      windowId: moveInfo.windowId,
    })
    if (!openSessionTreeTabs || !openBrowserTabs) {
      console.error('Error getting tabs')
      return
    }
    // return if order matches
    if (
      openSessionTreeTabs.every(
        (tab, index) => tab.id === openBrowserTabs[index].id
      )
    ) {
      return
    }
    // if order doesn't match, update the sessionTree order to match the browser order
    const movedTabIndex = window.tabs.findIndex((tab) => tab.id === tabId)
    const tab = window.tabs.splice(movedTabIndex, 1)[0]
    if (moveInfo.toIndex + 1 >= openSessionTreeTabs.length) {
      // place in last position
      window.tabs.push(tab)
    } else {
      // move to the position immediately before the tab to the right in the browser
      const rightTabId = openBrowserTabs[moveInfo.toIndex + 1].id
      const rightTabIndex = window.tabs.findIndex(
        (tab) => tab.id === rightTabId
      )
      window.tabs.splice(rightTabIndex, 0, tab)
    }
    sessionTree.serializeSessionTree()
  })

  /**
   * When a tab is detached from a window, remove it from the session tree.
   */
  browser.tabs.onDetached.addListener((tabId, detachInfo) => {
    console.debug('Tab Detached:', tabId, detachInfo)
    if (detachInfo.oldWindowId === undefined || tabId === undefined) {
      console.error('Tab or Window ID is undefined')
      return
    }
    const window = sessionTree.windows.find(
      (w) => w.id === detachInfo.oldWindowId
    )
    if (!window) {
      return
    }
    const index = window.tabs.findIndex((tab) => tab.id === tabId)
    if (index === -1) {
      return
    }
    window.tabs.splice(index, 1)
    sessionTree.serializeSessionTree()
  })

  /**
   * When a tab is attached to a window, add it to the session tree.
   * If the tab is attached to the left of another tab, insert it at that index.
   */
  browser.tabs.onAttached.addListener(async (tabId, attachInfo) => {
    console.debug('Tab Attached:', tabId, attachInfo)
    if (attachInfo.newWindowId === undefined || tabId === undefined) {
      console.error('Tab or Window ID is undefined')
      return
    }
    const window = sessionTree.windows.find(
      (w) => w.id === attachInfo.newWindowId
    )
    if (!window) {
      return
    }
    const tab = await browser.tabs.get(tabId)
    if (!tab) {
      console.error('Tab not found in window')
      return
    }
    // get the id of the tab to the right in the browser
    const tabToRight = await browser.tabs.query({
      windowId: attachInfo.newWindowId,
      index: tab.index + 1,
    })
    const tabToRightId = tabToRight.length > 0 ? tabToRight[0].id : undefined
    // if there is no tab to the right, add the tab to the end
    if (tabToRightId === undefined) {
      sessionTree.addTab(
        attachInfo.newWindowId,
        tabId,
        State.OPEN,
        tab.title || 'Untitled',
        tab.url || ''
      )
      return
    } else {
      // if there is a tab to the right, insert it to the left of that tab
      const tabToRightIndex = window.tabs.findIndex(
        (tab) => tab.id === tabToRightId
      )
      sessionTree.addTab(
        attachInfo.newWindowId,
        tabId,
        State.OPEN,
        tab.title || 'Untitled',
        tab.url || '',
        tabToRightIndex
      )
    }
  })

  /**
   * Listen for messages from the Vue component session tree.
   * Most of these will be user actions performed in the session tree.
   */
  browser.runtime.onMessage.addListener((message) => {
    if (message.action === 'closeTab') {
      closeTab(message)
    } else if (message.action === 'saveTab') {
      saveTab(message)
    } else if (message.action === 'openTab') {
      openTab(message)
    } else if (message.action === 'closeWindow') {
      closeWindow(message)
    } else if (message.action === 'saveWindow') {
      saveWindow(message)
    } else if (message.action === 'openWindow') {
      openWindow(message)
    } else if (message.action === 'focusTab') {
      focusTab(message)
      focusWindow(message)
    } else if (message.action === 'focusWindow') {
      focusWindow(message)
    } else if (message.action === 'openWindowsInSameLocationUpdated') {
      updateWindowPositionInterval()
    }
  })
})
