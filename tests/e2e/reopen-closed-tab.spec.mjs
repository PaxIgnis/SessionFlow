import { browser, expect } from '@wdio/globals'
import {
  closeSessionTreePopup,
  openSessionTreePopup,
} from './support/session-tree-popup.mjs'
import {
  SessionTreePage,
  TreeItemType,
  tabsInWindow,
  windowsInTree,
} from './support/session-tree-page.mjs'
import { withFirefoxChromeContext } from './support/firefox-chrome-context.mjs'

/*
 * Ctrl+Shift+T into a window whose only tab is a blank new tab makes Firefox
 * remove the blank tab and create the restored tab, both while the window stays
 * open. The session tree used to drop the window on that removal and never
 * recover it.
 */
let popup
let sessionTree

describe('reopening a closed tab', () => {
  beforeEach(async () => {
    popup = await openSessionTreePopup()
    sessionTree = new SessionTreePage()
  })

  afterEach(async () => {
    if (popup?.popupHandle) {
      const handles = await browser.getWindowHandles()
      if (handles.includes(popup.popupHandle)) {
        await browser.switchToWindow(popup.popupHandle)
        await closeSessionTreePopup(popup.originalHandle)
      }
    }
    popup = undefined
    sessionTree = undefined
  })

  it('keeps the window when the restored tab replaces a lone blank tab', async () => {
    const windowId = await createBlankWindow()
    const fixtureTabId = await createFixtureTab(windowId)
    await waitForTrackedTabCount(windowId, 2)

    await removeTab(fixtureTabId)
    await waitForTrackedTabCount(windowId, 1)

    await undoCloseTab(windowId)

    const trackedWindow = await waitForTrackedTabCount(windowId, 1)
    const [restoredTab] = tabsInWindow(trackedWindow)
    expect(restoredTab.id).not.toBe(fixtureTabId)
    expect(restoredTab.url).toContain('redirect.html')

    await removeWindow(windowId)
  })

  it('still drops the window when its last tab closes for good', async () => {
    const windowId = await createBlankWindow()
    const fixtureTabId = await createFixtureTab(windowId)
    await waitForTrackedTabCount(windowId, 2)

    await removeTab(fixtureTabId)
    await waitForTrackedTabCount(windowId, 1)

    const [blankTabId] = await browserTabIds(windowId)
    await removeTab(blankTabId)

    await browser.waitUntil(
      async () => (await findTrackedWindow(windowId)) === undefined,
      {
        timeout: 15_000,
        timeoutMsg: `Expected window ${windowId} to leave the session tree.`,
      },
    )
  })
})

async function readTree() {
  await browser.switchToWindow(popup.popupHandle)
  return sessionTree.backgroundTreeSnapshot()
}

async function findTrackedWindow(windowId) {
  const tree = await readTree()
  return windowsInTree(tree).find((item) => item.id === windowId)
}

async function waitForTrackedTabCount(windowId, expectedTabCount) {
  let lastSeen
  await browser.waitUntil(
    async () => {
      lastSeen = await findTrackedWindow(windowId)
      return (
        lastSeen !== undefined &&
        tabsInWindow(lastSeen).length === expectedTabCount
      )
    },
    {
      timeout: 15_000,
      timeoutMsg: `Expected window ${windowId} to hold ${expectedTabCount} tracked tab(s). Last seen: ${JSON.stringify(lastSeen)}`,
    },
  )
  expect(lastSeen.type).toBe(TreeItemType.Window)
  return lastSeen
}

async function createBlankWindow() {
  await browser.switchToWindow(popup.popupHandle)
  const response = await browser.executeAsync((done) => {
    window.browser.windows
      .create({})
      .then((created) => done({ ok: true, id: created.id }))
      .catch((error) => done({ ok: false, error: String(error) }))
  })
  if (!response.ok) throw new Error(response.error)
  return response.id
}

async function createFixtureTab(windowId) {
  await browser.switchToWindow(popup.popupHandle)
  const response = await browser.executeAsync((targetWindowId, done) => {
    const url =
      window.browser.runtime.getURL('/redirect.html') +
      '?targetTitle=' +
      encodeURIComponent('SF Reopen Fixture')
    window.browser.tabs
      .create({ windowId: targetWindowId, url, active: true })
      .then((tab) => done({ ok: true, id: tab.id }))
      .catch((error) => done({ ok: false, error: String(error) }))
  }, windowId)
  if (!response.ok) throw new Error(response.error)
  return response.id
}

async function browserTabIds(windowId) {
  await browser.switchToWindow(popup.popupHandle)
  const response = await browser.executeAsync((targetWindowId, done) => {
    window.browser.tabs
      .query({ windowId: targetWindowId })
      .then((tabs) => done({ ok: true, ids: tabs.map((tab) => tab.id) }))
      .catch((error) => done({ ok: false, error: String(error) }))
  }, windowId)
  if (!response.ok) throw new Error(response.error)
  return response.ids
}

async function removeTab(tabId) {
  await browser.switchToWindow(popup.popupHandle)
  await browser.executeAsync((targetTabId, done) => {
    window.browser.tabs.remove(targetTabId).then(
      () => done(true),
      () => done(false),
    )
  }, tabId)
}

async function removeWindow(windowId) {
  await browser.switchToWindow(popup.popupHandle)
  await browser.executeAsync((targetWindowId, done) => {
    window.browser.windows.remove(targetWindowId).then(
      () => done(true),
      () => done(false),
    )
  }, windowId)
}

/** Runs exactly what Ctrl+Shift+T runs, in the chrome process. */
async function undoCloseTab(windowId) {
  const result = await withFirefoxChromeContext(() =>
    executeChromeScript(
      (targetWindowId) => {
        const { ExtensionParent } = ChromeUtils.importESModule(
          'resource://gre/modules/ExtensionParent.sys.mjs',
        )
        const { SessionWindowUI } = ChromeUtils.importESModule(
          'resource:///modules/sessionstore/SessionWindowUI.sys.mjs',
        )
        const targetWindow =
          ExtensionParent.apiManager.global.windowTracker.getWindow(
            targetWindowId,
          )
        SessionWindowUI.undoCloseTab(targetWindow, 0)
        return true
      },
      [windowId],
    ),
  )
  if (result?.error) {
    throw new Error(`undoCloseTab failed: ${JSON.stringify(result)}`)
  }
}

async function executeChromeScript(scriptFunction, args = []) {
  const protocol = browser.options.protocol ?? 'http'
  const hostname = browser.options.hostname ?? 'localhost'
  const port = browser.options.port
  const basePath = browser.options.path ?? '/'
  const normalizedPath = basePath.endsWith('/')
    ? basePath.slice(0, -1)
    : basePath
  const response = await fetch(
    `${protocol}://${hostname}:${port}${normalizedPath}/session/${browser.sessionId}/execute/sync`,
    {
      method: 'POST',
      headers: { 'content-type': 'application/json; charset=utf-8' },
      body: JSON.stringify({
        script: `return (${scriptFunction.toString()})(...arguments)`,
        args,
      }),
    },
  )
  if (!response.ok) {
    throw new Error(
      `Failed to execute Firefox chrome script: ${response.status} ${await response.text()}`,
    )
  }
  return (await response.json()).value
}
