import { browser, expect } from '@wdio/globals'
import {
  FIREFOX_EXTENSION_ID,
  FIREFOX_EXTENSION_UUID,
  SESSION_TREE_URL,
} from './support/firefox-extension.mjs'
import { clickFirefoxExtensionAction } from './support/firefox-chrome-context.mjs'
import {
  closeSessionTreePopup,
  openSessionTreePopup,
} from './support/session-tree-popup.mjs'

describe('SessionFlow Firefox extension smoke', () => {
  it('opens the session tree when the extension action is clicked', async () => {
    const { originalHandle } = await openSessionTreePopup()
    await closeSessionTreePopup(originalHandle)
  })

  it('focuses the existing popup without opening a duplicate (WN-07)', async () => {
    const popup = await openSessionTreePopup()
    await browser.switchToWindow(popup.originalHandle)
    const handlesBefore = (await browser.getWindowHandles()).toSorted()
    expect(await browser.execute(() => document.hasFocus())).toBe(true)

    await clickFirefoxExtensionAction(FIREFOX_EXTENSION_ID)
    await browser.waitUntil(
      async () => !(await browser.execute(() => document.hasFocus())),
      {
        timeoutMsg:
          'Expected the existing Session Flow popup to receive focus.',
      },
    )

    expect((await browser.getWindowHandles()).toSorted()).toEqual(handlesBefore)
    await browser.switchToWindow(popup.popupHandle)
    expect((await browser.getUrl()).startsWith(SESSION_TREE_URL)).toBe(true)
    await closeSessionTreePopup(popup.originalHandle)
  })

  it('opens a replacement when the stored popup ID is stale (WN-08)', async () => {
    const popup = await openSessionTreePopup()
    const staleWindowId = await browser.executeAsync((done) => {
      window.browser.windows.getCurrent().then((window) => done(window.id))
    })
    await closeSessionTreePopup(popup.originalHandle)
    await browser.url(`moz-extension://${FIREFOX_EXTENSION_UUID}/options.html`)
    await browser.executeAsync((windowId, done) => {
      window.browser.runtime
        .sendMessage({ action: 'registerSessionTreeWindow', windowId })
        .then(() => done(true))
        .catch((error) => done({ error: String(error) }))
    }, staleWindowId)
    const handlesBefore = await browser.getWindowHandles()

    await clickFirefoxExtensionAction(FIREFOX_EXTENSION_ID)
    await browser.waitUntil(
      async () =>
        (await browser.getWindowHandles()).length > handlesBefore.length,
      {
        timeout: 20_000,
        timeoutMsg: 'Expected a replacement Session Flow popup.',
      },
    )
    const replacementHandle = (await browser.getWindowHandles()).find(
      (handle) => !handlesBefore.includes(handle),
    )
    if (!replacementHandle) throw new Error('Replacement popup was not found.')

    await browser.switchToWindow(replacementHandle)
    await browser.waitUntil(
      async () => (await browser.getUrl()).startsWith(SESSION_TREE_URL),
      {
        timeoutMsg: 'Expected the replacement popup to load Session Flow.',
      },
    )
    expect(replacementHandle).not.toBe(popup.popupHandle)
    await closeSessionTreePopup(popup.originalHandle)
  })
})
