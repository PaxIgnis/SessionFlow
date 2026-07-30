import { beforeEach, describe, expect, it, vi } from 'vitest'
import { DEFAULT_SETTINGS } from '@/defaults/settings'
import { Tree } from '@/services/background-tree'
import { Favicons } from '@/services/favicons'
import { Settings } from '@/services/settings'
import { installFakeBrowser } from '../../helpers/fake-browser'
import { createTab, createWindow, resetTree } from '../../helpers/tree-fixtures'

describe('private favicon cleanup after tree mutations', () => {
  beforeEach(() => {
    vi.restoreAllMocks()
    installFakeBrowser()
    resetTree()
    Object.assign(Settings.values, structuredClone(DEFAULT_SETTINGS))
    vi.spyOn(Favicons, 'init').mockResolvedValue(undefined)
    vi.spyOn(Favicons, 'removeDomainIfUnreferenced').mockReturnValue(true)
    vi.spyOn(Favicons, 'saveCacheToStorage').mockResolvedValue(undefined)
  })

  it('removes the old private domain after navigation while retaining current references', async () => {
    const tab = createTab('private-tab' as UID, {
      url: 'https://old-private.test/page',
    })
    const shared = createTab('shared-tab' as UID, {
      url: 'https://shared.test/page',
    })
    createWindow('private-window' as UID, [tab], { incognito: true })
    createWindow('normal-window' as UID, [shared], { incognito: false })

    Tree.updateTab(
      { tabUid: tab.uid },
      { url: 'https://new-private.test/page' },
    )

    await vi.waitFor(() => {
      expect(Favicons.removeDomainIfUnreferenced).toHaveBeenCalledWith(
        'https://old-private.test/page',
        expect.arrayContaining([
          { url: 'https://new-private.test/page', incognito: true },
          { url: 'https://shared.test/page', incognito: false },
        ]),
      )
    })
    expect(Favicons.saveCacheToStorage).toHaveBeenCalledOnce()
    expect(browser.runtime.sendMessage).toHaveBeenCalledWith({
      type: 'FAVICON_CACHE_UPDATED',
    })
  })

  it('cleans the final private tab domain after removal', async () => {
    const tab = createTab('private-tab' as UID, {
      url: 'https://private-only.test/page',
    })
    createWindow('private-window' as UID, [tab], { incognito: true })

    Tree.removeTab(tab.uid)

    await vi.waitFor(() => {
      expect(Favicons.removeDomainIfUnreferenced).toHaveBeenCalledWith(
        'https://private-only.test/page',
        [],
      )
    })
  })

  it('cleans each affected domain after removing a private window', async () => {
    const first = createTab('first-private' as UID, {
      url: 'https://first-private.test/page',
    })
    const second = createTab('second-private' as UID, {
      url: 'https://second-private.test/page',
    })
    const window = createWindow('private-window' as UID, [first, second], {
      incognito: true,
    })

    Tree.removeWindow(window.uid)

    await vi.waitFor(() => {
      expect(Favicons.removeDomainIfUnreferenced).toHaveBeenCalledTimes(2)
    })
    expect(Favicons.removeDomainIfUnreferenced).toHaveBeenCalledWith(
      first.url,
      [],
    )
    expect(Favicons.removeDomainIfUnreferenced).toHaveBeenCalledWith(
      second.url,
      [],
    )
  })

  it('does not immediately prune normal-only navigation or removal', async () => {
    const tab = createTab('normal-tab' as UID, {
      url: 'https://normal.test/old',
    })
    createWindow('normal-window' as UID, [tab], { incognito: false })

    Tree.updateTab({ tabUid: tab.uid }, { url: 'https://normal.test/new' })
    Tree.removeTab(tab.uid)
    await Promise.resolve()

    expect(Favicons.removeDomainIfUnreferenced).not.toHaveBeenCalled()
  })
})
