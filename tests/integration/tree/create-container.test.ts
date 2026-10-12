import { beforeEach, describe, expect, it, vi } from 'vitest'
import { Tree } from '@/services/background-tree'
import { installFakeBrowser } from '../../helpers/fake-browser'
import { createTab, createWindow, resetTree } from '../../helpers/tree-fixtures'
import { expectTreeInvariants } from '../../helpers/tree-invariants'

describe('create Firefox container', () => {
  const browser = installFakeBrowser()
  beforeEach(() => {
    vi.clearAllMocks()
    resetTree()
  })

  it('creates and caches an identity without reopening or assigning existing tabs', async () => {
    const tab = createTab('saved' as UID)
    createWindow('window' as UID, [tab])
    const identity = {
      cookieStoreId: 'firefox-container-created',
      name: 'Research',
      color: 'orange',
      colorCode: '#ff9f00',
      icon: 'fruit',
      iconUrl: 'resource://fruit.svg',
    }
    browser.contextualIdentities.create.mockResolvedValueOnce(identity)
    const result = await Tree.createContainer({
      name: ' Research ',
      color: 'orange',
      icon: 'fruit',
    })
    expect(browser.contextualIdentities.create).toHaveBeenCalledWith({
      name: 'Research',
      color: 'orange',
      icon: 'fruit',
    })
    expect(Tree.containerForCookieStore(identity.cookieStoreId)).toEqual(
      identity,
    )
    expect(result).toEqual({ createdContainerStoreId: identity.cookieStoreId })
    expect(tab.container).toBeUndefined()
    expect(browser.tabs.create).not.toHaveBeenCalled()
    expect(browser.tabs.remove).not.toHaveBeenCalled()
    expectTreeInvariants()
  })

  it('rejects blank names before calling Firefox', async () => {
    await expect(
      Tree.createContainer({ name: '  ', color: 'blue', icon: 'circle' }),
    ).rejects.toThrow('Enter a container name')
    expect(browser.contextualIdentities.create).not.toHaveBeenCalled()
  })

  it('propagates Firefox errors so the modal can retain the form and retry', async () => {
    browser.contextualIdentities.create.mockRejectedValueOnce(
      new Error('Containers disabled'),
    )
    await expect(
      Tree.createContainer({ name: 'New', color: 'blue', icon: 'circle' }),
    ).rejects.toThrow('Containers disabled')
    expectTreeInvariants()
  })
})
