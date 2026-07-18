import { browser } from '@wdio/globals'

export async function createContainer(details) {
  const response = await browser.executeAsync((containerDetails, done) => {
    window.browser.contextualIdentities
      .create(containerDetails)
      .then((identity) => done({ ok: true, identity }))
      .catch((error) => done({ ok: false, error: String(error) }))
  }, details)

  if (!response.ok) throw new Error(response.error)
  return response.identity
}

export async function updateContainer(cookieStoreId, details) {
  const response = await browser.executeAsync(
    (storeId, containerDetails, done) => {
      window.browser.contextualIdentities
        .update(storeId, containerDetails)
        .then((identity) => done({ ok: true, identity }))
        .catch((error) => done({ ok: false, error: String(error) }))
    },
    cookieStoreId,
    details,
  )

  if (!response.ok) throw new Error(response.error)
  return response.identity
}

export async function removeContainer(cookieStoreId) {
  return browser.executeAsync((storeId, done) => {
    window.browser.contextualIdentities.remove(storeId).then(
      () => done(true),
      () => done(false),
    )
  }, cookieStoreId)
}

export async function containerIdentities() {
  const response = await browser.executeAsync((done) => {
    window.browser.contextualIdentities.query({}).then(
      (identities) => done({ ok: true, identities }),
      (error) => done({ ok: false, error: String(error) }),
    )
  })

  if (!response.ok) throw new Error(response.error)
  return response.identities
}

export async function createContainerTab(cookieStoreId, title, windowId) {
  const response = await browser.executeAsync(
    (storeId, targetTitle, targetWindowId, done) => {
      const url =
        window.browser.runtime.getURL('/redirect.html') +
        `?targetTitle=${encodeURIComponent(targetTitle)}`
      window.browser.tabs
        .create({
          active: false,
          cookieStoreId: storeId,
          url,
          ...(targetWindowId === undefined ? {} : { windowId: targetWindowId }),
        })
        .then((tab) => done({ ok: true, tab }))
        .catch((error) => done({ ok: false, error: String(error) }))
    },
    cookieStoreId,
    title,
    windowId,
  )

  if (!response.ok) throw new Error(response.error)
  return response.tab
}

export async function createContainerWindow(entries) {
  const response = await browser.executeAsync((windowEntries, done) => {
    const fixtureUrl = (title) =>
      window.browser.runtime.getURL('/redirect.html') +
      `?targetTitle=${encodeURIComponent(title)}`

    let createdWindowId
    ;(async () => {
      const first = windowEntries[0]
      const firstUrl = fixtureUrl(first.title)
      const createdWindow = await window.browser.windows.create({
        url: firstUrl,
        ...(first.cookieStoreId ? { cookieStoreId: first.cookieStoreId } : {}),
      })
      createdWindowId = createdWindow.id
      let initialTabs = []
      let firstTab
      for (let attempt = 0; attempt < 100 && !firstTab; attempt++) {
        initialTabs = await window.browser.tabs.query({
          windowId: createdWindow.id,
        })
        firstTab = initialTabs.find((tab) => tab.url === firstUrl)
        if (!firstTab) {
          await new Promise((resolve) => setTimeout(resolve, 50))
        }
      }
      if (!firstTab?.id) {
        throw new Error(
          'Firefox did not create the requested first fixture tab.',
        )
      }
      const unexpectedTabIds = initialTabs
        .filter((tab) => tab.id !== firstTab.id)
        .map((tab) => tab.id)
        .filter((tabId) => tabId !== undefined)
      if (unexpectedTabIds.length > 0) {
        await window.browser.tabs.remove(unexpectedTabIds)
      }

      const tabs = [firstTab]
      for (const entry of windowEntries.slice(1)) {
        tabs.push(
          await window.browser.tabs.create({
            active: false,
            url: fixtureUrl(entry.title),
            windowId: createdWindow.id,
            ...(entry.cookieStoreId
              ? { cookieStoreId: entry.cookieStoreId }
              : {}),
          }),
        )
      }
      done({ ok: true, tabs, windowId: createdWindow.id })
    })().catch(async (error) => {
      if (createdWindowId !== undefined) {
        await window.browser.windows.remove(createdWindowId).catch(() => {})
      }
      done({ ok: false, error: String(error) })
    })
  }, entries)

  if (!response.ok) throw new Error(response.error)
  return response
}

export async function tabCookieStore(tabId) {
  return browser.executeAsync((targetTabId, done) => {
    window.browser.tabs.get(targetTabId).then(
      (tab) => done(tab.cookieStoreId),
      () => done(null),
    )
  }, tabId)
}

export async function waitForTabTitle(tabId, title) {
  await browser.waitUntil(
    async () =>
      (await browser.executeAsync((targetTabId, done) => {
        window.browser.tabs.get(targetTabId).then(
          (tab) => done(tab.title),
          () => done(null),
        )
      }, tabId)) === title,
    {
      timeout: 10_000,
      timeoutMsg: `Expected browser tab ${tabId} to have title "${title}".`,
    },
  )
}

export async function removeTab(tabId) {
  return browser.executeAsync((targetTabId, done) => {
    window.browser.tabs.remove(targetTabId).then(
      () => done(true),
      () => done(false),
    )
  }, tabId)
}

export async function removeWindow(windowId) {
  return browser.executeAsync((targetWindowId, done) => {
    window.browser.windows.remove(targetWindowId).then(
      () => done(true),
      () => done(false),
    )
  }, windowId)
}
