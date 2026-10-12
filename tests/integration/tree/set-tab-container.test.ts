import { beforeEach, afterEach, describe, expect, it, vi } from 'vitest'
import { Tree } from '@/services/background-tree'
import { OnCreatedQueue } from '@/services/background-on-created-queue'
import { isCommandOwnedTabRemoval } from '@/services/background-command-removal'
import { State } from '@/types/session-tree'
import { installFakeBrowser } from '../../helpers/fake-browser'
import { createTab, createWindow, resetTree } from '../../helpers/tree-fixtures'
import { expectTreeInvariants } from '../../helpers/tree-invariants'

const work = {
  cookieStoreId: 'firefox-container-1',
  name: 'Work',
  color: 'blue',
  colorCode: '#37adff',
  icon: 'briefcase',
  iconUrl: 'resource://briefcase.svg',
}

describe('set and clear tab container', () => {
  const browser = installFakeBrowser()

  beforeEach(() => {
    resetTree()
    vi.clearAllMocks()
    browser.contextualIdentities.query.mockResolvedValue([work])
    browser.tabs.remove.mockResolvedValue(undefined)
  })
  afterEach(() => vi.restoreAllMocks())

  function liveFixture(state = State.OPEN) {
    const parent = createTab('parent' as UID, {
      id: 10,
      state,
      collapsed: true,
      isParent: true,
      customLabel: 'Keep label',
    })
    const child = createTab('child' as UID, { parentUid: parent.uid })
    const window = createWindow('window' as UID, [parent, child], {
      id: 20,
      state: State.OPEN,
    })
    Tree.recomputeSessionTree()
    const original = {
      id: 10,
      windowId: 20,
      index: 0,
      active: false,
      pinned: false,
      highlighted: false,
      incognito: false,
      discarded: state === State.DISCARDED,
      url: parent.url,
      cookieStoreId: 'firefox-default',
    }
    browser.tabs.get.mockResolvedValue(original)
    const replacement = {
      ...original,
      id: 30,
      cookieStoreId: work.cookieStoreId,
    }
    const create = vi
      .spyOn(OnCreatedQueue, 'createTabAndWait')
      .mockResolvedValue(replacement)
    return { parent, child, window, original, replacement, create }
  }

  it('sets and clears saved tabs without opening them, including unavailable old containers', async () => {
    const tab = createTab('saved' as UID, { id: -1 })
    createWindow('window' as UID, [tab], { id: -1 })
    await Tree.setTabContainer({
      tabUid: tab.uid,
      cookieStoreId: work.cookieStoreId,
    })
    expect(tab.container).toEqual(work)
    expect(tab.container).not.toBe(work)
    browser.contextualIdentities.query.mockRejectedValue(new Error('disabled'))
    await Tree.setTabContainer({ tabUid: tab.uid })
    expect(tab.container).toBeUndefined()
    expect(tab.state).toBe(State.SAVED)
    expect(browser.tabs.create).not.toHaveBeenCalled()
    expect(browser.tabs.remove).not.toHaveBeenCalled()
    expectTreeInvariants()
  })

  it('replaces a live tab while retaining its tree identity, label, hierarchy, and children', async () => {
    const { parent, child, window, create } = liveFixture()
    browser.tabs.remove.mockImplementation(async (id: number) => {
      expect(isCommandOwnedTabRemoval(id)).toBe(true)
      expect(parent.id).toBe(10)
    })
    await Tree.setTabContainer({
      tabUid: parent.uid,
      cookieStoreId: work.cookieStoreId,
    })
    expect(create).toHaveBeenCalledWith(
      expect.objectContaining({
        windowId: 20,
        index: 0,
        cookieStoreId: work.cookieStoreId,
        active: false,
      }),
    )
    expect(browser.tabs.remove).toHaveBeenCalledWith(10)
    expect(parent).toMatchObject({
      id: 30,
      container: work,
      customLabel: 'Keep label',
      collapsed: true,
    })
    expect(Tree.tabsByUid.get(parent.uid)).toBe(parent)
    expect(window.children).toEqual([parent, child])
    expect(child.parentUid).toBe(parent.uid)
    expectTreeInvariants()
  })

  it('clears a live container into the default Firefox cookie store', async () => {
    const { parent, original, create } = liveFixture()
    parent.container = work
    browser.tabs.get.mockResolvedValue({
      ...original,
      cookieStoreId: work.cookieStoreId,
    })
    await Tree.setTabContainer({ tabUid: parent.uid })
    expect(create).toHaveBeenCalledWith(
      expect.objectContaining({ cookieStoreId: 'firefox-default' }),
    )
    expect(parent.container).toBeUndefined()
    expectTreeInvariants()
  })

  it('retains unloaded tabs without loading their content', async () => {
    const { parent, create } = liveFixture(State.DISCARDED)
    await Tree.setTabContainer({
      tabUid: parent.uid,
      cookieStoreId: work.cookieStoreId,
    })
    expect(create).toHaveBeenCalledWith(
      expect.objectContaining({ discarded: true, title: parent.title }),
    )
    expect(parent.state).toBe(State.DISCARDED)
    expectTreeInvariants()
  })

  it('retains pinning, muting, and the active tab', async () => {
    const { parent, window, original, create } = liveFixture()
    parent.pinned = true
    browser.tabs.get.mockResolvedValue({
      ...original,
      active: true,
      pinned: true,
      mutedInfo: { muted: true },
    })
    await Tree.setTabContainer({
      tabUid: parent.uid,
      cookieStoreId: work.cookieStoreId,
    })
    expect(create).toHaveBeenCalledWith(
      expect.objectContaining({ pinned: true, muted: true }),
    )
    expect(browser.tabs.update).toHaveBeenCalledWith(30, { active: true })
    expect(window.activeTabId).toBe(30)
    expect(parent.active).toBe(true)
    expectTreeInvariants()
  })

  it('joins the existing Firefox tab group before removing the old tab', async () => {
    const { parent, original, replacement } = liveFixture()
    Tree.updateTab(
      { tabUid: parent.uid },
      {
        tabGroup: {
          uid: 'group' as UID,
          id: 42,
          title: 'Keep group',
          color: 'blue',
          collapsed: false,
        },
      },
    )
    browser.tabGroups.get.mockResolvedValue({
      id: 42,
      title: 'Keep group',
      color: 'blue',
      collapsed: false,
      windowId: 20,
    })
    browser.tabs.query.mockResolvedValue([{ ...replacement, groupId: 42 }])
    // A group event may temporarily treat the original as saved while the
    // replacement's Firefox id has not yet been associated with its tree uid.
    browser.tabs.remove.mockImplementation(async () => {
      Tree.updateTab(
        { tabUid: parent.uid },
        { tabGroup: { ...parent.tabGroup!, id: -1 } },
      )
    })
    browser.tabs.get.mockResolvedValue({ ...original, groupId: 42 })
    browser.tabs.group.mockImplementation(async () => {
      expect(browser.tabs.remove).not.toHaveBeenCalled()
      return 42
    })
    await Tree.setTabContainer({
      tabUid: parent.uid,
      cookieStoreId: work.cookieStoreId,
    })
    expect(browser.tabs.group).toHaveBeenCalledWith({
      groupId: 42,
      tabIds: [30],
    })
    expect(browser.tabs.move).toHaveBeenCalledWith(30, { index: 0 })
    expect(parent.tabGroup).toMatchObject({
      uid: 'group',
      id: 42,
      title: 'Keep group',
    })
    expectTreeInvariants()
  })

  it.each(['get', 'query'] as const)(
    'keeps the replacement active when the post-replacement group %s fails',
    async (failedApi) => {
      const { parent, window, original, replacement } = liveFixture()
      Tree.updateTab(
        { tabUid: parent.uid },
        {
          active: true,
          tabGroup: {
            uid: 'group' as UID,
            id: 42,
            title: 'Keep group',
            color: 'blue',
            collapsed: false,
          },
        },
      )
      window.activeTabId = original.id
      browser.tabs.get.mockResolvedValue({
        ...original,
        active: true,
        groupId: 42,
      })
      browser.tabGroups.get.mockResolvedValue({
        id: 42,
        title: 'Keep group',
        color: 'blue',
        collapsed: false,
        windowId: 20,
      })
      browser.tabs.query.mockResolvedValue([{ ...replacement, groupId: 42 }])
      const error = new Error('group refresh failed')
      if (failedApi === 'get')
        browser.tabGroups.get.mockRejectedValueOnce(error)
      else browser.tabs.query.mockRejectedValueOnce(error)
      vi.spyOn(console, 'warn').mockImplementation(() => undefined)

      await expect(
        Tree.setTabContainer({
          tabUid: parent.uid,
          cookieStoreId: work.cookieStoreId,
        }),
      ).resolves.toBeUndefined()

      expect(browser.tabs.remove).toHaveBeenCalledExactlyOnceWith(original.id)
      expect(parent).toMatchObject({
        id: replacement.id,
        container: work,
        active: true,
      })
      expect(parent.tabGroup).toMatchObject({ id: 42, uid: 'group' })
      expect(window.activeTabId).toBe(replacement.id)
      expect(browser.tabs.update).toHaveBeenCalledExactlyOnceWith(
        replacement.id,
        { active: true },
      )
      expectTreeInvariants()
    },
  )

  it('does not recreate tabs already in the target container', async () => {
    const { parent, original, create } = liveFixture()
    browser.tabs.get.mockResolvedValue({
      ...original,
      cookieStoreId: work.cookieStoreId,
    })
    await Tree.setTabContainer({
      tabUid: parent.uid,
      cookieStoreId: work.cookieStoreId,
    })
    expect(create).not.toHaveBeenCalled()
    expect(parent.id).toBe(10)
    expect(parent.container).toEqual(work)
    expectTreeInvariants()
  })

  it('leaves the original intact when creation fails', async () => {
    const { parent, create } = liveFixture()
    create.mockRejectedValue(new Error('cannot create'))
    await expect(
      Tree.setTabContainer({
        tabUid: parent.uid,
        cookieStoreId: work.cookieStoreId,
      }),
    ).rejects.toThrow('cannot create')
    expect(parent.id).toBe(10)
    expect(parent.container).toBeUndefined()
    expect(browser.tabs.remove).not.toHaveBeenCalled()
    expectTreeInvariants()
  })

  it('cleans up the replacement and preserves metadata when removing the original fails', async () => {
    const { parent } = liveFixture()
    browser.tabs.remove.mockRejectedValueOnce(new Error('cannot remove'))
    await expect(
      Tree.setTabContainer({
        tabUid: parent.uid,
        cookieStoreId: work.cookieStoreId,
      }),
    ).rejects.toThrow('cannot remove')
    expect(browser.tabs.remove.mock.calls.map(([id]) => id)).toEqual([10, 30])
    expect(parent.id).toBe(10)
    expect(parent.container).toBeUndefined()
    expectTreeInvariants()
  })

  it('cleans up the replacement when grouping fails', async () => {
    const { parent, original } = liveFixture()
    browser.tabs.get.mockResolvedValue({ ...original, groupId: 42 })
    browser.tabs.group.mockRejectedValueOnce(new Error('cannot group'))
    await expect(
      Tree.setTabContainer({
        tabUid: parent.uid,
        cookieStoreId: work.cookieStoreId,
      }),
    ).rejects.toThrow('cannot group')
    expect(browser.tabs.remove).toHaveBeenCalledExactlyOnceWith(30)
    expect(parent.id).toBe(10)
    expectTreeInvariants()
  })

  it('rejects stale container choices without changing the tab', async () => {
    const { parent, create } = liveFixture()
    browser.contextualIdentities.query.mockResolvedValue([])
    await expect(
      Tree.setTabContainer({
        tabUid: parent.uid,
        cookieStoreId: work.cookieStoreId,
      }),
    ).rejects.toThrow('No available Firefox containers')
    expect(create).not.toHaveBeenCalled()
    expect(parent.container).toBeUndefined()
    expectTreeInvariants()
  })

  it('rejects container assignment to private windows', async () => {
    const { parent, window, create } = liveFixture()
    window.incognito = true
    await expect(
      Tree.setTabContainer({
        tabUid: parent.uid,
        cookieStoreId: work.cookieStoreId,
      }),
    ).rejects.toThrow('private windows')
    expect(create).not.toHaveBeenCalled()
    expect(browser.contextualIdentities.query).not.toHaveBeenCalled()
    expectTreeInvariants()
  })
})
