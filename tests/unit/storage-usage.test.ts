import { describe, expect, it } from 'vitest'
import { FAVICON_CACHE_STORAGE_KEY, STORAGE_KEY } from '@/defaults/constants'
import { storageUsageFromItems } from '@/services/storage-usage'

const bytes = (key: string, value: unknown) =>
  new TextEncoder().encode(key).length +
  new TextEncoder().encode(JSON.stringify(value)).length

describe('storage usage', () => {
  it('groups stored values by what they hold and adds snapshot bytes', () => {
    const tree = [{ uid: 'w1', title: 'Research' }]
    const favicons = JSON.stringify({ 'https://example.org/': 'data:...' })
    const settings = { automaticSessionSnapshots: true }
    const onboarding = { status: 'completed' }
    const windowConfig = { width: 300, height: 700 }

    const usage = storageUsageFromItems(
      {
        [STORAGE_KEY]: tree,
        [FAVICON_CACHE_STORAGE_KEY]: favicons,
        settings,
        privateWindowOnboarding: onboarding,
        sessionTreeWindowConfig: windowConfig,
      },
      4_096,
    )

    expect(usage.categories).toEqual({
      tree: bytes(STORAGE_KEY, tree),
      snapshots: 4_096,
      favicons: bytes(FAVICON_CACHE_STORAGE_KEY, favicons),
      settings: bytes('settings', settings),
      other:
        bytes('privateWindowOnboarding', onboarding) +
        bytes('sessionTreeWindowConfig', windowConfig),
    })
    expect(usage.total).toBe(
      Object.values(usage.categories).reduce((sum, value) => sum + value, 0),
    )
  })

  it('counts multi-byte characters by their encoded size', () => {
    const usage = storageUsageFromItems({ settings: 'é' }, 0)

    expect(usage.categories.settings).toBe('settings'.length + '"é"'.length + 1)
  })

  it('reports zero for empty storage', () => {
    expect(storageUsageFromItems({}, 0)).toEqual({
      categories: { tree: 0, snapshots: 0, favicons: 0, settings: 0, other: 0 },
      total: 0,
    })
  })
})
