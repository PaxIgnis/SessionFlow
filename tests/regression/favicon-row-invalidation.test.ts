import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { effectScope, watchEffect, type EffectScope } from 'vue'
import { FAVICON_CACHE_STORAGE_KEY } from '@/defaults/constants'
import { DEFAULT_SETTINGS } from '@/defaults/settings'
import { FaviconService } from '@/services/favicons'
import { Settings } from '@/services/settings'
import { installFakeBrowser } from '../helpers/fake-browser'

const ICON_A = 'data:image/png;base64,AAAA'
const ICON_B = 'data:image/png;base64,BBBB'
const ICON_C = 'data:image/png;base64,CCCC'
const URL_A = 'https://a.example/page'
const URL_B = 'https://b.example/page'

function storedCache(entries: Array<[string, string]>) {
  return {
    [FAVICON_CACHE_STORAGE_KEY]: JSON.stringify({
      version: 1,
      entries: entries.map(([url, dataUrl]) => ({
        url,
        dataUrl,
        timestamp: 1,
      })),
    }),
  }
}

/*
 * Every row read one shared favicon counter that the sidebar bumped on each
 * favicon message, so reloading 200 tabs re-rendered every visible row
 * hundreds of times. Rows now depend only on their own page and domain.
 */
describe('favicon row invalidation', () => {
  let scope: EffectScope
  let service: FaviconService

  beforeEach(() => {
    installFakeBrowser()
    Object.assign(Settings.values, structuredClone(DEFAULT_SETTINGS))
    service = new FaviconService()
    scope = effectScope()
  })

  afterEach(() => {
    scope.stop()
  })

  /** Counts re-runs of a row-like effect that renders one URL's favicon. */
  function trackRow(url: string): { runs: () => number; icon: () => string } {
    let runs = 0
    let icon = ''
    scope.run(() =>
      watchEffect(
        () => {
          runs += 1
          icon = service.getFavicon(url)
        },
        { flush: 'sync' },
      ),
    )
    return { runs: () => runs - 1, icon: () => icon }
  }

  it('re-renders only rows on the domain whose icon changed', async () => {
    const rowA = trackRow(URL_A)
    const rowB = trackRow(URL_B)

    await service.updateFavicon(ICON_A, { url: URL_A } as browser.tabs.Tab)

    expect(rowA.runs()).toBe(1)
    expect(rowA.icon()).toBe(ICON_A)
    expect(rowB.runs()).toBe(0)
  })

  it('re-renders only the page marked faviconless', () => {
    const rowA = trackRow(URL_A)
    const rowB = trackRow(URL_B)

    service.markPageWithoutFavicon(URL_A)
    service.markPageWithoutFavicon(URL_A)

    expect(rowA.runs()).toBe(1)
    expect(rowB.runs()).toBe(0)
  })

  it('re-renders only domains that changed when the cache reloads', async () => {
    vi.mocked(browser.storage.local.get).mockResolvedValue(
      storedCache([
        ['a.example', ICON_A],
        ['b.example', ICON_B],
      ]),
    )
    await service.reloadCacheFromStorage()
    const rowA = trackRow(URL_A)
    const rowB = trackRow(URL_B)

    vi.mocked(browser.storage.local.get).mockResolvedValue(
      storedCache([
        ['a.example', ICON_A],
        ['b.example', ICON_C],
      ]),
    )
    await service.reloadCacheFromStorage()

    expect(rowA.runs()).toBe(0)
    expect(rowB.runs()).toBe(1)
    expect(rowB.icon()).toBe(ICON_C)

    vi.mocked(browser.storage.local.get).mockResolvedValue(
      storedCache([['b.example', ICON_C]]),
    )
    await service.reloadCacheFromStorage()

    expect(rowA.runs()).toBe(1)
    expect(rowB.runs()).toBe(1)
  })

  it('collapses a burst of reload requests into at most two storage reads', async () => {
    vi.mocked(browser.storage.local.get).mockResolvedValue(
      storedCache([['a.example', ICON_A]]),
    )

    await Promise.all(
      Array.from({ length: 50 }, () => service.reloadCacheFromStorage()),
    )

    expect(browser.storage.local.get).toHaveBeenCalledTimes(2)
    expect(service.getFavicon(URL_A)).toBe(ICON_A)
  })
})
