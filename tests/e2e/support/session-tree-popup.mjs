import { $, browser, expect } from '@wdio/globals'
import { FIREFOX_EXTENSION_ID, SESSION_TREE_URL } from './firefox-extension.mjs'
import { clickFirefoxExtensionAction } from './firefox-chrome-context.mjs'
import { collectCoverageFromCurrentWindow } from './e2e-coverage.mjs'

export async function openSessionTreePopup() {
  const handlesBeforeClick = await browser.getWindowHandles()
  const originalHandle = await browser.getWindowHandle()

  await browser.waitUntil(
    async () => {
      if (
        (await browser.getWindowHandles()).length > handlesBeforeClick.length
      ) {
        return true
      }

      await clickFirefoxExtensionAction(FIREFOX_EXTENSION_ID)
      return (
        (await browser.getWindowHandles()).length > handlesBeforeClick.length
      )
    },
    {
      timeout: 10_000,
      timeoutMsg:
        'Expected the extension action to open a session tree window.',
    },
  )

  const handlesAfterClick = await browser.getWindowHandles()
  const openedHandle = handlesAfterClick.find(
    (handle) => !handlesBeforeClick.includes(handle),
  )

  if (!openedHandle) {
    throw new Error('Could not find the new session tree window handle.')
  }

  await browser.switchToWindow(openedHandle)

  await browser.waitUntil(
    async () => (await browser.getUrl()).startsWith(SESSION_TREE_URL),
    {
      timeout: 10_000,
      timeoutMsg: `Expected opened window URL to start with ${SESSION_TREE_URL}.`,
    },
  )
  await expect(browser).toHaveTitle('Session Flow')
  await expect(await $('#sessiontree')).toBeExisting()

  return {
    originalHandle,
    popupHandle: openedHandle,
  }
}

export async function closeSessionTreePopup(originalHandle) {
  await collectCoverageFromCurrentWindow('session-tree-popup-close')
  await browser.closeWindow()
  const handles = await browser.getWindowHandles()
  const nextHandle = handles.includes(originalHandle)
    ? originalHandle
    : handles[0]

  if (nextHandle) {
    await browser.switchToWindow(nextHandle)
  }
}
