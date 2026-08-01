import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { DEFAULT_SETTINGS } from '@/defaults/settings'
import { FaviconService } from '@/services/favicons'
import { Settings } from '@/services/settings'
import type { FaviconCacheEntry } from '@/types/favicons'
import { installFakeBrowser } from '../../helpers/fake-browser'

describe('favicon service', () => {
  const PNG_HEADER = new Uint8Array([
    0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a,
  ])

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

  function installBlobAwareFileReader() {
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

        readAsDataURL(blob: Blob) {
          void blob.arrayBuffer().then((buffer) => {
            this.result = `data:${blob.type};base64,${Buffer.from(buffer).toString('base64')}`
            this.onloadend?.call(
              this as unknown as FileReader,
              {} as ProgressEvent<FileReader>,
            )
          })
        }
      },
    )
  }

  function fetchedImageResponse(
    blob: Blob,
    options: { url?: string; contentType?: string } = {},
  ): Response {
    return {
      ok: true,
      url: options.url ?? 'https://cdn.example/icon.png',
      headers: new Headers({
        'content-type': options.contentType ?? blob.type,
        'content-length': String(blob.size),
      }),
      blob: vi.fn().mockResolvedValue(blob),
    } as unknown as Response
  }

  function installFaviconDomParser({
    baseHref,
    links,
  }: {
    baseHref?: string
    links: Array<{ rel: string; href: string; sizes?: string }>
  }) {
    vi.stubGlobal(
      'DOMParser',
      class {
        parseFromString() {
          return {
            querySelector: (selector: string) =>
              selector === 'base[href]' && baseHref
                ? { getAttribute: () => baseHref }
                : null,
            querySelectorAll: (selector: string) =>
              selector === 'link[rel]'
                ? links.map((attributes) => ({
                    getAttribute: (name: string) =>
                      attributes[name as keyof typeof attributes] ?? null,
                  }))
                : [],
          }
        }
      },
    )
  }

  beforeEach(() => {
    installFakeBrowser()
    vi.mocked(browser.permissions.contains).mockResolvedValue(true)
    Object.assign(Settings.values, structuredClone(DEFAULT_SETTINGS))
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

  it('suppresses a cached domain favicon only for a page known to have no icon (EV-09)', () => {
    const service = new FaviconService(
      undefined,
      new Map([
        [
          'example.test',
          {
            url: 'example.test',
            dataUrl: 'data:image/png;base64,cached',
            timestamp: 1,
          },
        ],
      ]),
    )

    service.markPageWithoutFavicon('https://example.test/no-icon')

    expect(service.getFavicon('https://example.test/no-icon')).toBe(
      '/icon/16.png',
    )
    expect(service.getFavicon('https://example.test/with-icon')).toBe(
      'data:image/png;base64,cached',
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

  it('loads a versioned cache envelope and ignores malformed entries', async () => {
    vi.mocked(browser.storage.local.get).mockResolvedValue({
      favicons: JSON.stringify({
        version: 1,
        entries: [
          {
            url: 'valid.test',
            dataUrl: 'data:image/png;base64,dmFsaWQ=',
            timestamp: 10,
          },
          {
            url: 'https://not-a-domain.test/path',
            dataUrl: 'data:image/png;base64,aW52YWxpZA==',
            timestamp: 10,
          },
          {
            url: 'bad-time.test',
            dataUrl: 'data:image/png;base64,aW52YWxpZA==',
            timestamp: Number.NaN,
          },
          {
            url: 'bad-data.test',
            dataUrl: 'https://bad-data.test/icon.png',
            timestamp: 10,
          },
          null,
        ],
      }),
    })
    const service = new FaviconService({
      storageKey: 'favicons',
      expiryDays: 7,
    })

    await service.init()

    expect(service.getFavicon('https://valid.test/page')).toBe(
      'data:image/png;base64,dmFsaWQ=',
    )
    expect(service.getFavicon('https://bad-time.test/page')).toBe(
      '/icon/16.png',
    )
    expect(service.getFavicon('https://bad-data.test/page')).toBe(
      '/icon/16.png',
    )
  })

  it('preserves the in-memory cache for incompatible schemas and read failures', async () => {
    const retained = {
      url: 'retained.test',
      dataUrl: 'data:image/png;base64,cmV0YWluZWQ=',
      timestamp: 1,
    }
    const cache = new Map([['retained.test', retained]])
    const service = new FaviconService(
      { storageKey: 'favicons', expiryDays: 7 },
      cache,
    )
    vi.mocked(browser.storage.local.get).mockResolvedValueOnce({
      favicons: JSON.stringify({ version: 999, entries: [] }),
    })

    await service.reloadCacheFromStorage()
    expect(cache.get('retained.test')).toBe(retained)

    vi.mocked(browser.storage.local.get).mockRejectedValueOnce(
      new Error('read failed'),
    )
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {})
    await service.reloadCacheFromStorage()

    expect(cache.get('retained.test')).toBe(retained)
    expect(consoleError).toHaveBeenCalledWith(
      'Failed to load favicon cache from storage',
      expect.any(Error),
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

  it('does not cache or display website favicons for private tabs when disabled', async () => {
    Settings.values.cachePrivateTabFavicons = false
    const cache = new Map([
      [
        'cached.test',
        {
          url: 'cached.test',
          dataUrl: 'data:image/png;base64,Y2FjaGVk',
          timestamp: 1,
        },
      ],
    ])
    const service = new FaviconService(undefined, cache)

    await service.updateFavicon('data:image/png;base64,cHJpdmF0ZQ==', {
      url: 'https://private.test/page',
      incognito: true,
    } as browser.tabs.Tab)

    expect(cache.has('private.test')).toBe(false)
    expect(service.getFavicon('https://cached.test/page', true)).toBe(
      '/icons/private-browsing.svg',
    )
    expect(service.getFavicon('https://cached.test/page', false)).toBe(
      'data:image/png;base64,Y2FjaGVk',
    )
  })

  it('removes private-only references while retaining shared and normal cache entries', () => {
    const cache = new Map(
      ['private.test', 'shared.test', 'normal.test', 'orphan.test'].map(
        (domain) => [
          domain,
          {
            url: domain,
            dataUrl: `data:image/png;base64,${domain}`,
            timestamp: 1,
          },
        ],
      ),
    )
    const service = new FaviconService(undefined, cache)

    const removed = service.removePrivateOnlyEntries([
      { url: 'https://private.test/saved', incognito: true },
      { url: 'https://shared.test/private', incognito: true },
      { url: 'https://shared.test/normal', incognito: false },
      { url: 'https://normal.test/page', incognito: false },
    ])

    expect(removed).toEqual(['private.test'])
    expect(cache.has('private.test')).toBe(false)
    expect(cache.has('shared.test')).toBe(true)
    expect(cache.has('normal.test')).toBe(true)
    expect(cache.has('orphan.test')).toBe(true)
  })

  it('removes an affected private domain only after its final tree reference disappears', () => {
    const cache = new Map([
      [
        'private.test',
        {
          url: 'private.test',
          dataUrl: 'data:image/png;base64,cHJpdmF0ZQ==',
          timestamp: 1,
        },
      ],
    ])
    const service = new FaviconService(undefined, cache)

    expect(
      service.removeDomainIfUnreferenced('https://private.test/old', [
        { url: 'https://private.test/saved', incognito: true },
      ]),
    ).toBe(false)
    expect(cache.has('private.test')).toBe(true)

    expect(
      service.removeDomainIfUnreferenced('https://private.test/old', []),
    ).toBe(true)
    expect(cache.has('private.test')).toBe(false)
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

  it('chooses the lowest live tab ID consistently when one domain exposes different icons (PD-FR-05)', async () => {
    const cache = new Map<string, FaviconCacheEntry>()
    const service = new FaviconService(undefined, cache)
    const updateFavicon = vi
      .spyOn(service, 'updateFavicon')
      .mockImplementation(async (faviconUrl, tab) => {
        cache.set('same.test', {
          url: 'same.test',
          dataUrl: faviconUrl,
          timestamp: 10_000,
        })
        expect(tab?.id).toBe(10)
      })
    vi.spyOn(service, 'saveCacheToStorage').mockResolvedValue(undefined)
    const lowerId = {
      id: 10,
      url: 'https://same.test/lower',
      favIconUrl: 'data:image/png;base64,bG93ZXI=',
    } as browser.tabs.Tab
    const higherId = {
      id: 20,
      url: 'https://same.test/higher',
      favIconUrl: 'data:image/png;base64,aGlnaGVy',
    } as browser.tabs.Tab

    await service.refreshFavicons(
      ['https://same.test/saved'],
      1_000,
      [higherId, lowerId],
      10_000,
    )
    cache.get('same.test')!.timestamp = 1
    await service.refreshFavicons(
      ['https://same.test/saved'],
      1_000,
      [lowerId, higherId],
      20_000,
    )

    expect(updateFavicon).toHaveBeenCalledTimes(2)
    expect(updateFavicon.mock.calls.map(([faviconUrl]) => faviconUrl)).toEqual([
      lowerId.favIconUrl,
      lowerId.favIconUrl,
    ])
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
    installBlobAwareFileReader()
    vi.stubGlobal(
      'fetch',
      vi
        .fn()
        .mockResolvedValue(
          fetchedImageResponse(new Blob([PNG_HEADER], { type: 'image/png' })),
        ),
    )

    const updateFavicon = service.updateFavicon(
      'https://cdn.example/icon.png',
      {
        url: 'https://page.example/articles/1',
      } as browser.tabs.Tab,
    )

    expect(cache.has('page.example')).toBe(false)
    await updateFavicon

    expect(fetch).toHaveBeenCalledWith(
      'https://cdn.example/icon.png',
      expect.objectContaining({ redirect: 'follow' }),
    )
    expect(cache.get('page.example')?.dataUrl).toMatch(
      /^data:image\/png;base64,/,
    )
  })

  it('deduplicates concurrent fetches for the same favicon source', async () => {
    installBlobAwareFileReader()
    const cache = new Map()
    const service = new FaviconService(undefined, cache)
    let resolveFetch!: (response: Response) => void
    vi.stubGlobal(
      'fetch',
      vi.fn().mockReturnValue(
        new Promise<Response>((resolve) => {
          resolveFetch = resolve
        }),
      ),
    )

    const first = service.updateFavicon('https://cdn.example/shared.png', {
      url: 'https://page.example/first',
    } as browser.tabs.Tab)
    const second = service.updateFavicon('https://cdn.example/shared.png', {
      url: 'https://page.example/second',
    } as browser.tabs.Tab)

    await vi.waitFor(() => expect(fetch).toHaveBeenCalledTimes(1))
    resolveFetch(
      fetchedImageResponse(new Blob([PNG_HEADER], { type: 'image/png' })),
    )
    await Promise.all([first, second])

    expect(cache.has('page.example')).toBe(true)
  })

  it('prevents an older slow favicon request from overwriting a newer one', async () => {
    installBlobAwareFileReader()
    const cache = new Map()
    const service = new FaviconService(undefined, cache)
    const pending = new Map<string, (response: Response) => void>()
    vi.stubGlobal(
      'fetch',
      vi
        .fn()
        .mockImplementation(
          (url: string) =>
            new Promise<Response>((resolve) => pending.set(url, resolve)),
        ),
    )

    const oldUpdate = service.updateFavicon('https://cdn.example/old.png', {
      url: 'https://page.example/article',
    } as browser.tabs.Tab)
    const newUpdate = service.updateFavicon('https://cdn.example/new.png', {
      url: 'https://page.example/article',
    } as browser.tabs.Tab)
    await vi.waitFor(() => {
      expect(pending.has('https://cdn.example/old.png')).toBe(true)
      expect(pending.has('https://cdn.example/new.png')).toBe(true)
    })
    const newerBytes = new Uint8Array([...PNG_HEADER, 2])
    pending.get('https://cdn.example/new.png')!(
      fetchedImageResponse(new Blob([newerBytes], { type: 'image/png' }), {
        url: 'https://cdn.example/new.png',
      }),
    )
    await newUpdate
    const newerDataUrl = cache.get('page.example')?.dataUrl

    pending.get('https://cdn.example/old.png')!(
      fetchedImageResponse(
        new Blob([new Uint8Array([...PNG_HEADER, 1])], { type: 'image/png' }),
        { url: 'https://cdn.example/old.png' },
      ),
    )
    await oldUpdate

    expect(cache.get('page.example')?.dataUrl).toBe(newerDataUrl)
  })

  it('aborts a favicon fetch at the ten-second timeout', async () => {
    vi.useFakeTimers()
    const cache = new Map()
    const service = new FaviconService(undefined, cache)
    let requestSignal: AbortSignal | undefined
    vi.stubGlobal(
      'fetch',
      vi.fn().mockImplementation(
        (_url: string, init?: RequestInit) =>
          new Promise<Response>((_resolve, reject) => {
            requestSignal = init?.signal ?? undefined
            requestSignal?.addEventListener('abort', () =>
              reject(new DOMException('Aborted', 'AbortError')),
            )
          }),
      ),
    )

    const update = service.updateFavicon('https://cdn.example/slow.png', {
      url: 'https://page.example/article',
    } as browser.tabs.Tab)
    await vi.advanceTimersByTimeAsync(9_999)
    expect(requestSignal?.aborted).toBe(false)
    await vi.advanceTimersByTimeAsync(1)
    await update

    expect(requestSignal?.aborted).toBe(true)
    expect(cache.has('page.example')).toBe(false)
  })

  it.each([
    {
      name: 'response over 1 MiB',
      response: () =>
        fetchedImageResponse(
          new Blob([new Uint8Array(1024 * 1024 + 1)], { type: 'image/png' }),
        ),
    },
    {
      name: 'non-image MIME type',
      response: () =>
        fetchedImageResponse(new Blob([PNG_HEADER], { type: 'image/png' }), {
          contentType: 'text/html',
        }),
    },
    {
      name: 'malformed image payload',
      response: () =>
        fetchedImageResponse(
          new Blob([new TextEncoder().encode('not an image')], {
            type: 'image/png',
          }),
        ),
    },
    {
      name: 'redirect to a non-web URL',
      response: () =>
        fetchedImageResponse(new Blob([PNG_HEADER], { type: 'image/png' }), {
          url: 'file:///tmp/icon.png',
        }),
    },
  ])(
    'rejects $name without replacing a cached favicon',
    async ({ response }) => {
      installBlobAwareFileReader()
      const oldEntry = {
        url: 'page.example',
        dataUrl: 'data:image/png;base64,b2xk',
        timestamp: 1,
      }
      const cache = new Map([['page.example', oldEntry]])
      const service = new FaviconService(undefined, cache)
      vi.stubGlobal('fetch', vi.fn().mockResolvedValue(response()))

      await service.updateFavicon('https://cdn.example/icon.png', {
        url: 'https://page.example/article',
      } as browser.tabs.Tab)

      expect(cache.get('page.example')).toBe(oldEntry)
    },
  )

  it('rejects a malformed data URL and accepts an accessible blob favicon', async () => {
    installBlobAwareFileReader()
    const cache = new Map()
    const service = new FaviconService(undefined, cache)

    await service.updateFavicon('data:image/png;base64,%%%', {
      url: 'https://bad-data.example/page',
    } as browser.tabs.Tab)
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(
        fetchedImageResponse(new Blob([PNG_HEADER], { type: 'image/png' }), {
          url: 'blob:https://page.example/123',
        }),
      ),
    )
    await service.updateFavicon('blob:https://page.example/123', {
      url: 'https://blob.example/page',
    } as browser.tabs.Tab)

    expect(cache.has('bad-data.example')).toBe(false)
    expect(cache.has('blob.example')).toBe(true)
  })

  it('falls back to an HTML icon link when the direct image fetch fails', async () => {
    const cache = new Map()
    const service = new FaviconService(undefined, cache)
    installBlobAwareFileReader()
    installFaviconDomParser({
      links: [{ rel: 'icon', href: '/icon.svg' }],
    })
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
        .mockResolvedValueOnce(
          fetchedImageResponse(
            new Blob(['<svg xmlns="http://www.w3.org/2000/svg"></svg>'], {
              type: 'image/svg+xml',
            }),
            { url: 'https://page.example/icon.svg' },
          ),
        ),
    )

    await service.updateFavicon('https://cdn.example/missing.ico', {
      url: 'https://page.example/articles/1',
    } as browser.tabs.Tab)

    expect(fetch).toHaveBeenNthCalledWith(
      1,
      'https://cdn.example/missing.ico',
      expect.objectContaining({ redirect: 'follow' }),
    )
    expect(fetch).toHaveBeenNthCalledWith(
      2,
      'https://page.example/articles/1',
      expect.objectContaining({ redirect: 'follow' }),
    )
    expect(fetch).toHaveBeenNthCalledWith(
      3,
      'https://page.example/icon.svg',
      expect.objectContaining({ redirect: 'follow' }),
    )
    expect(cache.get('page.example')?.dataUrl).toMatch(
      /^data:image\/svg\+xml;base64,/,
    )
  })

  it('honors an HTML base URL and prefers sizes="any" over raster icons', async () => {
    installBlobAwareFileReader()
    installFaviconDomParser({
      baseHref: '/assets/',
      links: [
        { rel: 'icon', href: 'small.png', sizes: '16x16' },
        { rel: 'shortcut icon', href: 'large.png', sizes: '128x128' },
        { rel: 'icon', href: 'vector.svg', sizes: 'any' },
      ],
    })
    const cache = new Map()
    const service = new FaviconService(undefined, cache)
    vi.stubGlobal(
      'fetch',
      vi
        .fn()
        .mockResolvedValueOnce({ ok: false, url: '' } as Response)
        .mockResolvedValueOnce({
          ok: true,
          url: 'https://page.example/articles/1',
          headers: new Headers({ 'content-type': 'text/html' }),
          text: vi.fn().mockResolvedValue('<html></html>'),
        } as unknown as Response)
        .mockResolvedValueOnce(
          fetchedImageResponse(
            new Blob(['<svg xmlns="http://www.w3.org/2000/svg"></svg>'], {
              type: 'image/svg+xml',
            }),
            { url: 'https://page.example/assets/vector.svg' },
          ),
        ),
    )

    await service.updateFavicon('https://cdn.example/missing.ico', {
      url: 'https://page.example/articles/1',
    } as browser.tabs.Tab)

    expect(fetch).toHaveBeenNthCalledWith(
      3,
      'https://page.example/assets/vector.svg',
      expect.objectContaining({ redirect: 'follow' }),
    )
    expect(cache.has('page.example')).toBe(true)
  })

  it('selects the largest declared HTML favicon when no scalable icon exists', async () => {
    installBlobAwareFileReader()
    installFaviconDomParser({
      links: [
        { rel: 'icon', href: '/16.png', sizes: '16x16' },
        { rel: 'icon', href: '/64.png', sizes: '64x64' },
        { rel: 'icon', href: '/32.png', sizes: '32x32' },
      ],
    })
    const service = new FaviconService()
    vi.stubGlobal(
      'fetch',
      vi
        .fn()
        .mockResolvedValueOnce({ ok: false, url: '' } as Response)
        .mockResolvedValueOnce({
          ok: true,
          url: 'https://page.example/',
          headers: new Headers({ 'content-type': 'text/html' }),
          text: vi.fn().mockResolvedValue('<html></html>'),
        } as unknown as Response)
        .mockResolvedValueOnce(
          fetchedImageResponse(new Blob([PNG_HEADER], { type: 'image/png' }), {
            url: 'https://page.example/64.png',
          }),
        ),
    )

    await service.updateFavicon('https://cdn.example/missing.ico', {
      url: 'https://page.example/',
    } as browser.tabs.Tab)

    expect(fetch).toHaveBeenNthCalledWith(
      3,
      'https://page.example/64.png',
      expect.objectContaining({ redirect: 'follow' }),
    )
  })

  it('aborts an HTML fallback request at ten seconds', async () => {
    vi.useFakeTimers()
    const service = new FaviconService()
    let htmlSignal: AbortSignal | undefined
    vi.stubGlobal(
      'fetch',
      vi
        .fn()
        .mockResolvedValueOnce({ ok: false, url: '' } as Response)
        .mockImplementationOnce((_url: string, init?: RequestInit) => {
          htmlSignal = init?.signal ?? undefined
          return new Promise<Response>((_resolve, reject) => {
            htmlSignal?.addEventListener('abort', () =>
              reject(new DOMException('Aborted', 'AbortError')),
            )
          })
        }),
    )

    const update = service.updateFavicon('https://cdn.example/missing.ico', {
      url: 'https://page.example/',
    } as browser.tabs.Tab)
    await vi.advanceTimersByTimeAsync(10_000)
    await update

    expect(htmlSignal?.aborted).toBe(true)
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
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {})

    await expect(service.hasFetchPermissions()).resolves.toBe(true)

    vi.mocked(browser.permissions.request).mockResolvedValueOnce(true)
    await expect(service.requestFetchPermissions()).resolves.toBe(true)

    vi.mocked(browser.permissions.request).mockResolvedValueOnce(false)
    await expect(service.requestFetchPermissions()).resolves.toBe(false)

    vi.mocked(browser.permissions.request).mockRejectedValueOnce(
      new Error('denied'),
    )
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

  it('does not fetch an HTTP favicon after website permission is revoked', async () => {
    const service = new FaviconService()
    vi.mocked(browser.permissions.contains).mockResolvedValue(false)
    vi.stubGlobal('fetch', vi.fn())

    await service.updateFavicon('https://cdn.example/icon.png', {
      url: 'https://page.example/article',
      incognito: false,
    } as browser.tabs.Tab)

    expect(browser.permissions.contains).toHaveBeenCalledWith({
      origins: ['http://*/*', 'https://*/*'],
    })
    expect(fetch).not.toHaveBeenCalled()
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
      favicons: JSON.stringify({
        version: 1,
        entries: Array.from(cache.values()),
      }),
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
