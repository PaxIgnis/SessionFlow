import { FaviconCacheEntry, FaviconStorageConfig } from '@/types/favicons'

export class FaviconService {
  private static readonly DEFAULT_CONFIG: FaviconStorageConfig = {
    expiryDays: 7,
    storageKey: 'sessionflow-favicon-cache',
  }

  private cache: Map<string, FaviconCacheEntry>
  private config: FaviconStorageConfig

  constructor(
    config?: FaviconStorageConfig,
    cache?: Map<string, FaviconCacheEntry>,
  ) {
    this.config = { ...FaviconService.DEFAULT_CONFIG, ...config }
    this.cache = cache ? cache : new Map()
    this.loadCacheFromStorage()
    this.updateCacheFromSessionTree()
  }

  /**
   * Loads the favicon cache from the browser storage
   *
   * @returns {Promise<void>} - A promise that resolves when the cache has been loaded
   */
  private async loadCacheFromStorage() {
    const cached = await browser.storage.local.get(this.config.storageKey)
    if (!cached?.[this.config.storageKey]) return
    const parsedCache = JSON.parse(
      cached[this.config.storageKey],
    ) as FaviconCacheEntry[]
    parsedCache.forEach((entry) => {
      this.cache.set(entry.url, entry)
    })
  }

  /**
   * Updates the favicon cache to include all favicons from open tabs
   *
   */
  private updateCacheFromSessionTree() {
    // loop through all open tabs and update the cache with their favicons
    browser.tabs.query({}).then((tabs) => {
      tabs.forEach((tab) => {
        const domain = this.getDomainFromUrl(tab.url!)
        // If the tab has a favicon and the tab's domain is not already in the cache, add it
        if (tab.favIconUrl && !this.cache.has(domain)) {
          this.updateFavicon(tab.favIconUrl, tab)
        }
      })
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
   * Updates the favicon in the cache for the given tab
   *
   * @param {string} favIconUrl - The data URL of the favicon
   * @param {browser.tabs.Tab} tab - The tab to update the favicon for
   * @returns {Promise<void>} - A promise that resolves when the favicon has been updated
   */
  public async updateFavicon(
    favIconUrl: string,
    tab: browser.tabs.Tab,
  ): Promise<void> {
    try {
      // extract the domain from the URL
      const domain = this.getDomainFromUrl(tab.url!)

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

      // If the favicon URL is a browser internal URL, set custom favicons
      if (
        domain.startsWith('chrome://') ||
        domain.startsWith('moz-extension://') ||
        domain.startsWith('about:') ||
        domain.startsWith('resource:')
      ) {
        // TODO: Implement solution to get icons for privileged URLs (e.g. about:config)
        return
      }

      // Otherwise fetch and convert
      const response = await fetch(favIconUrl)
      const blob = await response.blob()
      const dataUrl = await new Promise<string>((resolve, reject) => {
        const reader = new FileReader()
        reader.onloadend = () => resolve(reader.result as string)
        reader.onerror = reject
        reader.readAsDataURL(blob)
      })
      if (!dataUrl || dataUrl === '') {
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

  /**
   * Extracts the domain from a URL
   *
   * @param {string} url - The URL to extract the domain from
   * @returns {string} - The domain extracted from the URL
   */
  private getDomainFromUrl(url: string): string {
    try {
      let domain = ''
      // If the URL is a privileged firefox URL, use it directly
      // Otherwise, extract the domain from the URL
      if (
        url.startsWith('chrome://') ||
        url.startsWith('moz-extension://') ||
        url.startsWith('about:') ||
        url.startsWith('resource:')
      ) {
        domain = url
      } else {
        domain = new URL(url).hostname
      }
      return domain
    } catch (error) {
      console.error('Failed to parse URL', error, url)
      return ''
    }
  }
}
