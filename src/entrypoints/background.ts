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

  interface Window {
    id: number
    tabs: Array<{ id: number; url: string; title: string }>
  }

  class SessionTree {
    windows: Array<Window>
    windowsBackup: Array<Window>

    constructor() {
      this.windows = []
      this.windowsBackup = []
    }

    addWindow(windowId: number) {
      console.log(windowId, sessionTreeWindowId)
      if (windowId === sessionTreeWindowId) {
        return // Do nothing if the windowId is the sessionTreeWindowId
      }
      if (!this.windows.some((w) => w.id === windowId)) {
        const newWindow = { id: windowId, tabs: [] }
        this.windows.push(newWindow)
        this.notifyUpdate('TREE_UPDATED')
        console.log('Window Added in background.ts', this.windows)
      }
    }

    removeWindow(windowId: number) {
      const index = this.windows.findIndex((w) => w.id === windowId)
      if (index !== -1) {
        this.windows.splice(index, 1)
        this.notifyUpdate('TREE_UPDATED')
      }
    }

    addTab(windowId: number, tabId: number, title: string, url: string) {
      console.log('Tab Added in background.ts', windowId, tabId, title, url)
      const window = this.windows.find((w) => w.id === windowId)
      if (window) {
        const newTab = { id: tabId, title, url }
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

    notifyUpdate(type: string) {
      // Send a message to the Vue component about the update
      browser.runtime.sendMessage({ type }).catch((error) => {
        console.error('Error sending message:', error)
      })
    }
  }

  const sessionTree = new SessionTree()

  function getSessionTree(): Array<Window> {
    return sessionTree.windows
  }
  window.getSessionTree = getSessionTree

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
  window.setSessionTree = setSessionTree

  function resetSessionTree() {
    console.log('Resetting Session Tree')
    sessionTree.windows = sessionTree.windowsBackup
  }
  window.resetSessionTree = resetSessionTree

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
      tab.title || 'Untitled',
      tab.url || ''
    )
  })

  browser.tabs.onRemoved.addListener((tabId, removeInfo) => {
    if (removeInfo.windowId === undefined) {
      console.error('Window ID is undefined')
      return
    }
    sessionTree.removeTab(removeInfo.windowId, tabId)
  })
})
