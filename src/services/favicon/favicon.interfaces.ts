export interface FaviconCacheEntry {
  dataUrl: string
  timestamp: number
  url: string
}

export interface FaviconStorageConfig {
  expiryDays: number
  storageKey: string
}
