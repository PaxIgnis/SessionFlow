import { Settings } from '@/services/settings'
import {
  FaviconCacheEntry,
  FaviconCacheEnvelope,
  FaviconReference,
  FaviconStorageConfig,
} from '@/types/favicons'

type FaviconTabSource = Pick<browser.tabs.Tab, 'url' | 'favIconUrl'> & {
  id?: number
  incognito?: boolean
}

interface FaviconImageFetchResult {
  dataUrl?: string
  allowFallback: boolean
}

const FAVICON_PERMISSION_ORIGINS = ['http://*/*', 'https://*/*']
const FAVICON_FETCH_TIMEOUT_MS = 10_000
const MAX_FAVICON_BYTES = 1024 * 1024
const PRIVATE_BROWSING_ICON = '/icons/private-browsing.svg'

export class FaviconService {
  private static readonly DEFAULT_CONFIG: FaviconStorageConfig = {
    expiryDays: 7,
    storageKey: 'sessionflow-favicon-cache',
  }

  private cache: Map<string, FaviconCacheEntry>
  private faviconlessPages = new Set<string>()
  private config: FaviconStorageConfig
  private initialized = false
  private initPromise: Promise<void> | undefined
  private readonly inFlightImageFetches = new Map<
    string,
    Promise<FaviconImageFetchResult>
  >()
  private readonly domainGenerations = new Map<string, number>()

  constructor(
    config?: FaviconStorageConfig,
    cache?: Map<string, FaviconCacheEntry>,
  ) {
    this.config = { ...FaviconService.DEFAULT_CONFIG, ...config }
    this.cache = cache ? cache : new Map()
  }

  /**
   * Initializes the service by loading persisted cache.
   *
   * @returns {Promise<void>} - A promise that resolves when initialization is complete
   */
  public async init(): Promise<void> {
    if (this.initialized) return
    if (!this.initPromise) {
      this.initPromise = this.loadCacheFromStorage()
    }
    try {
      await this.initPromise
      this.initialized = true
    } finally {
      this.initPromise = undefined
    }
  }

  /**
   * Reloads the persisted cache, replacing any in-memory entries.
   * This is used by extension views after the background refreshes favicons.
   */
  public async reloadCacheFromStorage(): Promise<void> {
    await this.loadCacheFromStorage()
    this.initialized = true
  }

  public async hasFetchPermissions(): Promise<boolean> {
    try {
      return await browser.permissions.contains({
        origins: FAVICON_PERMISSION_ORIGINS,
      })
    } catch (error) {
      console.error('Failed to check favicon host permissions', error)
      return false
    }
  }

  public async requestFetchPermissions(): Promise<boolean> {
    try {
      return await browser.permissions.request({
        origins: FAVICON_PERMISSION_ORIGINS,
      })
    } catch (error) {
      console.error('Failed to request favicon host permissions', error)
      return false
    }
  }

  /**
   * Loads the favicon cache from the browser storage
   *
   * @returns {Promise<void>} - A promise that resolves when the cache has been loaded
   */
  private async loadCacheFromStorage() {
    try {
      const cached = await browser.storage.local.get(this.config.storageKey)
      if (!cached?.[this.config.storageKey]) return
      const parsedCache = JSON.parse(cached[this.config.storageKey]) as unknown
      const entries = this.readPersistedEntries(parsedCache)
      if (!entries) return

      this.cache.clear()
      entries.forEach((entry) => this.cache.set(entry.url, entry))
    } catch (error) {
      console.error('Failed to load favicon cache from storage', error)
    }
  }

  private readPersistedEntries(
    value: unknown,
  ): FaviconCacheEntry[] | undefined {
    let entries: unknown[]
    if (Array.isArray(value)) {
      entries = value
    } else if (
      typeof value === 'object' &&
      value !== null &&
      (value as { version?: unknown }).version === 1 &&
      Array.isArray((value as { entries?: unknown }).entries)
    ) {
      entries = (value as FaviconCacheEnvelope).entries
    } else {
      return undefined
    }

    return entries.filter((entry): entry is FaviconCacheEntry =>
      this.isValidCacheEntry(entry),
    )
  }

  private isValidCacheEntry(value: unknown): value is FaviconCacheEntry {
    if (typeof value !== 'object' || value === null) return false
    const entry = value as Partial<FaviconCacheEntry>
    return (
      typeof entry.url === 'string' &&
      this.isDomain(entry.url) &&
      typeof entry.dataUrl === 'string' &&
      /^data:image\/[a-z0-9.+-]+(?:;[^,]*)?,.+$/i.test(entry.dataUrl) &&
      typeof entry.timestamp === 'number' &&
      Number.isFinite(entry.timestamp) &&
      entry.timestamp >= 0
    )
  }

  private isDomain(value: string): boolean {
    if (value === '' || value.includes('/') || value.includes(':')) return false
    try {
      return new URL(`https://${value}`).hostname === value
    } catch {
      return false
    }
  }

  /**
   * Updates the favicon cache to include all favicons from open tabs
   *
   */
  public warmCacheFromTabs(tabs: Iterable<FaviconTabSource>) {
    Array.from(tabs).forEach((tab) => {
      if (!tab.url || !tab.favIconUrl) return
      if (tab.incognito && !Settings.values.cachePrivateTabFavicons) return
      if (!this.isWebUrl(tab.url)) return
      const domain = this.getDomainFromUrl(tab.url)
      // If the tab has a favicon and the tab's domain is not already in the cache, add it
      if (domain && !this.cache.has(domain)) {
        void this.updateFavicon(tab.favIconUrl, tab as browser.tabs.Tab)
      }
    })
  }

  /**
   * Saves the favicon cache to the browser storage
   *
   * @returns {Promise<void>} - A promise that resolves when the cache has been saved
   */
  public async saveCacheToStorage() {
    console.log('Saving favicon cache to storage')
    try {
      await browser.storage.local.set({
        [this.config.storageKey]: JSON.stringify({
          version: 1,
          entries: Array.from(this.cache.values()).filter((entry) =>
            this.isValidCacheEntry(entry),
          ),
        } satisfies FaviconCacheEnvelope),
      })
    } catch (error) {
      console.error('Failed to save favicon cache to storage', error)
    }
  }

  /**
   * Fetches and stores the favicon for a given URL
   *
   * @param url - The URL to fetch the favicon for
   */
  public async fetchAndStoreFavicon(url: string): Promise<void> {
    try {
      if (!this.isWebUrl(url)) {
        return
      }

      const domain = this.getDomainFromUrl(url)
      if (!domain) {
        return
      }

      const parsedUrl = new URL(url)
      const faviconUrl = `${parsedUrl.protocol}//${domain}/favicon.ico`
      await this.updateFavicon(faviconUrl, { url } as browser.tabs.Tab)
    } catch (error) {
      console.error('Failed to fetch favicon for URL', error, url)
    }
  }

  /**
   * Gets the favicon data URL for a given URL (domain) from the cache.
   *
   * @param {string} url - The URL to get the favicon for
   * @returns {Promise<string>} - A promise that resolves with the favicon data URL
   */
  public getFavicon(url: string, privateTab: boolean = false): string {
    if (privateTab && !Settings.values.cachePrivateTabFavicons) {
      return PRIVATE_BROWSING_ICON
    }
    if (this.faviconlessPages.has(url)) return '/icon/16.png'
    // extract the domain from the URL
    const domain = this.getDomainFromUrl(url)
    // check if the favicon is in the cache
    const entry = this.cache.get(domain)
    if (entry && entry.dataUrl && entry.dataUrl !== '') {
      return entry.dataUrl
    }
    // TODO: Implement logic if favicon is missing, before setting default icon
    return '/icon/16.png'
  }

  /** Removes cached domains referenced by private items but no normal items. */
  public removePrivateOnlyEntries(
    references: Iterable<FaviconReference>,
  ): string[] {
    const privateDomains = new Set<string>()
    const normalDomains = new Set<string>()
    for (const reference of references) {
      const domain = this.getDomainFromUrl(reference.url)
      if (!domain) continue
      ;(reference.incognito ? privateDomains : normalDomains).add(domain)
    }

    const removed: string[] = []
    for (const domain of privateDomains) {
      if (!normalDomains.has(domain) && this.cache.delete(domain)) {
        removed.push(domain)
      }
    }
    return removed
  }

  /** Removes one affected domain after its final tree reference disappears. */
  public removeDomainIfUnreferenced(
    pageUrl: string,
    references: Iterable<FaviconReference>,
  ): boolean {
    const domain = this.getDomainFromUrl(pageUrl)
    if (!domain) return false
    for (const reference of references) {
      if (this.getDomainFromUrl(reference.url) === domain) return false
    }
    return this.cache.delete(domain)
  }

  /**
   * Prevents a domain-level cached favicon from being shown for a specific page
   * that Firefox has authoritatively reported as faviconless.
   */
  public markPageWithoutFavicon(url: string): void {
    if (this.isWebUrl(url)) this.faviconlessPages.add(url)
  }

  /**
   * Fetches favicons for URL domains that are not already in the cache.
   *
   * @param urls - Iterable of web page URLs
   */
  public async fetchMissingFavicons(urls: Iterable<string>): Promise<void> {
    // create list of domains from URL list, remove duplicates and domains that are already in the cache
    const firstUrlByDomain = new Map<string, string>()
    Array.from(urls).forEach((url) => {
      if (!url) return
      if (!this.isWebUrl(url)) return
      const domain = this.getDomainFromUrl(url)
      if (domain && !this.cache.has(domain) && !firstUrlByDomain.has(domain)) {
        firstUrlByDomain.set(domain, url)
      }
    })

    const tasks = Array.from(firstUrlByDomain.values()).map((url) =>
      this.fetchAndStoreFavicon(url),
    )
    await Promise.allSettled(tasks)
    await this.saveCacheToStorage()
  }

  /**
   * Refreshes each missing or expired favicon represented by the supplied URLs.
   * Open-tab favicon URLs are preferred because they reflect the icon Firefox is
   * currently displaying. Saved tabs fall back to fetching from their page.
   *
   * @param urls - Page URLs represented in the session tree
   * @param maxAgeMs - Maximum cache-entry age before it is considered expired
   * @param openTabs - Current browser tabs whose favicon URLs may be reused
   * @param now - Current time, injectable for deterministic scheduling/tests
   * @returns Cache entries that were successfully added or replaced
   */
  public async refreshFavicons(
    urls: Iterable<string>,
    maxAgeMs: number,
    openTabs: Iterable<FaviconTabSource> = [],
    now: number = Date.now(),
  ): Promise<FaviconCacheEntry[]> {
    const firstUrlByDomain = this.getFirstWebUrlByDomain(urls)
    const dueDomains = new Set<string>()

    firstUrlByDomain.forEach((_url, domain) => {
      const entry = this.cache.get(domain)
      if (
        !entry ||
        !Number.isFinite(entry.timestamp) ||
        now - entry.timestamp >= maxAgeMs
      ) {
        dueDomains.add(domain)
      }
    })

    if (dueDomains.size === 0) return []

    const liveTabByDomain = new Map<string, FaviconTabSource>()
    Array.from(openTabs)
      .map((tab, order) => ({ tab, order }))
      .sort(
        (left, right) =>
          (left.tab.id ?? Number.MAX_SAFE_INTEGER) -
            (right.tab.id ?? Number.MAX_SAFE_INTEGER) ||
          left.order - right.order,
      )
      .forEach(({ tab }) => {
        if (!tab.url || !tab.favIconUrl || !this.isWebUrl(tab.url)) return
        if (!this.canUseFaviconUrl(tab.favIconUrl)) return
        const domain = this.getDomainFromUrl(tab.url)
        if (domain && dueDomains.has(domain) && !liveTabByDomain.has(domain)) {
          liveTabByDomain.set(domain, tab)
        }
      })

    const previousEntries = new Map<string, FaviconCacheEntry | undefined>()
    const tasks = Array.from(dueDomains).map((domain) => {
      previousEntries.set(domain, this.cache.get(domain))
      const liveTab = liveTabByDomain.get(domain)
      if (liveTab?.favIconUrl) {
        return this.updateFavicon(
          liveTab.favIconUrl,
          liveTab as browser.tabs.Tab,
        )
      }
      return this.fetchAndStoreFavicon(firstUrlByDomain.get(domain)!)
    })

    await Promise.allSettled(tasks)
    await this.saveCacheToStorage()

    return Array.from(dueDomains).flatMap((domain) => {
      const entry = this.cache.get(domain)
      return entry && entry !== previousEntries.get(domain) ? [entry] : []
    })
  }

  /**
   * Finds the next time a favicon represented by the supplied URLs expires.
   * Already-due or missing entries are retried after one full interval so a
   * failed network request cannot create a tight alarm loop.
   */
  public getNextRefreshAt(
    urls: Iterable<string>,
    maxAgeMs: number,
    now: number = Date.now(),
  ): number | undefined {
    if (!Number.isFinite(maxAgeMs) || maxAgeMs <= 0) return undefined

    const firstUrlByDomain = this.getFirstWebUrlByDomain(urls)
    let nextRefreshAt: number | undefined
    let hasDueEntry = false

    firstUrlByDomain.forEach((_url, domain) => {
      const entry = this.cache.get(domain)
      if (!entry || !Number.isFinite(entry.timestamp)) {
        hasDueEntry = true
        return
      }

      const expiresAt = entry.timestamp + maxAgeMs
      if (expiresAt <= now) {
        hasDueEntry = true
        return
      }

      nextRefreshAt = Math.min(nextRefreshAt ?? expiresAt, expiresAt)
    })

    if (hasDueEntry) {
      nextRefreshAt = Math.min(nextRefreshAt ?? now + maxAgeMs, now + maxAgeMs)
    }

    return nextRefreshAt
  }

  /**
   * Updates the favicon in the cache for the given tab
   *
   * @param {string} favIconUrl - The data URL of the favicon
   * @param {browser.tabs.Tab} tab - The tab to update the favicon for
   * @param {string} url - The URL of the tab to update the favicon for (used if tab.url is undefined)
   * @returns {Promise<void>} - A promise that resolves when the favicon has been updated
   */
  public async updateFavicon(
    favIconUrl: string,
    tab?: browser.tabs.Tab,
    url?: string,
  ): Promise<void> {
    try {
      if (tab?.incognito && !Settings.values.cachePrivateTabFavicons) return
      const pageUrl = tab?.url || url
      if (pageUrl) this.faviconlessPages.delete(pageUrl)
      // extract the domain from the URL
      const domain = this.getDomainFromUrl(pageUrl!)
      if (!domain) return
      const generation = (this.domainGenerations.get(domain) ?? 0) + 1
      this.domainGenerations.set(domain, generation)

      // If the favicon URL is a data URL, store it directly
      if (favIconUrl.startsWith('data:')) {
        if (!this.isValidDataImageUrl(favIconUrl)) return
        const faviconData: FaviconCacheEntry = {
          dataUrl: favIconUrl,
          timestamp: Date.now(),
          url: domain,
        }
        if (this.domainGenerations.get(domain) === generation) {
          this.cache.set(domain, faviconData)
        }
        return
      }

      if (!this.isSupportedFaviconSource(favIconUrl)) {
        return
      }
      if (this.isWebUrl(favIconUrl) && !(await this.hasFetchPermissions())) {
        return
      }

      await this.fetchAndCacheFavicon(
        domain,
        favIconUrl,
        tab?.url || url,
        generation,
      )
    } catch (error) {
      console.error('Failed to update favicon', error, favIconUrl)
    }
  }

  private async fetchAndCacheFavicon(
    domain: string,
    favIconUrl: string,
    pageUrl?: string,
    generation?: number,
  ): Promise<void> {
    try {
      const imageResult = await this.fetchImageAsDataUrl(favIconUrl)
      const dataUrl = imageResult.dataUrl
      if (!dataUrl || dataUrl === '') {
        if (!imageResult.allowFallback) return
        if (
          generation !== undefined &&
          this.domainGenerations.get(domain) !== generation
        ) {
          return
        }
        const fallbackDataUrl = await this.fetchFaviconFromHtmlFallback(
          domain,
          pageUrl,
        )
        if (!fallbackDataUrl || fallbackDataUrl === '') {
          return
        }

        const faviconData: FaviconCacheEntry = {
          dataUrl: fallbackDataUrl,
          timestamp: Date.now(),
          url: domain,
        }
        if (
          generation === undefined ||
          this.domainGenerations.get(domain) === generation
        ) {
          this.cache.set(domain, faviconData)
        }
        return
      }

      const faviconData: FaviconCacheEntry = {
        dataUrl,
        timestamp: Date.now(),
        url: domain,
      }
      if (
        generation === undefined ||
        this.domainGenerations.get(domain) === generation
      ) {
        this.cache.set(domain, faviconData)
      }
    } catch (error) {
      console.error('Failed to update favicon', error, favIconUrl)
    }
  }

  private async fetchImageAsDataUrl(
    url: string,
  ): Promise<FaviconImageFetchResult> {
    const existing = this.inFlightImageFetches.get(url)
    if (existing) return existing

    const request = this.performImageFetch(url)
    this.inFlightImageFetches.set(url, request)
    try {
      return await request
    } finally {
      if (this.inFlightImageFetches.get(url) === request) {
        this.inFlightImageFetches.delete(url)
      }
    }
  }

  private async performImageFetch(
    url: string,
  ): Promise<FaviconImageFetchResult> {
    const controller = new AbortController()
    const timeout = setTimeout(
      () => controller.abort(),
      FAVICON_FETCH_TIMEOUT_MS,
    )
    try {
      const response = await fetch(url, {
        signal: controller.signal,
        redirect: 'follow',
      })
      if (!response.ok) {
        return { allowFallback: true }
      }

      const sourceProtocol = new URL(url).protocol
      const finalUrl = response.url || url
      const finalProtocol = new URL(finalUrl).protocol
      if (
        sourceProtocol !== 'blob:' &&
        finalProtocol !== 'http:' &&
        finalProtocol !== 'https:'
      ) {
        return { allowFallback: true }
      }

      const contentLength = Number(response.headers?.get('content-length'))
      if (Number.isFinite(contentLength) && contentLength > MAX_FAVICON_BYTES) {
        return { allowFallback: true }
      }

      const blob = await response.blob()
      if (blob.size === 0 || blob.size > MAX_FAVICON_BYTES) {
        return { allowFallback: true }
      }
      const responseMime =
        response.headers?.get('content-type')?.split(';', 1)[0].trim() ||
        blob.type
      if (!responseMime?.toLowerCase().startsWith('image/')) {
        return { allowFallback: true }
      }
      if (!(await this.hasValidImagePayload(blob, responseMime))) {
        return { allowFallback: true }
      }

      const dataUrl = await new Promise<string>((resolve, reject) => {
        const reader = new FileReader()
        reader.onloadend = () => resolve(reader.result as string)
        reader.onerror = reject
        reader.readAsDataURL(blob)
      })
      return { dataUrl, allowFallback: true }
    } catch {
      return { allowFallback: !controller.signal.aborted }
    } finally {
      clearTimeout(timeout)
    }
  }

  private async hasValidImagePayload(
    blob: Blob,
    mimeType: string,
  ): Promise<boolean> {
    const bytes = new Uint8Array(await blob.arrayBuffer())
    const normalizedMime = mimeType.toLowerCase()
    if (normalizedMime === 'image/svg+xml') {
      const text = new TextDecoder().decode(bytes.slice(0, 4096))
      return /(?:<\?xml[^>]*>\s*)?(?:<!--[^]*?-->\s*)*<svg(?:\s|>)/i.test(
        text.trimStart(),
      )
    }
    if (normalizedMime === 'image/png') {
      const signature = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]
      return signature.every((byte, index) => bytes[index] === byte)
    }
    if (normalizedMime === 'image/jpeg') {
      return bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff
    }
    if (normalizedMime === 'image/gif') {
      return new TextDecoder().decode(bytes.slice(0, 4)) === 'GIF8'
    }
    if (normalizedMime === 'image/webp') {
      return (
        new TextDecoder().decode(bytes.slice(0, 4)) === 'RIFF' &&
        new TextDecoder().decode(bytes.slice(8, 12)) === 'WEBP'
      )
    }
    if (
      normalizedMime === 'image/x-icon' ||
      normalizedMime === 'image/vnd.microsoft.icon'
    ) {
      return (
        bytes[0] === 0 && bytes[1] === 0 && bytes[2] === 1 && bytes[3] === 0
      )
    }
    return bytes.length > 0
  }

  private isValidDataImageUrl(url: string): boolean {
    const match = url.match(/^data:(image\/[a-z0-9.+-]+)(;base64)?,(.*)$/is)
    if (!match) return false
    try {
      const payload = match[3]
      const byteLength = match[2]
        ? atob(payload.replace(/\s/g, '')).length
        : new TextEncoder().encode(decodeURIComponent(payload)).length
      return byteLength > 0 && byteLength <= MAX_FAVICON_BYTES
    } catch {
      return false
    }
  }

  private async fetchFaviconFromHtmlFallback(
    domain: string,
    pageUrl?: string,
  ): Promise<string | undefined> {
    try {
      const candidatePageUrl =
        pageUrl && this.isWebUrl(pageUrl) ? pageUrl : `https://${domain}`

      const page = await this.fetchHtmlPage(candidatePageUrl)
      if (!page) return undefined
      const iconUrl = this.extractFaviconUrlFromHtml(
        page.html,
        page.responseUrl,
      )
      if (!iconUrl) return undefined

      return (await this.fetchImageAsDataUrl(iconUrl)).dataUrl
    } catch {
      return undefined
    }
  }

  private async fetchHtmlPage(
    url: string,
  ): Promise<{ html: string; responseUrl: string } | undefined> {
    const controller = new AbortController()
    const timeout = setTimeout(
      () => controller.abort(),
      FAVICON_FETCH_TIMEOUT_MS,
    )
    try {
      const response = await fetch(url, {
        signal: controller.signal,
        redirect: 'follow',
      })
      if (!response.ok) return undefined
      const responseUrl = response.url || url
      if (!this.isWebUrl(responseUrl)) return undefined

      const contentLength = Number(response.headers?.get('content-length'))
      if (Number.isFinite(contentLength) && contentLength > MAX_FAVICON_BYTES) {
        return undefined
      }
      const html = await response.text()
      if (new TextEncoder().encode(html).length > MAX_FAVICON_BYTES) {
        return undefined
      }
      return { html, responseUrl }
    } catch {
      return undefined
    } finally {
      clearTimeout(timeout)
    }
  }

  private extractFaviconUrlFromHtml(
    html: string,
    pageUrl: string,
  ): string | undefined {
    const document = new DOMParser().parseFromString(html, 'text/html')
    const baseHref = document.querySelector('base[href]')?.getAttribute('href')
    const baseUrl = baseHref ? new URL(baseHref, pageUrl).toString() : pageUrl
    const candidates = Array.from(document.querySelectorAll('link[rel]'))
      .map((link, order) => {
        const relTokens = (link.getAttribute('rel') ?? '')
          .toLowerCase()
          .split(/\s+/)
          .filter(Boolean)
        const href = link.getAttribute('href')
        if (
          !href ||
          !relTokens.some(
            (token) => token === 'icon' || token.endsWith('-icon'),
          )
        ) {
          return undefined
        }
        const sizes = (link.getAttribute('sizes') ?? '').toLowerCase()
        const score = sizes.split(/\s+/).reduce((largest, size) => {
          if (size === 'any') return Number.POSITIVE_INFINITY
          const match = size.match(/^(\d+)x(\d+)$/)
          if (!match) return largest
          return Math.max(largest, Number(match[1]) * Number(match[2]))
        }, 0)
        return { href, order, score }
      })
      .filter(
        (
          candidate,
        ): candidate is { href: string; order: number; score: number } =>
          candidate !== undefined,
      )
      .sort(
        (left, right) => right.score - left.score || left.order - right.order,
      )

    for (const candidate of candidates) {
      try {
        const iconUrl = new URL(candidate.href, baseUrl).toString()
        if (
          this.isValidDataImageUrl(iconUrl) ||
          this.isSupportedFaviconSource(iconUrl)
        ) {
          return iconUrl
        }
      } catch {
        // Try the next declared icon.
      }
    }
    return undefined
  }

  private getFirstWebUrlByDomain(urls: Iterable<string>): Map<string, string> {
    const firstUrlByDomain = new Map<string, string>()
    Array.from(urls).forEach((url) => {
      if (!url || !this.isWebUrl(url)) return
      const domain = this.getDomainFromUrl(url)
      if (domain && !firstUrlByDomain.has(domain)) {
        firstUrlByDomain.set(domain, url)
      }
    })
    return firstUrlByDomain
  }

  private canUseFaviconUrl(url: string): boolean {
    return this.isValidDataImageUrl(url) || this.isSupportedFaviconSource(url)
  }

  private isSupportedFaviconSource(url: string): boolean {
    try {
      const protocol = new URL(url).protocol
      return (
        protocol === 'http:' || protocol === 'https:' || protocol === 'blob:'
      )
    } catch {
      return false
    }
  }

  /**
   * Extracts the domain from a URL
   *
   * @param {string} url - The URL to extract the domain from
   * @returns {string} - The domain extracted from the URL
   */
  private getDomainFromUrl(url: string): string {
    try {
      return new URL(url).hostname
    } catch (error) {
      console.error('Failed to parse URL', error, url)
      return ''
    }
  }

  private isWebUrl(url: string): boolean {
    try {
      const protocol = new URL(url).protocol
      return protocol === 'http:' || protocol === 'https:'
    } catch {
      return false
    }
  }
}

export const Favicons = new FaviconService()
