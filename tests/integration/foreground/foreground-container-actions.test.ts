import { missingContainers } from '@/services/foreground-container-actions'
import { installFakeBrowser } from '../../helpers/fake-browser'
import { makeForegroundTab } from '../../helpers/foreground-tree-fixtures'
import { reactive } from 'vue'
import { describe, expect, it, vi } from 'vitest'

describe('foreground container preflight', () => {
  it('returns distinct saved containers absent from Firefox', async () => {
    const fakeBrowser = installFakeBrowser()
    vi.mocked(fakeBrowser.contextualIdentities.query).mockResolvedValue([])
    const container = {
      cookieStoreId: 'firefox-container-1',
      name: 'Work',
      color: 'blue',
      colorCode: '#37adff',
      icon: 'briefcase',
    }
    const tabs = [
      makeForegroundTab('tab-1' as UID, { container }),
      makeForegroundTab('tab-2' as UID, { container }),
    ]

    await expect(missingContainers(tabs)).resolves.toEqual([container])
  })

  it('returns plain snapshots when foreground tabs are reactive proxies', async () => {
    const fakeBrowser = installFakeBrowser()
    vi.mocked(fakeBrowser.contextualIdentities.query).mockResolvedValue([])
    const container = {
      cookieStoreId: 'firefox-container-1',
      name: 'Work',
      color: 'blue',
      colorCode: '#37adff',
      icon: 'briefcase',
      iconUrl: 'resource://usercontext-content/briefcase.svg',
    }
    const tab = reactive(
      makeForegroundTab('tab-reactive' as UID, { container }),
    )

    await expect(missingContainers([tab])).resolves.toEqual([container])
  })
})
