import { browser } from '@wdio/globals'
import { collectCoverageFromOpenWindows } from './e2e-coverage.mjs'

export async function browserWindowSnapshot() {
  const snapshot = []
  const originalHandle = await browser.getWindowHandle().catch(() => undefined)

  for (const handle of await browser.getWindowHandles()) {
    try {
      await browser.switchToWindow(handle)
      snapshot.push({
        handle,
        url: await browser.getUrl(),
        title: await browser.getTitle(),
      })
    } catch (error) {
      snapshot.push({ handle, error: String(error) })
    }
  }

  if ((await browser.getWindowHandles()).includes(originalHandle)) {
    await browser.switchToWindow(originalHandle)
  }
  return snapshot
}

// Only use in suites that own the entire WebDriver browser session.
export async function resetBrowserWindows(keepHandle) {
  await collectCoverageFromOpenWindows('workflow-browser-reset')
  // Callers may preserve a known normal fixture tab. Otherwise create a normal
  // window before closing anything, even if only popups remain.
  if (!keepHandle || !(await browser.getWindowHandles()).includes(keepHandle)) {
    await browser.newWindow('about:blank', { type: 'window' })
    keepHandle = await browser.getWindowHandle()
  }

  try {
    await browser.waitUntil(
      async () => {
        for (const handle of await browser.getWindowHandles()) {
          if (handle === keepHandle) continue
          try {
            await browser.switchToWindow(handle)
            await browser.closeWindow()
          } catch (error) {
            // Closing a tab may also remove another handle in its popup window.
            if ((await browser.getWindowHandles()).includes(handle)) throw error
          }
        }
        const handles = await browser.getWindowHandles()
        return handles.length === 1 && handles[0] === keepHandle
      },
      {
        timeout: 10_000,
        interval: 100,
        timeoutMsg:
          'Expected one normal browser window after workflow cleanup.',
      },
    )
    await browser.switchToWindow(keepHandle)
    await browser.url('about:blank')
  } catch (error) {
    throw new Error(
      `Could not reset workflow browser. Browser contexts: ${JSON.stringify(await browserWindowSnapshot())}`,
      { cause: error },
    )
  }
}
