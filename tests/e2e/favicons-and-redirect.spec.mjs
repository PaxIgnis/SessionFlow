import { $, browser, expect } from '@wdio/globals'
import http from 'node:http'
import {
  cleanupSeededTabs,
  createPrivateFixtureTabs,
  seedSingleSessionTab,
} from './support/session-fixtures.mjs'
import { SessionTreePage } from './support/session-tree-page.mjs'
import {
  closeSessionTreePopup,
  openSessionTreePopup,
} from './support/session-tree-popup.mjs'
import { grantFirefoxExtensionOrigins } from './support/firefox-chrome-context.mjs'
import { FIREFOX_EXTENSION_ID } from './support/firefox-extension.mjs'
import { closeOptionsPage, openOptionsPage } from './support/options-page.mjs'

describe('favicon and redirect workflows', () => {
  let server
  let origin
  let seed
  let popup
  let sessionTree

  before(async () => {
    server = http.createServer((request, response) => {
      const url = new URL(request.url, 'http://127.0.0.1')
      if (url.pathname.startsWith('/icon/')) {
        const color = url.pathname.split('/').at(-1).replace('.svg', '')
        response.writeHead(200, { 'content-type': 'image/svg+xml' })
        response.end(faviconSvg(color))
        return
      }

      const title = url.searchParams.get('title') || 'Favicon fixture'
      const color = url.searchParams.get('color') || 'red'
      const mode = url.searchParams.get('mode') || 'data'
      const href =
        mode === 'data'
          ? `data:image/svg+xml,${encodeURIComponent(faviconSvg(color))}`
          : mode === 'http'
            ? `/icon/${color}.svg`
            : undefined
      response.writeHead(200, { 'content-type': 'text/html; charset=utf-8' })
      response.end(
        `<!doctype html><html><head><title>${escapeHtml(title)}</title>${
          href ? `<link rel="icon" href="${href}">` : ''
        }</head><body><h1>${escapeHtml(title)}</h1></body></html>`,
      )
    })
    await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve))
    const address = server.address()
    origin = `http://127.0.0.1:${address.port}`
  })

  after(async () => {
    await new Promise((resolve) => server.close(resolve))
  })

  beforeEach(async () => {
    seed = await seedSingleSessionTab('FV E2E Seed')
    popup = await openSessionTreePopup()
    sessionTree = new SessionTreePage()
    await sessionTree.expectLoaded()
  })

  afterEach(async () => {
    if (popup?.popupHandle) {
      const handles = await browser.getWindowHandles()
      if (handles.includes(popup.popupHandle)) {
        await browser.switchToWindow(popup.popupHandle)
        await resetFaviconSettingsAndCache()
      }
    }
    if (seed) await cleanupSeededTabs(seed)
    if (popup?.popupHandle) {
      const handles = await browser.getWindowHandles()
      if (handles.includes(popup.popupHandle)) {
        await browser.switchToWindow(popup.popupHandle)
        await closeSessionTreePopup(popup.originalHandle)
      }
    }
  })

  it('updates and clears a favicon in an already-open session tree (FV-01/FV-02)', async () => {
    await navigateSeed(
      `${origin}/page?mode=data&color=red&title=${encodeURIComponent('FV Red')}`,
      'FV Red',
    )
    const uid = await waitForTreeTabUid('FV Red')
    const redSrc = await waitForFavicon(uid, (src) => !isDefaultIcon(src))

    await navigateSeed(
      `${origin}/page?mode=data&color=blue&title=${encodeURIComponent('FV Blue')}`,
      'FV Blue',
    )
    const blueSrc = await waitForFavicon(
      uid,
      (src) => !isDefaultIcon(src) && src !== redSrc,
    )
    expect(blueSrc).not.toBe(redSrc)

    await navigateSeed(
      `${origin}/page?mode=none&title=${encodeURIComponent('FV No Icon')}`,
      'FV No Icon',
    )
    await waitForFavicon(uid, isDefaultIcon)
  })

  it('stops live HTTP favicon fetches after website permission is revoked (FV-11)', async () => {
    await browser.switchToWindow(popup.popupHandle)
    expect(
      await grantFirefoxExtensionOrigins(FIREFOX_EXTENSION_ID, [
        'http://*/*',
        'https://*/*',
      ]),
    ).toBe(true)
    await browser.waitUntil(
      () =>
        browser.executeAsync((done) => {
          window.browser.permissions
            .contains({ origins: ['http://*/*', 'https://*/*'] })
            .then(done)
            .catch(() => done(false))
        }),
      { timeoutMsg: 'Expected favicon website permission to be pre-granted.' },
    )

    await navigateSeed(
      `${origin}/page?mode=none&title=${encodeURIComponent('FV Permission Red')}`,
      'FV Permission Red',
    )
    const uid = await waitForTreeTabUid('FV Permission Red')
    await sendBackgroundRuntimeMessage({
      type: 'FAVICON_UPDATED',
      favIconUrl: `${origin}/icon/red.svg`,
      tab: {
        url: `${origin}/page?mode=none&title=${encodeURIComponent('FV Permission Red')}`,
        incognito: false,
      },
    })
    const permittedSrc = await waitForFavicon(uid, (src) => !isDefaultIcon(src))

    await browser.switchToWindow(popup.popupHandle)
    const removed = await browser.executeAsync((done) => {
      window.browser.permissions
        .remove({ origins: ['http://*/*', 'https://*/*'] })
        .then(done)
        .catch(() => done(false))
    })
    expect(removed).toBe(true)

    await sendBackgroundRuntimeMessage({
      type: 'FAVICON_UPDATED',
      favIconUrl: `${origin}/icon/blue.svg`,
      tab: {
        url: `${origin}/page?mode=none&title=${encodeURIComponent('FV Permission Red')}`,
        incognito: false,
      },
    })
    await browser.switchToWindow(popup.popupHandle)
    await browser.pause(500)
    const postRevocationSrc = await faviconSrc(uid)
    expect(postRevocationSrc).toBe(permittedSrc)
    const settings = await browser.executeAsync((done) => {
      window.browser.storage.local
        .get('settings')
        .then(({ settings }) => done(settings))
        .catch(() => done({}))
    })
    expect(settings.fetchMissingFaviconsOnStartup).toBe(false)
    expect(settings.refreshFaviconsAfterPeriodOfTime).toBe(false)
  })

  it('uses and purges private favicons according to the setting (FV-12)', async () => {
    await browser.switchToWindow(popup.popupHandle)
    const privateFixture = await createPrivateFixtureTabs(seed, [
      'FV Private Bootstrap',
    ])
    const privateTabId = privateFixture.tabIds[0]
    await browser.executeAsync(
      (tabId, url, done) => {
        window.browser.tabs
          .update(tabId, { url })
          .then(() => done({ ok: true }))
          .catch((error) => done({ ok: false, error: String(error) }))
      },
      privateTabId,
      `${origin}/page?mode=data&color=purple&title=${encodeURIComponent('FV Private')}`,
    )
    let privateTabSnapshot
    await browser.waitUntil(
      async () => {
        privateTabSnapshot = await browser.executeAsync((tabId, done) => {
          window.browser.tabs
            .get(tabId)
            .then((tab) =>
              done({
                title: tab.title,
                favIconUrl: tab.favIconUrl,
                incognito: tab.incognito,
                status: tab.status,
              }),
            )
            .catch((error) => done({ error: String(error) }))
        }, privateTabId)
        return (
          privateTabSnapshot.title === 'FV Private' &&
          privateTabSnapshot.status === 'complete' &&
          Boolean(privateTabSnapshot.favIconUrl)
        )
      },
      {
        timeoutMsg: `Expected Firefox to expose the private tab favicon. Last snapshot: ${JSON.stringify(privateTabSnapshot)}`,
      },
    )
    expect(privateTabSnapshot.incognito).toBe(true)
    const uid = await waitForTreeTabUid('FV Private')
    const websiteSrc = await waitForFavicon(uid, (src) => !isDefaultIcon(src))

    await browser.switchToWindow(popup.popupHandle)
    await closeSessionTreePopup(popup.originalHandle)
    popup = await openSessionTreePopup()
    sessionTree = new SessionTreePage()
    await sessionTree.expectLoaded()
    expect(await waitForFavicon(uid, (src) => src === websiteSrc)).toBe(
      websiteSrc,
    )

    const options = await openOptionsPage()
    await options.page.setToggle(
      'Show and cache favicons for private tabs',
      'Off',
    )
    await closeOptionsPage(options.optionsHandle, popup.popupHandle)
    const privateFallback = await waitForFavicon(
      uid,
      (src) => src !== websiteSrc && !isDefaultIcon(src),
    )
    expect(decodeURIComponent(privateFallback)).toMatch(
      /private-browsing|M15\.931/,
    )

    const cache = await readFaviconCache()
    expect(cache.entries.some((entry) => entry.url === '127.0.0.1')).toBe(false)
  })

  it('shares an allowed private favicon cache entry with normal tabs without pruning it on private close (PD-FR-06)', async () => {
    await navigateSeed(
      `${origin}/page?mode=data&color=green&title=${encodeURIComponent('FV Shared Normal')}`,
      'FV Shared Normal',
    )
    const normalUid = await waitForTreeTabUid('FV Shared Normal')
    await waitForFavicon(normalUid, (src) => !isDefaultIcon(src))

    await browser.switchToWindow(popup.popupHandle)
    const privateFixture = await createPrivateFixtureTabs(seed, [
      'FV Shared Bootstrap',
    ])
    const privateTabId = privateFixture.tabIds[0]
    await browser.executeAsync(
      (tabId, url, done) => {
        window.browser.tabs
          .update(tabId, { url })
          .then(() => done({ ok: true }))
          .catch((error) => done({ ok: false, error: String(error) }))
      },
      privateTabId,
      `${origin}/page?mode=data&color=purple&title=${encodeURIComponent('FV Shared Private')}`,
    )
    await browser.waitUntil(
      () =>
        browser.executeAsync((tabId, done) => {
          window.browser.tabs
            .get(tabId)
            .then((tab) =>
              done(
                tab.title === 'FV Shared Private' && Boolean(tab.favIconUrl),
              ),
            )
            .catch(() => done(false))
        }, privateTabId),
      { timeoutMsg: 'Expected the shared private favicon fixture to load.' },
    )
    const privateUid = await waitForTreeTabUid('FV Shared Private')
    const privateSrc = await waitForFavicon(
      privateUid,
      (src) => !isDefaultIcon(src),
    )
    expect(await waitForFavicon(normalUid, (src) => src === privateSrc)).toBe(
      privateSrc,
    )

    await browser.executeAsync((tabId, done) => {
      window.browser.tabs
        .remove(tabId)
        .then(() => done({ ok: true }))
        .catch((error) => done({ ok: false, error: String(error) }))
    }, privateTabId)
    await sessionTree.waitForItemTextNotVisible('FV Shared Private')
    const cache = await readFaviconCache()
    expect(cache.entries.some((entry) => entry.url === '127.0.0.1')).toBe(true)
    expect(await waitForFavicon(normalUid, (src) => src === privateSrc)).toBe(
      privateSrc,
    )
  })

  it('renders and copies a complex privileged redirect target (FV-13/FV-14)', async () => {
    const target = `about:reader?url=${encodeURIComponent(
      'https://example.test/<img src=x onerror=alert(1)>/λ',
    )}#fragment-${'x'.repeat(1_500)}`
    const title = '<script>alert(1)</script> — λ'
    await browser.switchToWindow(popup.popupHandle)
    const redirect = await browser.executeAsync(
      (targetUrl, targetTitle, done) => {
        const url =
          window.browser.runtime.getURL('/redirect.html') +
          `?targetUrl=${encodeURIComponent(targetUrl)}&targetTitle=${encodeURIComponent(targetTitle)}`
        window.browser.tabs
          .create({ url, active: true })
          .then((tab) => done({ ok: true, tabId: tab.id }))
          .catch((error) => done({ ok: false, error: String(error) }))
      },
      target,
      title,
    )
    expect(redirect.ok).toBe(true)
    seed.browserTabIds ??= {}
    seed.browserTabIds.redirect = redirect.tabId

    await switchToTitle(`Redirect to ${title}`)
    expect(await $('#target-url').getText()).toBe(target)
    expect(await $('#target-url').getAttribute('href')).toBe(target)
    await $('#target-url').click()
    await browser.waitUntil(
      async () => (await $('#copied-message').getText()).length > 0,
      { timeoutMsg: 'Expected redirect copy status feedback.' },
    )
    expect(await $('#copied-message').getText()).toMatch(
      /Copied!|Copy unavailable/,
    )
  })

  async function navigateSeed(url, title) {
    await browser.switchToWindow(seed.handles[0])
    await browser.url(url)
    await browser.waitUntil(async () => (await browser.getTitle()) === title, {
      timeoutMsg: `Expected fixture title ${title}.`,
    })
    await browser.switchToWindow(popup.popupHandle)
    await sessionTree.waitForItemTextVisible(title)
  }

  async function waitForTreeTabUid(title) {
    let uid
    await sessionTree.waitForBackgroundTree((tree) => {
      const tab = tree
        .flatMap((item) => (item.type === 0 ? item.children : []))
        .find((item) => item.type === 1 && item.title === title)
      uid = tab?.uid
      return Boolean(uid)
    }, `Expected a tree tab titled ${title}.`)
    return uid
  }

  async function faviconSrc(uid) {
    const item = await sessionTree.treeItemByUid(uid)
    return item.$('.tree-item-favicon').getAttribute('src')
  }

  async function waitForFavicon(uid, predicate) {
    let src = ''
    await browser.switchToWindow(popup.popupHandle)
    await browser.waitUntil(
      async () => {
        src = await faviconSrc(uid)
        return predicate(src)
      },
      { timeoutMsg: `Expected favicon state for tree item ${uid}.` },
    )
    return src
  }

  async function sendBackgroundRuntimeMessage(message) {
    await browser.switchToWindow(popup.popupHandle)
    const result = await browser.executeAsync((runtimeMessage, done) => {
      window.browser.runtime
        .getBackgroundPage()
        .then((backgroundPage) =>
          backgroundPage.browser.runtime.sendMessage(runtimeMessage),
        )
        .then(() => done({ ok: true }))
        .catch((error) => done({ ok: false, error: String(error) }))
    }, message)
    if (!result.ok) throw new Error(result.error)
  }

  async function readFaviconCache() {
    await browser.switchToWindow(popup.popupHandle)
    return browser.executeAsync((done) => {
      window.browser.storage.local
        .get('sessionflow-favicon-cache')
        .then((stored) => {
          const raw = stored['sessionflow-favicon-cache']
          done(raw ? JSON.parse(raw) : { version: 1, entries: [] })
        })
        .catch(() => done({ version: 1, entries: [] }))
    })
  }

  async function resetFaviconSettingsAndCache() {
    await browser.executeAsync((done) => {
      window.browser.storage.local
        .get('settings')
        .then(({ settings }) =>
          window.browser.storage.local.set({
            settings: {
              ...(settings || {}),
              cachePrivateTabFavicons: true,
              fetchMissingFaviconsOnStartup: false,
              refreshFaviconsAfterPeriodOfTime: false,
            },
            'sessionflow-favicon-cache': JSON.stringify({
              version: 1,
              entries: [],
            }),
          }),
        )
        .then(() =>
          window.browser.runtime.sendMessage({ type: 'settingsUpdated' }),
        )
        .then(() => done({ ok: true }))
        .catch(() => done({ ok: false }))
    })
  }

  async function switchToTitle(title) {
    await browser.waitUntil(async () => {
      for (const handle of await browser.getWindowHandles()) {
        await browser.switchToWindow(handle)
        if ((await browser.getTitle()) === title) return true
      }
      return false
    })
  }
})

function faviconSvg(color) {
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 16 16"><circle cx="8" cy="8" r="7" fill="${color}"/></svg>`
}

function isDefaultIcon(src) {
  return src.endsWith('/icon/16.png')
}

function escapeHtml(value) {
  return value
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#039;')
}
