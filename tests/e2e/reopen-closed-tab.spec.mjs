import { browser, expect } from '@wdio/globals'
import { Key } from 'webdriverio'
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
    const { windowHandle, windowId } = await createBlankWindow()
    const fixtureTabId = await createFixtureTab(windowId)
    await waitForTrackedTabCount(windowId, 2)

    await removeTab(fixtureTabId)
    await waitForTrackedTabCount(windowId, 1)

    await undoCloseTab(windowHandle)

    const trackedWindow = await waitForTrackedTabCount(windowId, 1)
    const [restoredTab] = tabsInWindow(trackedWindow)
    expect(restoredTab.id).not.toBe(fixtureTabId)
    expect(restoredTab.url).toContain('redirect.html')

    await removeWindow(windowId)
  })

  it('still drops the window when its last tab closes for good', async () => {
    const { windowId } = await createBlankWindow()
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
  const handlesBeforeCreate = new Set(await browser.getWindowHandles())
  const response = await browser.executeAsync((done) => {
    window.browser.windows
      .create({})
      .then((created) => done({ ok: true, id: created.id }))
      .catch((error) => done({ ok: false, error: String(error) }))
  })
  if (!response.ok) throw new Error(response.error)

  let windowHandle
  await browser.waitUntil(
    async () => {
      windowHandle = (await browser.getWindowHandles()).find(
        (handle) => !handlesBeforeCreate.has(handle),
      )
      return windowHandle !== undefined
    },
    {
      timeout: 10_000,
      timeoutMsg:
        'Expected the blank Firefox window to expose a WebDriver handle.',
    },
  )

  return { windowHandle, windowId: response.id }
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

async function undoCloseTab(windowHandle) {
  await browser.switchToWindow(windowHandle)
  await withFirefoxChromeContext(async () => {
    await browser
      .action('key')
      .down(Key.Ctrl)
      .down(Key.Shift)
      .down('t')
      .up('t')
      .up(Key.Shift)
      .up(Key.Ctrl)
      .perform()
  })
}
