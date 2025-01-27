import { Window, State } from './sessiontree/sessiontree.interfaces'
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

    const sessionTreeWindow = await browser.windows.create({
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
        console.log('Success Removing Window', windowId)
        this.windows.splice(index, 1)
      } else {
        console.error('Error Removing Window', windowId)
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

    removeTab(windowId: number, tabId: number) {
      const window = this.windows.find((w) => w.id === windowId)
      if (window) {
        const index = window.tabs.findIndex((tab) => tab.id === tabId)
        if (index !== -1) {
          window.tabs.splice(index, 1)
          this.notifyUpdate('TREE_UPDATED')
        }
      }
    }

    updateState(windowId: number, tabId: number, state: State) {
      const window = this.windows.find((w) => w.id === windowId)
      if (window) {
        const tab = window.tabs.find((t) => t.id === tabId)
        if (tab) {
          tab.state = state
        }
      }
    }

    updateTab(
      windowId: number,
      tabId: number,
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
          this.notifyUpdate('TREE_UPDATED')
        }
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

  // ==============================
  // Utility Functions
  // ==============================

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

  // ==============================
  // Exposed Functions for the SessionTree Vue component
  // ==============================

  window.getSessionTree = getSessionTree
  window.setSessionTree = setSessionTree
  window.resetSessionTree = resetSessionTree

  // ==============================
  // Event Listeners
  // ==============================

  browser.windows.onCreated.addListener((window) => {
    console.log('sessionTree', sessionTree)
    if (window.id === undefined) {
      console.error('Window ID is undefined')
      return
    }
    console.log('Window Added', window.id, window)
    sessionTree.addWindow(window.id)
  })

  browser.windows.onRemoved.addListener((windowId) => {
    sessionTree.removeWindow(windowId)
  })
  browser.tabs.onCreated.addListener((tab) => {
    console.log('Tab Added', tab)
  })
  browser.tabs.onCreated.addListener((tab) => {
    if (tab.windowId === undefined || tab.id === undefined) {
      console.error('Tab or Window ID is undefined')
      return
    }
    sessionTree.addTab(
      tab.windowId,
      tab.id,
      State.OPEN,
      tab.title || 'Untitled',
      tab.url || ''
    )
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
      State.OPEN,
      tab.title || '',
      tab.url || ''
    )
  })

  browser.runtime.onMessage.addListener((message, sender, sendResponse) => {
    if (message.action === 'closeTab' && message.tabId) {
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
    } else if (message.action === 'saveTab' && message.tabId) {
      console.log('Saving Tab', message.tabId, message.windowId)
      sessionTree.updateState(message.windowId, message.tabId, State.SAVED)
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
  })
})
