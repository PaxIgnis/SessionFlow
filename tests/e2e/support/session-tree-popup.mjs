import { $, browser, expect } from '@wdio/globals'
import { FIREFOX_EXTENSION_ID, SESSION_TREE_URL } from './firefox-extension.mjs'
import { clickFirefoxExtensionAction } from './firefox-chrome-context.mjs'
import { collectCoverageFromCurrentWindow } from './e2e-coverage.mjs'

export async function openSessionTreePopup() {
  const originalHandle = await closeStaleSessionTreePopups()
  const handlesBeforeClick = await browser.getWindowHandles()

  await browser.waitUntil(
    async () => {
      if (
        (await browser.getWindowHandles()).length > handlesBeforeClick.length
      ) {
        return true
      }
      await clickFirefoxExtensionAction(FIREFOX_EXTENSION_ID)
      return false
    },
    {
      timeout: 20_000,
      interval: 500,
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

export async function openAdditionalSessionTreePopup() {
  const handlesBeforeOpen = await browser.getWindowHandles()
  const response = await browser.executeAsync((done) => {
    window.browser.windows
      .create({
        type: 'popup',
        url: window.browser.runtime.getURL('/sessiontree.html'),
      })
      .then(() => done({ ok: true }))
      .catch((error) => done({ ok: false, error: String(error) }))
  })
  if (!response?.ok) {
    throw new Error(response?.error || 'Failed to open a second popup.')
  }

  await browser.waitUntil(
    async () =>
      (await browser.getWindowHandles()).some(
        (handle) => !handlesBeforeOpen.includes(handle),
      ),
    {
      timeout: 10_000,
      timeoutMsg: 'Expected a second Session Flow popup window.',
    },
  )
  const popupHandle = (await browser.getWindowHandles()).find(
    (handle) => !handlesBeforeOpen.includes(handle),
  )
  if (!popupHandle) throw new Error('Could not identify the second popup.')

  await browser.switchToWindow(popupHandle)
  await browser.waitUntil(
    async () => (await browser.getUrl()).startsWith(SESSION_TREE_URL),
    {
      timeout: 10_000,
      timeoutMsg: 'Expected the second Session Flow popup to load.',
    },
  )
  await expect(await $('#sessiontree')).toBeExisting()
  return popupHandle
}

export async function closeSessionTreePopupHandle(handle, nextHandle) {
  const handles = await browser.getWindowHandles()
  if (!handles.includes(handle)) return
  await browser.switchToWindow(handle)
  await collectCoverageFromCurrentWindow('session-tree-popup-close')
  await browser.closeWindow()
  if ((await browser.getWindowHandles()).includes(nextHandle)) {
    await browser.switchToWindow(nextHandle)
  }
}

async function closeStaleSessionTreePopups() {
  const initialHandles = await browser.getWindowHandles()
  const initialHandle = await browser.getWindowHandle()
  const stalePopupHandles = []
  const nonPopupHandles = []

  for (const handle of initialHandles) {
    try {
      await browser.switchToWindow(handle)
      const url = await browser.getUrl()
      if (url.startsWith(SESSION_TREE_URL)) stalePopupHandles.push(handle)
      else nonPopupHandles.push(handle)
    } catch {
      // Firefox may remove a fixture window while handles are being inspected.
    }
  }

  for (const handle of stalePopupHandles) {
    try {
      if (!(await browser.getWindowHandles()).includes(handle)) continue
      await browser.switchToWindow(handle)
      await collectCoverageFromCurrentWindow('stale-session-tree-popup-close')
      await browser.closeWindow()
    } catch {
      // A concurrently closed stale popup already satisfies the cleanup.
    }
  }

  const remainingHandles = await browser.getWindowHandles()
  const originalHandle =
    nonPopupHandles.find(
      (handle) => handle === initialHandle && remainingHandles.includes(handle),
    ) ?? nonPopupHandles.find((handle) => remainingHandles.includes(handle))

  if (!originalHandle) {
    throw new Error(
      'Expected a non-Session Flow browser window before opening the popup.',
    )
  }

  await browser.switchToWindow(originalHandle)
  return originalHandle
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
