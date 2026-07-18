import { Tree } from '@/services/background-tree'
import { State, type ContainerMetadata } from '@/types/session-tree'
import { installFakeBrowser } from '../../helpers/fake-browser'
import { createTab, createWindow, resetTree } from '../../helpers/tree-fixtures'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const identity = {
  cookieStoreId: 'firefox-container-1',
  name: 'Work',
  color: 'blue',
  colorCode: '#37adff',
  icon: 'briefcase',
  iconUrl: 'resource://usercontext-content/briefcase.svg',
}

describe('Firefox container actions', () => {
  const fakeBrowser = installFakeBrowser()

  beforeEach(() => {
    resetTree()
    vi.clearAllMocks()
    vi.mocked(fakeBrowser.contextualIdentities.query).mockResolvedValue([
      identity,
    ])
  })

  it('loads and clones live contextual identity metadata', async () => {
    await Tree.initializeContainers()

    const metadata = Tree.containerForCookieStore(identity.cookieStoreId)
    expect(metadata).toEqual(identity satisfies ContainerMetadata)
    expect(metadata).not.toBe(identity)
    expect(Tree.containerForCookieStore('firefox-default')).toBeUndefined()
  })

  it('continues safely when Firefox containers are disabled', async () => {
    vi.mocked(fakeBrowser.contextualIdentities.query).mockRejectedValue(
      new Error('Contextual identities are disabled'),
    )

    await expect(Tree.initializeContainers()).resolves.toBeUndefined()
    expect(Tree.containerForCookieStore(identity.cookieStoreId)).toBeUndefined()
  })

  it('does not query Firefox when restored tabs have no container snapshots', async () => {
    vi.mocked(fakeBrowser.contextualIdentities.query).mockRejectedValue(
      new Error('Contextual identities are disabled'),
    )
    const tab = createTab('tab-default' as UID, { container: undefined })
    createWindow('window-1' as UID, [tab])

    await expect(Tree.resolveContainerRecovery([tab])).resolves.toEqual({
      rollback: expect.any(Function),
    })
    expect(fakeBrowser.contextualIdentities.query).not.toHaveBeenCalled()
  })

  it('opens without explicitly consented snapshots when Firefox identities are unavailable', async () => {
    vi.mocked(fakeBrowser.contextualIdentities.query).mockRejectedValue(
      new Error('Contextual identities are unavailable'),
    )
    const tab = createTab('tab-work' as UID, { container: identity })
    createWindow('window-1' as UID, [tab])

    await expect(
      Tree.resolveContainerRecovery([tab], 'without-container', [
        identity.cookieStoreId,
      ]),
    ).resolves.toEqual({ rollback: expect.any(Function) })
    expect(tab.container).toBeUndefined()
  })

  it('updates matching tabs and retains snapshots after removal', async () => {
    await Tree.initializeContainers()
    const tab = createTab('tab-1' as UID, {
      container: Tree.containerForCookieStore(identity.cookieStoreId),
    })
    createWindow('window-1' as UID, [tab])

    Tree.containerUpdated({
      contextualIdentity: { ...identity, name: 'Renamed Work' },
    })
    expect(tab.container?.name).toBe('Renamed Work')

    Tree.containerRemoved({ contextualIdentity: identity })
    expect(tab.container?.name).toBe('Renamed Work')
    expect(Tree.containerForCookieStore(identity.cookieStoreId)).toBeUndefined()
  })

  it('captures container metadata while synchronizing Firefox window tabs', async () => {
    await Tree.initializeContainers()
    const window = createWindow('window-1' as UID, [], {
      id: 20,
      state: State.OPEN,
    })
    vi.mocked(fakeBrowser.windows.get).mockResolvedValue({
      id: 20,
      incognito: false,
      focused: true,
      tabs: [
        {
          id: 21,
          windowId: 20,
          index: 0,
          active: true,
          discarded: false,
          pinned: false,
          title: 'Work tab',
          url: 'https://example.test/work',
          cookieStoreId: identity.cookieStoreId,
        },
      ],
    } as browser.windows.Window)

    await Tree.updateWindowTabs(window.id)

    expect(Tree.getTabs(window.children)[0].container).toEqual(identity)
  })

  it('preserves an existing snapshot when addTab reconstructs a tree tab', () => {
    const window = createWindow('window-1' as UID)

    const tabUid = Tree.addTab(
      false,
      window.uid,
      -1,
      false,
      State.SAVED,
      'Saved Work tab',
      'https://example.test/work',
      false,
      undefined,
      undefined,
      'tab-1' as UID,
      true,
      undefined,
      identity,
    )

    expect(Tree.tabsByUid.get(tabUid!)?.container).toEqual(identity)
    expect(Tree.tabsByUid.get(tabUid!)?.container).not.toBe(identity)
  })

  it('blocks restoration when a saved container no longer exists', async () => {
    vi.mocked(fakeBrowser.contextualIdentities.query).mockResolvedValue([])
    await Tree.initializeContainers()
    const tab = createTab('tab-1' as UID, { container: identity })
    createWindow('window-1' as UID, [tab])

    await expect(Tree.resolveContainerRecovery([tab])).rejects.toThrow(
      'Firefox container "Work" no longer exists',
    )
    expect(tab.container).toEqual(identity)
  })

  it('revalidates live identities with Firefox before every recovery decision', async () => {
    await Tree.initializeContainers()
    const tab = createTab('tab-1' as UID, { container: identity })
    createWindow('window-1' as UID, [tab])
    vi.mocked(fakeBrowser.contextualIdentities.query).mockResolvedValue([])

    await expect(Tree.resolveContainerRecovery([tab])).rejects.toThrow(
      'Firefox container "Work" no longer exists',
    )
  })

  it('rejects recovery when the missing container set changed after consent', async () => {
    const personal = {
      ...identity,
      cookieStoreId: 'firefox-container-2',
      name: 'Personal',
    }
    vi.mocked(fakeBrowser.contextualIdentities.query).mockResolvedValue([])
    await Tree.initializeContainers()
    const workTab = createTab('tab-work' as UID, { container: identity })
    const personalTab = createTab('tab-personal' as UID, {
      container: personal,
    })
    createWindow('window-1' as UID, [workTab, personalTab])

    const resolveWithConsent = Tree.resolveContainerRecovery as unknown as (
      tabs: (typeof workTab)[],
      strategy: 'without-container',
      consentedStoreIds: string[],
    ) => Promise<void>
    await expect(
      resolveWithConsent([workTab, personalTab], 'without-container', [
        identity.cookieStoreId,
      ]),
    ).rejects.toThrow('Missing Firefox containers changed')
    expect(workTab.container).toEqual(identity)
    expect(personalTab.container).toEqual(personal)
  })

  it('opens without a missing container only for the requested tabs', async () => {
    vi.mocked(fakeBrowser.contextualIdentities.query).mockResolvedValue([])
    await Tree.initializeContainers()
    const requested = createTab('tab-1' as UID, { container: identity })
    const untouched = createTab('tab-2' as UID, { container: identity })
    createWindow('window-1' as UID, [requested, untouched])

    await Tree.resolveContainerRecovery([requested], 'without-container', [
      identity.cookieStoreId,
    ])

    expect(requested.container).toBeUndefined()
    expect(untouched.container).toEqual(identity)
  })

  it('recreates a missing container once and remaps every matching tab', async () => {
    vi.mocked(fakeBrowser.contextualIdentities.query).mockResolvedValue([])
    vi.mocked(fakeBrowser.contextualIdentities.create).mockResolvedValue({
      ...identity,
      cookieStoreId: 'firefox-container-new',
    })
    await Tree.initializeContainers()
    const first = createTab('tab-1' as UID, { container: identity })
    const second = createTab('tab-2' as UID, { container: identity })
    createWindow('window-1' as UID, [first, second])

    await Tree.resolveContainerRecovery([first], 'recreate', [
      identity.cookieStoreId,
    ])

    expect(fakeBrowser.contextualIdentities.create).toHaveBeenCalledOnce()
    expect(fakeBrowser.contextualIdentities.create).toHaveBeenCalledWith({
      name: 'Work',
      color: 'blue',
      icon: 'briefcase',
    })
    expect(first.container?.cookieStoreId).toBe('firefox-container-new')
    expect(second.container?.cookieStoreId).toBe('firefox-container-new')
    expect(Tree.containerForCookieStore('firefox-container-new')).toEqual({
      ...identity,
      cookieStoreId: 'firefox-container-new',
    })
  })
})
