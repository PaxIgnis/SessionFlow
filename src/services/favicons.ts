import { FaviconCacheEntry, FaviconStorageConfig } from '@/types/favicons'

type FaviconTabSource = Pick<browser.tabs.Tab, 'url' | 'favIconUrl'>

const FAVICON_PERMISSION_ORIGINS = ['http://*/*', 'https://*/*']

export class FaviconService {
  private static readonly DEFAULT_CONFIG: FaviconStorageConfig = {
    expiryDays: 7,
    storageKey: 'sessionflow-favicon-cache',
  }

  private cache: Map<string, FaviconCacheEntry>
  private config: FaviconStorageConfig
  private initialized = false
  private initPromise: Promise<void> | undefined

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
      const parsedCache = JSON.parse(
        cached[this.config.storageKey],
      ) as FaviconCacheEntry[]
      parsedCache.forEach((entry) => {
        this.cache.set(entry.url, entry)
      })
    } catch (error) {
      console.error('Failed to load favicon cache from storage', error)
    }
  }

  /**
   * Updates the favicon cache to include all favicons from open tabs
   *
   */
  public warmCacheFromTabs(tabs: Iterable<FaviconTabSource>) {
    Array.from(tabs).forEach((tab) => {
      if (!tab.url || !tab.favIconUrl) return
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
        [this.config.storageKey]: JSON.stringify(
          Array.from(this.cache.values()),
        ),
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
  public getFavicon(url: string): string {
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
      // extract the domain from the URL
      const domain = this.getDomainFromUrl(tab?.url || url!)
      if (!domain) return

      // If the favicon URL is a data URL, store it directly
      if (favIconUrl.startsWith('data:')) {
        const faviconData: FaviconCacheEntry = {
          dataUrl: favIconUrl,
          timestamp: Date.now(),
          url: domain,
        }
        this.cache.set(domain, faviconData)
        return
      }

      if (!this.isWebUrl(favIconUrl)) {
        return
      }

      await this.fetchAndCacheFavicon(domain, favIconUrl, tab?.url || url)
    } catch (error) {
      console.error('Failed to update favicon', error, favIconUrl)
    }
  }

  private async fetchAndCacheFavicon(
    domain: string,
    favIconUrl: string,
    pageUrl?: string,
  ): Promise<void> {
    try {
      const dataUrl = await this.fetchImageAsDataUrl(favIconUrl)
      if (!dataUrl || dataUrl === '') {
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
        this.cache.set(domain, faviconData)
        return
      }

      const faviconData: FaviconCacheEntry = {
        dataUrl,
        timestamp: Date.now(),
        url: domain,
      }
      this.cache.set(domain, faviconData)
    } catch (error) {
      console.error('Failed to update favicon', error, favIconUrl)
    }
  }

  private async fetchImageAsDataUrl(url: string): Promise<string | undefined> {
    try {
      const response = await fetch(url)
      if (!response.ok) {
        return undefined
      }

      const blob = await response.blob()
      return await new Promise<string>((resolve, reject) => {
        const reader = new FileReader()
        reader.onloadend = () => resolve(reader.result as string)
        reader.onerror = reject
        reader.readAsDataURL(blob)
      })
    } catch {
      return undefined
    }
  }

  private async fetchFaviconFromHtmlFallback(
    domain: string,
    pageUrl?: string,
  ): Promise<string | undefined> {
    try {
      const candidatePageUrl =
        pageUrl && this.isWebUrl(pageUrl) ? pageUrl : `https://${domain}`

      const response = await fetch(candidatePageUrl)
      if (!response.ok) {
        return undefined
      }

      const html = await response.text()
      const iconHref = this.extractFaviconHrefFromHtml(html)
      if (!iconHref) {
        return undefined
      }

      const iconUrl = new URL(iconHref, candidatePageUrl).toString()
      if (!this.isWebUrl(iconUrl)) {
        return undefined
      }

      return await this.fetchImageAsDataUrl(iconUrl)
    } catch {
      return undefined
    }
  }

  private extractFaviconHrefFromHtml(html: string): string | undefined {
    const iconLinkRegex =
      /<link[^>]*rel=["'][^"']*icon[^"']*["'][^>]*href=["']([^"']+)["'][^>]*>|<link[^>]*href=["']([^"']+)["'][^>]*rel=["'][^"']*icon[^"']*["'][^>]*>/i
    const match = html.match(iconLinkRegex)
    return match?.[1] || match?.[2] || undefined
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
