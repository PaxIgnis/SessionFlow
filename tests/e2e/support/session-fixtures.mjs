import { browser } from '@wdio/globals'

export const SESSION_FIXTURE_TITLES = {
  initial: 'SF E2E Initial',
  alpha: 'SF E2E Alpha',
  beta: 'SF E2E Beta',
  gamma: 'SF E2E Gamma',
  reload: 'SF E2E Reload',
  secondWindow: 'SF E2E Second Window',
}

export function fixtureDataUrl(title) {
  const html = `<!doctype html><html><head><title>${escapeHtml(title)}</title></head><body><main><h1>${escapeHtml(title)}</h1></main></body></html>`
  return `data:text/html;charset=utf-8,${encodeURIComponent(html)}`
}

export function extensionFixtureTitle(title) {
  return `Redirect to ${title}`
}

export function reloadableFixtureTitle(title, count) {
  return `${title} ${count}`
}

export function reloadableFixtureDataUrl(title) {
  const html = `
    <!doctype html>
    <html>
      <head>
        <title>${escapeHtml(reloadableFixtureTitle(title, 'loading'))}</title>
      </head>
      <body>
        <main><h1>${escapeHtml(title)}</h1></main>
        <script>
          document.title='${escapeJs(title)} ' + Date.now() + '-' + Math.random()
        </script>
      </body>
    </html>`
  return `data:text/html;charset=utf-8,${encodeURIComponent(html)}`
}

export async function seedSessionTabs(
  titles = [SESSION_FIXTURE_TITLES.alpha, SESSION_FIXTURE_TITLES.beta],
) {
  const originalHandle = await browser.getWindowHandle()
  const handles = []

  await browser.url(fixtureDataUrl(titles[0]))
  handles.push(originalHandle)
  await waitForFixtureTitle(titles[0])

  for (const title of titles.slice(1)) {
    await browser.newWindow(fixtureDataUrl(title), {
      type: 'tab',
    })
    const handle = await browser.getWindowHandle()
    handles.push(handle)
    await waitForFixtureTitle(title)
  }

  return {
    originalHandle,
    handles,
    titles,
  }
}

export async function seedSingleSessionTab(
  title = SESSION_FIXTURE_TITLES.initial,
) {
  return seedSessionTabs([title])
}

export async function openFixtureTab(seed, title) {
  await browser.newWindow(fixtureDataUrl(title), {
    type: 'tab',
  })
  const handle = await switchToFixtureTitle(title)
  seed.handles.push(handle)
  seed.titles.push(title)

  return handle
}

export async function openReloadableFixtureTab(seed, title) {
  await browser.newWindow(reloadableFixtureDataUrl(title), {
    type: 'tab',
  })
  const handle = await switchToReloadableFixtureTitle(title)
  const firstTitle = await browser.getTitle()
  seed.handles.push(handle)
  seed.titles.push(firstTitle)

  return {
    handle,
    title: firstTitle,
  }
}

export async function openExtensionFixtureTab(seed, title, windowId) {
  const browserTitle = extensionFixtureTitle(title)
  const response = await browser.executeAsync(
    (targetTitle, targetWindowId, done) => {
      const url =
        window.browser.runtime.getURL('/redirect.html') +
        `?targetTitle=${encodeURIComponent(targetTitle)}`

      window.browser.tabs
        .create({
          active: true,
          url,
          windowId: targetWindowId,
        })
        .then((tab) =>
          done({
            ok: true,
            tabId: tab.id,
          }),
        )
        .catch((error) =>
          done({
            ok: false,
            error: String(error),
          }),
        )
    },
    title,
    windowId,
  )

  if (!response.ok) {
    throw new Error(response.error || 'Failed to create extension fixture tab.')
  }

  const tabId = response.tabId
  await waitForExtensionTabTitle(tabId, browserTitle)
  const handle = await findHandleByTitle(browserTitle)
  if (handle) {
    seed.handles.push(handle)
    seed.titles.push(browserTitle)
  }
  seed.browserTabIds ??= {}
  seed.browserTabIds[browserTitle] = tabId

  return {
    browserTabId: tabId,
    handle,
    title: browserTitle,
  }
}

export async function openFixtureWindow(seed, title) {
  await browser.newWindow(fixtureDataUrl(title), {
    type: 'window',
  })
  return trackFixtureHandleByTitle(seed, title)
}

export async function openFixtureWindowFromExtension(seed, title) {
  const response = await browser.executeAsync((url, done) => {
    window.browser.windows
      .create({ url })
      .then(() => done({ ok: true }))
      .catch((error) =>
        done({
          ok: false,
          error: String(error),
        }),
      )
  }, fixtureDataUrl(title))

  if (!response.ok) {
    throw new Error(response.error || 'Failed to create fixture window.')
  }

  return trackFixtureHandleByTitle(seed, title)
}

export async function createPrivateFixtureTabs(seed, titles) {
  if (titles.length === 0) {
    throw new Error('At least one private fixture title is required.')
  }
  const browserTitles = titles.map(extensionFixtureTitle)
  const response = await browser.executeAsync((targetTitles, done) => {
    const urls = targetTitles.map(
      (title) =>
        window.browser.runtime.getURL('/redirect.html') +
        `?targetTitle=${encodeURIComponent(title)}`,
    )

    window.browser.windows
      .create({ incognito: true, url: urls[0] })
      .then(async (createdWindow) => {
        if (createdWindow.id === undefined) {
          throw new Error('Firefox did not return a private window ID.')
        }
        const tabIds =
          createdWindow.tabs
            ?.map((tab) => tab.id)
            .filter((id) => id !== undefined) ?? []
        for (const url of urls.slice(1)) {
          const tab = await window.browser.tabs.create({
            active: false,
            url,
            windowId: createdWindow.id,
          })
          if (tab.id !== undefined) tabIds.push(tab.id)
        }
        done({ ok: true, windowId: createdWindow.id, tabIds })
      })
      .catch((error) => done({ ok: false, error: String(error) }))
  }, titles)

  if (!response.ok) {
    throw new Error(response.error || 'Failed to create private fixture tabs.')
  }

  seed.browserTabIds ??= {}
  response.tabIds.forEach((tabId, index) => {
    seed.browserTabIds[`private:${titles[index]}`] = tabId
  })
  await browser.waitUntil(
    async () => {
      const snapshot = await browser.executeAsync((windowId, done) => {
        window.browser.tabs
          .query({ windowId })
          .then((tabs) => done(tabs.map((tab) => tab.title)))
          .catch(() => done([]))
      }, response.windowId)
      return browserTitles.every((title) => snapshot.includes(title))
    },
    {
      timeout: 10_000,
      timeoutMsg: `Expected private fixture tabs: ${browserTitles.join(', ')}.`,
    },
  )

  return { ...response, browserTitles }
}

export async function trackFixtureHandleByTitle(seed, title) {
  const handle = await switchToFixtureTitle(title)
  seed.handles.push(handle)
  seed.titles.push(title)

  return handle
}

export async function closeSeededTab(seed, title) {
  const index = seed.titles.indexOf(title)
  const handle = seed.handles[index]

  if (!handle) {
    throw new Error(`No seeded tab handle found for "${title}".`)
  }

  await browser.switchToWindow(handle)
  await browser.closeWindow()
  seed.handles.splice(index, 1)
  seed.titles.splice(index, 1)

  const nextHandle = seed.handles[0] ?? (await browser.getWindowHandles())[0]
  if (nextHandle) {
    await browser.switchToWindow(nextHandle)
  }
}

export async function switchToSeededHandle(seed, title) {
  const index = seed.titles.indexOf(title)
  const handle = seed.handles[index]

  if (!handle) {
    throw new Error(`No seeded browser handle found for "${title}".`)
  }

  await browser.switchToWindow(handle)
}

export async function navigateSeededHandle(seed, title) {
  await switchToSeededHandle(seed, title)
  await browser.url(fixtureDataUrl(title))
  await waitForFixtureTitle(title)
}

export async function cleanupSeededTabs(seed) {
  if (seed.browserTabIds) {
    for (const tabId of Object.values(seed.browserTabIds)) {
      await removeExtensionTabIfOpen(tabId)
    }
  }

  const openHandles = new Set(await browser.getWindowHandles())
  const keepHandle =
    seed.handles.find((handle) => openHandles.has(handle)) ??
    [...openHandles].find(Boolean)

  for (const handle of [...seed.handles].reverse()) {
    if (!openHandles.has(handle) || handle === keepHandle) continue

    await browser.switchToWindow(handle)
    await browser.closeWindow()
    openHandles.delete(handle)
  }

  if (keepHandle && (await browser.getWindowHandles()).includes(keepHandle)) {
    await browser.switchToWindow(keepHandle)
    await browser.url('about:blank')
    return
  }

  const fallbackHandle = (await browser.getWindowHandles())[0]
  if (fallbackHandle) {
    await browser.switchToWindow(fallbackHandle)
    await browser.url('about:blank')
  }
}

export async function waitForExtensionTabClosed(tabId, title) {
  await browser.waitUntil(async () => !(await extensionTabExists(tabId)), {
    timeout: 10_000,
    timeoutMsg: `Expected browser tab "${title}" to close.`,
  })
}

export async function trackExtensionFixtureTabByTitle(seed, title) {
  const tabId = await waitForExtensionTabByTitle(title)
  seed.browserTabIds ??= {}
  seed.browserTabIds[title] = tabId
  return tabId
}

export async function trackExtensionFixtureTabsInWindow(
  seed,
  windowId,
  titles,
) {
  let matchingTabs = []
  await browser.waitUntil(
    async () => {
      const response = await browser.executeAsync(
        (targetWindowId, targetTitles, done) => {
          window.browser.tabs
            .query({ windowId: targetWindowId })
            .then((tabs) =>
              done({
                ok: true,
                tabs: targetTitles
                  .map((title) => tabs.find((tab) => tab.title === title))
                  .filter(Boolean)
                  .map((tab) => ({ id: tab.id, title: tab.title })),
              }),
            )
            .catch((error) => done({ ok: false, error: String(error) }))
        },
        windowId,
        titles,
      )
      if (!response.ok) {
        throw new Error(response.error || 'Failed to query extension tabs.')
      }
      matchingTabs = response.tabs
      return matchingTabs.length === titles.length
    },
    {
      timeout: 10_000,
      timeoutMsg: `Expected fixture tabs in browser window ${windowId}: ${titles.join(', ')}.`,
    },
  )

  seed.browserTabIds ??= {}
  for (const tab of matchingTabs) {
    seed.browserTabIds[`${windowId}:${tab.title}`] = tab.id
  }
  return matchingTabs.map((tab) => tab.id)
}

async function switchToFixtureTitle(title) {
  await browser.waitUntil(
    async () => {
      const matchingHandle = await findHandleByTitle(title)
      if (!matchingHandle) return false
      await browser.switchToWindow(matchingHandle)
      return true
    },
    {
      timeout: 10_000,
      timeoutMsg: `Expected a browser handle with fixture title "${title}".`,
    },
  )

  return browser.getWindowHandle()
}

async function waitForFixtureTitle(title) {
  await browser.waitUntil(async () => (await browser.getTitle()) === title, {
    timeout: 10_000,
    timeoutMsg: `Expected fixture tab "${title}" to finish loading.`,
  })
}

async function switchToReloadableFixtureTitle(title) {
  await browser.waitUntil(
    async () => {
      const matchingHandle = await findHandleByTitlePrefix(`${title} `)
      if (!matchingHandle) return false
      await browser.switchToWindow(matchingHandle)
      return true
    },
    {
      timeout: 10_000,
      timeoutMsg: `Expected a browser handle with reloadable fixture title "${title}".`,
    },
  )

  return browser.getWindowHandle()
}

async function waitForExtensionTabTitle(tabId, title) {
  let lastTab

  try {
    await browser.waitUntil(
      async () => {
        lastTab = await getExtensionTab(tabId)
        return lastTab?.title === title
      },
      {
        timeout: 10_000,
        timeoutMsg: `Expected extension tab "${title}" to finish loading.`,
      },
    )
  } catch (error) {
    throw new Error(
      `${error.message} Last tab state: ${JSON.stringify({
        id: lastTab?.id,
        status: lastTab?.status,
        title: lastTab?.title,
        url: lastTab?.url,
      })}`,
    )
  }
}

async function waitForExtensionTabByTitle(title) {
  let matchingTabId

  await browser.waitUntil(
    async () => {
      const response = await browser.executeAsync((targetTitle, done) => {
        window.browser.tabs
          .query({})
          .then((tabs) => {
            const tab = tabs.find(
              (candidate) => candidate.title === targetTitle,
            )
            done({
              ok: true,
              tabId: tab?.id,
            })
          })
          .catch((error) =>
            done({
              ok: false,
              error: String(error),
            }),
          )
      }, title)

      if (!response.ok) {
        throw new Error(response.error || 'Failed to query extension tabs.')
      }

      matchingTabId = response.tabId
      return matchingTabId !== undefined
    },
    {
      timeout: 10_000,
      timeoutMsg: `Expected extension tab "${title}" to open.`,
    },
  )

  return matchingTabId
}

async function extensionTabExists(tabId) {
  return Boolean(await getExtensionTab(tabId))
}

async function getExtensionTab(tabId) {
  if (tabId === undefined) return undefined

  const response = await browser.executeAsync((targetTabId, done) => {
    window.browser.tabs
      .get(targetTabId)
      .then((tab) => done({ ok: true, tab }))
      .catch(() => done({ ok: false }))
  }, tabId)

  return response.ok ? response.tab : undefined
}

async function removeExtensionTabIfOpen(tabId) {
  if (!(await extensionTabExists(tabId))) return

  await browser.executeAsync((targetTabId, done) => {
    window.browser.tabs
      .remove(targetTabId)
      .then(() => done())
      .catch(() => done())
  }, tabId)
}

async function findHandleByTitle(title) {
  const originalHandle = await browser.getWindowHandle()
  const handles = await browser.getWindowHandles()

  for (const handle of handles) {
    await browser.switchToWindow(handle)
    if ((await browser.getTitle()) === title) {
      return handle
    }
  }

  if (handles.includes(originalHandle)) {
    await browser.switchToWindow(originalHandle)
  }
  return undefined
}

async function findHandleByTitlePrefix(titlePrefix) {
  const originalHandle = await browser.getWindowHandle()
  const handles = await browser.getWindowHandles()

  for (const handle of handles) {
    await browser.switchToWindow(handle)
    if ((await browser.getTitle()).startsWith(titlePrefix)) {
      return handle
    }
  }

  if (handles.includes(originalHandle)) {
    await browser.switchToWindow(originalHandle)
  }
  return undefined
}

function escapeHtml(value) {
  return value
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;')
}

function escapeJs(value) {
  return value.replaceAll('\\', '\\\\').replaceAll("'", "\\'")
}
