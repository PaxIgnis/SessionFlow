import { browser } from '@wdio/globals'

export async function writeStoredSessionTree(treeItems) {
  const response = await browser.executeAsync((items, done) => {
    window.browser.storage.local
      .set({ sessionTree: items })
      .then(() => done({ ok: true }))
      .catch((error) => done({ ok: false, error: String(error) }))
  }, treeItems)
  assertLifecycleResponse(response, 'write the stored session tree')
}

export async function readStoredSessionTree() {
  const response = await browser.executeAsync((done) => {
    window.browser.storage.local
      .get('sessionTree')
      .then(({ sessionTree }) => done({ ok: true, sessionTree }))
      .catch((error) => done({ ok: false, error: String(error) }))
  })
  assertLifecycleResponse(response, 'read the stored session tree')
  return response.sessionTree ?? []
}

export async function reloadExtensionBackground() {
  await browser.execute(() => {
    setTimeout(() => window.browser.runtime.reload(), 0)
  })
}

export async function removeTabsByTitles(titles) {
  const response = await browser.executeAsync((targetTitles, done) => {
    window.browser.tabs
      .query({})
      .then((tabs) =>
        window.browser.tabs.remove(
          tabs
            .filter((tab) => targetTitles.includes(tab.title))
            .map((tab) => tab.id)
            .filter((id) => id !== undefined),
        ),
      )
      .then(() => done({ ok: true }))
      .catch((error) => done({ ok: false, error: String(error) }))
  }, titles)
  assertLifecycleResponse(response, 'remove fixture tabs')
}

export async function createBlankCleanupWindow() {
  const response = await browser.executeAsync((done) => {
    window.browser.windows
      .create({ url: 'about:blank' })
      .then((createdWindow) => done({ ok: true, windowId: createdWindow.id }))
      .catch((error) => done({ ok: false, error: String(error) }))
  })
  assertLifecycleResponse(response, 'create a blank cleanup window')
  return response.windowId
}

function assertLifecycleResponse(response, action) {
  if (!response?.ok) {
    throw new Error(response?.error || `Failed to ${action}.`)
  }
}
