export default defineBackground(() => {
  console.log('Hello background!', { id: browser.runtime.id })

  browser.runtime.onInstalled.addListener(updateBadge)
  browser.tabs.onCreated.addListener(updateBadge)
  browser.tabs.onRemoved.addListener(updateBadge)
  // browser.action.onClicked.addListener(updateBadge)

  browser.browserAction.onClicked.addListener(async () => {
    const { sessionTreeWindowConfig } = await browser.storage.local.get({
      sessionTreeWindowConfig: {
        width: 300,
        height: 700,
        top: 50,
        left: 50,
      },
    })
    console.log('Creating window')
    const sessionTreeWindow = await browser.windows.create({
      type: 'detached_panel',
      url: 'sessionTree.html',
      width: sessionTreeWindowConfig.width,
      height: sessionTreeWindowConfig.height,
      top: sessionTreeWindowConfig.top,
      left: sessionTreeWindowConfig.left,
    })
    console.log(sessionTreeWindow)

    browser.windows.onRemoved.addListener(async (windowId) => {
      console.log(`waiting for id: ${sessionTreeWindow.id} & ${windowId}`)
      console.log(sessionTreeWindow)
      const storage1 = await browser.storage.local.get(null)
      console.log('storage')
      console.log(storage1)
      if (windowId === sessionTreeWindow.id) {
        const updatedWindow = await browser.windows.get(windowId)
        if (updatedWindow) {
          await browser.storage.local.set({
            sessionTreeWindowConfig: {
              width: updatedWindow.width,
              height: updatedWindow.height,
              top: updatedWindow.top,
              left: updatedWindow.left,
            },
          })
        }
      }
    })
  })

  // Updates Extension icon Text and Title to show open tab/window count
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
})
