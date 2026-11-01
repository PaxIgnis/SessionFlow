import { FAVICON_CACHE_STORAGE_KEY, STORAGE_KEY } from '@/defaults/constants'
import { formatNumber } from '@/services/i18n'

export const STORAGE_USAGE_CATEGORIES = [
  'tree',
  'snapshots',
  'favicons',
  'settings',
  'other',
] as const

export type StorageUsageCategory = (typeof STORAGE_USAGE_CATEGORIES)[number]

export interface StorageUsage {
  categories: Record<StorageUsageCategory, number>
  total: number
}

const CATEGORY_BY_STORAGE_KEY: Record<string, StorageUsageCategory> = {
  [STORAGE_KEY]: 'tree',
  [FAVICON_CACHE_STORAGE_KEY]: 'favicons',
  settings: 'settings',
}

const encoder = new TextEncoder()

/**
 * Estimates usage from the serialized size of each stored value. Firefox keeps
 * its own bookkeeping on disk, so these are sizes of the data rather than of
 * the profile files.
 */
export function storageUsageFromItems(
  localItems: Record<string, unknown>,
  snapshotBytes: number,
): StorageUsage {
  const categories: Record<StorageUsageCategory, number> = {
    tree: 0,
    snapshots: snapshotBytes,
    favicons: 0,
    settings: 0,
    other: 0,
  }
  for (const [key, value] of Object.entries(localItems)) {
    const category = CATEGORY_BY_STORAGE_KEY[key] ?? 'other'
    categories[category] += serializedBytes(key, value)
  }
  const total = Object.values(categories).reduce((sum, bytes) => sum + bytes, 0)
  return { categories, total }
}

function serializedBytes(key: string, value: unknown): number {
  return (
    encoder.encode(key).length +
    encoder.encode(JSON.stringify(value) ?? '').length
  )
}

export function formatBytes(value: number): string {
  if (value < 1024) return `${formatNumber(value)} B`
  if (value < 1024 * 1024) return `${formatNumber(Math.round(value / 1024))} KB`
  return `${formatNumber(value / 1024 / 1024, { minimumFractionDigits: 2, maximumFractionDigits: 2 })} MB`
}
