import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { FaviconService } from '@/services/favicons'
import { installFakeBrowser } from '../../helpers/fake-browser'

describe('favicon service', () => {
  function installFileReaderDataUrl(dataUrl: string) {
    vi.stubGlobal(
      'FileReader',
      class {
        result: string | ArrayBuffer | null = null
        onloadend:
          | ((this: FileReader, ev: ProgressEvent<FileReader>) => void)
          | null = null
        onerror:
          | ((this: FileReader, ev: ProgressEvent<FileReader>) => void)
          | null = null

        readAsDataURL() {
          queueMicrotask(() => {
            this.result = dataUrl
            this.onloadend?.call(
              this as unknown as FileReader,
              {} as ProgressEvent<FileReader>,
            )
          })
        }
      },
    )
  }

  beforeEach(() => {
    installFakeBrowser()
  })

  afterEach(() => {
    vi.useRealTimers()
    vi.restoreAllMocks()
    vi.unstubAllGlobals()
  })

  it('loads persisted cache once and returns cached favicons by domain', async () => {
    vi.mocked(browser.storage.local.get).mockResolvedValue({
      favicons: JSON.stringify([
        {
          url: 'example.test',
          dataUrl: 'data:image/png;base64,cached',
          timestamp: 1,
        },
      ]),
    })
    const service = new FaviconService({
      storageKey: 'favicons',
      expiryDays: 7,
    })

    await service.init()
    await service.init()

    expect(browser.storage.local.get).toHaveBeenCalledTimes(1)
    expect(service.getFavicon('https://example.test/page')).toBe(
      'data:image/png;base64,cached',
    )
  })

  it('falls back to the default icon for missing or invalid URLs', () => {
    const service = new FaviconService()
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {})

    expect(service.getFavicon('https://missing.example')).toBe('/icon/16.png')
    expect(service.getFavicon('not a url')).toBe('/icon/16.png')
    expect(consoleError).toHaveBeenCalledWith(
      'Failed to parse URL',
      expect.any(Error),
      'not a url',
    )
  })

  it('ignores malformed persisted cache JSON during initialization', async () => {
    vi.mocked(browser.storage.local.get).mockResolvedValue({
      favicons: 'not json',
    })
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {})
    const service = new FaviconService({
      storageKey: 'favicons',
      expiryDays: 7,
    })

    await expect(service.init()).resolves.toBe(undefined)
    expect(service.getFavicon('https://example.test/page')).toBe('/icon/16.png')
    expect(consoleError).toHaveBeenCalledWith(
      'Failed to load favicon cache from storage',
      expect.any(SyntaxError),
    )
  })

  it('stores data URL favicons by page domain and skips invalid favicon URLs', async () => {
    const cache = new Map()
    const service = new FaviconService(undefined, cache)

    await service.updateFavicon('data:image/png;base64,new', {
      url: 'https://example.test/page',
    } as browser.tabs.Tab)
    await service.updateFavicon('about:config', {
      url: 'https://ignored.test/page',
    } as browser.tabs.Tab)

    expect(cache.get('example.test')?.dataUrl).toBe('data:image/png;base64,new')
    expect(cache.has('ignored.test')).toBe(false)
  })

  it('fetches only one missing web favicon per uncached domain and saves cache', async () => {
    const cache = new Map([
      [
        'cached.test',
        {
          url: 'cached.test',
          dataUrl: 'data:image/png;base64,cached',
          timestamp: 1,
        },
      ],
    ])
    const service = new FaviconService(undefined, cache)
    let resolveMissingFetch!: () => void
    const missingFetch = new Promise<void>((resolve) => {
      resolveMissingFetch = resolve
    })
    const fetchAndStoreFavicon = vi
      .spyOn(service, 'fetchAndStoreFavicon')
      .mockImplementation((url) =>
        url === 'https://missing.test/first' ? missingFetch : Promise.resolve(),
      )
    const saveCacheToStorage = vi
      .spyOn(service, 'saveCacheToStorage')
      .mockResolvedValue(undefined)

    const fetchMissingFavicons = service.fetchMissingFavicons([
      '',
      'about:config',
      'https://cached.test/page',
      'https://missing.test/first',
      'https://missing.test/second',
      'http://other.test/page',
      'file:///tmp/icon.html',
      'not a url',
    ])
    await Promise.resolve()

    expect(fetchAndStoreFavicon).toHaveBeenCalledTimes(2)
    expect(fetchAndStoreFavicon).toHaveBeenNthCalledWith(
      1,
      'https://missing.test/first',
    )
    expect(fetchAndStoreFavicon).toHaveBeenNthCalledWith(
      2,
      'http://other.test/page',
    )
    expect(saveCacheToStorage).not.toHaveBeenCalled()

    resolveMissingFetch()
    await fetchMissingFavicons

    expect(saveCacheToStorage).toHaveBeenCalledTimes(1)
  })

  it('refreshes only missing or expired domains and prefers live tab icons', async () => {
    const now = 10_000
    const oldEntry = {
      url: 'expired.test',
      dataUrl: 'data:image/png;base64,old',
      timestamp: 1_000,
    }
    const freshEntry = {
      url: 'fresh.test',
      dataUrl: 'data:image/png;base64,fresh',
      timestamp: 9_500,
    }
    const cache = new Map([
      ['expired.test', oldEntry],
      ['fresh.test', freshEntry],
    ])
    const service = new FaviconService(undefined, cache)
    const updateFavicon = vi
      .spyOn(service, 'updateFavicon')
      .mockImplementation(async (favIconUrl, tab) => {
        cache.set('expired.test', {
          url: 'expired.test',
          dataUrl: favIconUrl,
          timestamp: now,
        })
        expect(tab?.url).toBe('https://expired.test/live')
      })
    const fetchAndStoreFavicon = vi
      .spyOn(service, 'fetchAndStoreFavicon')
      .mockImplementation(async (url) => {
        cache.set('missing.test', {
          url: 'missing.test',
          dataUrl: `data:image/png;base64,${url}`,
          timestamp: now,
        })
      })
    const saveCacheToStorage = vi
      .spyOn(service, 'saveCacheToStorage')
      .mockResolvedValue(undefined)

    const updates = await service.refreshFavicons(
      [
        'https://expired.test/saved',
        'https://expired.test/duplicate',
        'https://fresh.test/page',
        'https://missing.test/saved',
        'about:config',
      ],
      1_000,
      [
        {
          url: 'https://expired.test/live',
          favIconUrl: 'data:image/png;base64,live',
        },
      ],
      now,
    )

    expect(updateFavicon).toHaveBeenCalledTimes(1)
    expect(updateFavicon).toHaveBeenCalledWith(
      'data:image/png;base64,live',
      expect.objectContaining({ url: 'https://expired.test/live' }),
    )
    expect(fetchAndStoreFavicon).toHaveBeenCalledTimes(1)
    expect(fetchAndStoreFavicon).toHaveBeenCalledWith(
      'https://missing.test/saved',
    )
    expect(cache.get('fresh.test')).toBe(freshEntry)
    expect(updates.map((entry) => entry.url).sort()).toEqual([
      'expired.test',
      'missing.test',
    ])
    expect(saveCacheToStorage).toHaveBeenCalledTimes(1)
  })

  it('keeps an expired cached icon when its refresh fails', async () => {
    const oldEntry = {
      url: 'example.test',
      dataUrl: 'data:image/png;base64,old',
      timestamp: 1,
    }
    const cache = new Map([['example.test', oldEntry]])
    const service = new FaviconService(undefined, cache)
    vi.spyOn(service, 'fetchAndStoreFavicon').mockResolvedValue(undefined)
    vi.spyOn(service, 'saveCacheToStorage').mockResolvedValue(undefined)

    const updates = await service.refreshFavicons(
      ['https://example.test/page'],
      1_000,
      [],
      10_000,
    )

    expect(cache.get('example.test')).toBe(oldEntry)
    expect(updates).toEqual([])
  })

  it('calculates the earliest future expiry and delays retries for due entries', () => {
    const cache = new Map([
      [
        'fresh.test',
        {
          url: 'fresh.test',
          dataUrl: 'data:image/png;base64,fresh',
          timestamp: 9_500,
        },
      ],
      [
        'expired.test',
        {
          url: 'expired.test',
          dataUrl: 'data:image/png;base64,expired',
          timestamp: 1,
        },
      ],
    ])
    const service = new FaviconService(undefined, cache)

    expect(
      service.getNextRefreshAt(
        [
          'https://fresh.test/page',
          'https://expired.test/page',
          'https://missing.test/page',
        ],
        1_000,
        10_000,
      ),
    ).toBe(10_500)
    expect(
      service.getNextRefreshAt(
        ['https://expired.test/page', 'https://missing.test/page'],
        1_000,
        10_000,
      ),
    ).toBe(11_000)
    expect(service.getNextRefreshAt([], 1_000, 10_000)).toBeUndefined()
  })

  it('reloads persisted cache and removes stale in-memory domains', async () => {
    const cache = new Map([
      [
        'old.test',
        {
          url: 'old.test',
          dataUrl: 'data:image/png;base64,old',
          timestamp: 1,
        },
      ],
    ])
    const service = new FaviconService(
      { storageKey: 'favicons', expiryDays: 7 },
      cache,
    )
    vi.mocked(browser.storage.local.get).mockResolvedValue({
      favicons: JSON.stringify([
        {
          url: 'new.test',
          dataUrl: 'data:image/png;base64,new',
          timestamp: 2,
        },
      ]),
    })

    await service.reloadCacheFromStorage()

    expect(service.getFavicon('https://old.test')).toBe('/icon/16.png')
    expect(service.getFavicon('https://new.test')).toBe(
      'data:image/png;base64,new',
    )
  })

  it('skips non-web and malformed URLs when fetching a favicon', async () => {
    const service = new FaviconService()
    const updateFavicon = vi.spyOn(service, 'updateFavicon')

    await expect(service.fetchAndStoreFavicon('about:config')).resolves.toBe(
      undefined,
    )
    await expect(service.fetchAndStoreFavicon('not a url')).resolves.toBe(
      undefined,
    )

    expect(updateFavicon).not.toHaveBeenCalled()
  })

  it('fetches an HTTP favicon and stores it as a data URL for the page domain', async () => {
    const cache = new Map()
    const service = new FaviconService(undefined, cache)
    const dataUrl = 'data:image/png;base64,fetched'
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        ok: true,
        blob: vi.fn().mockResolvedValue({}),
      } as unknown as Response),
    )
    installFileReaderDataUrl(dataUrl)

    const updateFavicon = service.updateFavicon(
      'https://cdn.example/icon.png',
      {
        url: 'https://page.example/articles/1',
      } as browser.tabs.Tab,
    )

    expect(cache.has('page.example')).toBe(false)
    await updateFavicon

    expect(fetch).toHaveBeenCalledWith('https://cdn.example/icon.png')
    expect(cache.get('page.example')?.dataUrl).toBe(dataUrl)
  })

  it('falls back to an HTML icon link when the direct image fetch fails', async () => {
    const cache = new Map()
    const service = new FaviconService(undefined, cache)
    const fallbackDataUrl = 'data:image/svg+xml;base64,fallback'
    vi.stubGlobal(
      'fetch',
      vi
        .fn()
        .mockResolvedValueOnce({
          ok: false,
        } as unknown as Response)
        .mockResolvedValueOnce({
          ok: true,
          text: vi.fn().mockResolvedValue('<link rel="icon" href="/icon.svg">'),
        } as unknown as Response)
        .mockResolvedValueOnce({
          ok: true,
          blob: vi.fn().mockResolvedValue({}),
        } as unknown as Response),
    )
    installFileReaderDataUrl(fallbackDataUrl)

    await service.updateFavicon('https://cdn.example/missing.ico', {
      url: 'https://page.example/articles/1',
    } as browser.tabs.Tab)

    expect(fetch).toHaveBeenNthCalledWith(1, 'https://cdn.example/missing.ico')
    expect(fetch).toHaveBeenNthCalledWith(2, 'https://page.example/articles/1')
    expect(fetch).toHaveBeenNthCalledWith(3, 'https://page.example/icon.svg')
    expect(cache.get('page.example')?.dataUrl).toBe(fallbackDataUrl)
  })

  it('does not cache or throw when favicon and fallback fetches fail', async () => {
    const cache = new Map()
    const service = new FaviconService(undefined, cache)
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('network')))

    await expect(
      service.updateFavicon('https://cdn.example/icon.png', {
        url: 'https://page.example/articles/1',
      } as browser.tabs.Tab),
    ).resolves.toBe(undefined)

    expect(fetch).toHaveBeenCalledTimes(2)
    expect(cache.has('page.example')).toBe(false)
  })

  it('warms cache only from web tabs with favicon URLs', () => {
    const service = new FaviconService()
    const updateFavicon = vi
      .spyOn(service, 'updateFavicon')
      .mockResolvedValue(undefined)

    service.warmCacheFromTabs([
      {
        url: 'https://example.test/page',
        favIconUrl: 'data:image/png;base64,icon',
      },
      {
        url: 'about:config',
        favIconUrl: 'data:image/png;base64,ignored',
      },
      {
        url: 'https://missing-icon.test/page',
      },
    ])

    expect(updateFavicon).toHaveBeenCalledTimes(1)
    expect(updateFavicon).toHaveBeenCalledWith(
      'data:image/png;base64,icon',
      expect.objectContaining({ url: 'https://example.test/page' }),
    )
  })

  it('checks and requests favicon permissions defensively', async () => {
    const service = new FaviconService()
    vi.mocked(browser.permissions.contains).mockResolvedValue(true)
    vi.mocked(browser.permissions.request).mockRejectedValue(
      new Error('denied'),
    )
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {})

    await expect(service.hasFetchPermissions()).resolves.toBe(true)
    await expect(service.requestFetchPermissions()).resolves.toBe(false)
    expect(consoleError).toHaveBeenCalledWith(
      'Failed to request favicon host permissions',
      expect.any(Error),
    )
  })

  it('returns false and logs when checking favicon permissions rejects', async () => {
    const service = new FaviconService()
    vi.mocked(browser.permissions.contains).mockRejectedValue(
      new Error('permissions'),
    )
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {})

    await expect(service.hasFetchPermissions()).resolves.toBe(false)
    expect(consoleError).toHaveBeenCalledWith(
      'Failed to check favicon host permissions',
      expect.any(Error),
    )
  })

  it('saves cache to storage and logs storage failures', async () => {
    const cache = new Map([
      [
        'example.test',
        {
          url: 'example.test',
          dataUrl: 'data:image/png;base64,cached',
          timestamp: 1,
        },
      ],
    ])
    const service = new FaviconService(
      { storageKey: 'favicons', expiryDays: 7 },
      cache,
    )

    await service.saveCacheToStorage()

    expect(browser.storage.local.set).toHaveBeenCalledWith({
      favicons: JSON.stringify(Array.from(cache.values())),
    })

    vi.mocked(browser.storage.local.set).mockRejectedValue(new Error('storage'))
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {})
    await service.saveCacheToStorage()

    expect(consoleError).toHaveBeenCalledWith(
      'Failed to save favicon cache to storage',
      expect.any(Error),
    )
  })
})
