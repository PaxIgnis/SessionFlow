export interface FaviconCacheEntry {
  dataUrl: string
  timestamp: number
  url: string
}

export interface FaviconCacheEnvelope {
  version: 1
  entries: FaviconCacheEntry[]
}

export interface FaviconReference {
  url: string
  incognito: boolean
}

export interface FaviconStorageConfig {
  expiryDays: number
  storageKey: string
}
