import { beforeEach, describe, expect, it, vi } from 'vitest'
import { DEFAULT_SETTINGS } from '@/defaults/settings'
import { Settings } from '@/services/settings'
import { Tree } from '@/services/background-tree'
import { State } from '@/types/session-tree'
import { installFakeBrowser } from '../../helpers/fake-browser'
import {
  liveTab,
  liveWindow,
  mockStoredTree,
  storedTab,
  storedWindow,
} from '../../helpers/startup-fixtures'
import { resetTree } from '../../helpers/tree-fixtures'
import { expectTreeInvariants } from '../../helpers/tree-invariants'

describe('startup reconciliation', () => {
  beforeEach(() => {
    vi.restoreAllMocks()
    installFakeBrowser()
    resetTree()
    Object.assign(Settings.values, structuredClone(DEFAULT_SETTINGS), {
      matchOpenedWindowsWithSavedWindowsOnStartup: true,
      restorePreviousSessionOnStartup: false,
    })
  })

  it('ST-02 reuses a matching stored window and stable tab UID', async () => {
    mockStoredTree([
      storedWindow('window-stored', [
        storedTab('tab-stored', {
          title: 'Matching tab',
          url: 'https://example.test/matching',
        }),
      ]),
    ])
    vi.mocked(browser.windows.getAll).mockResolvedValue([
      liveWindow(20, [
        liveTab(21, 20, 0, {
          title: 'Matching tab',
          url: 'https://example.test/matching',
        }),
      ]),
    ])
    const openTab = vi.spyOn(Tree, 'openTab').mockResolvedValue(undefined)

    await Tree.initializeWindows()

    expect(Tree.Items.filter(Tree.isWindow).map((item) => item.uid)).toEqual([
      'window-stored',
    ])
    expect(Tree.tabsByUid.get('tab-stored' as UID)).toMatchObject({
      id: 21,
      state: State.OPEN,
      windowUid: 'window-stored',
    })
    expect(openTab).not.toHaveBeenCalled()
    expectTreeInvariants()
  })

  it('ST-03 assigns two live windows to two different best stored matches', async () => {
    mockStoredTree([
      storedWindow('window-alpha', [
        storedTab('tab-alpha', {
          title: 'Alpha',
          url: 'https://example.test/alpha',
        }),
      ]),
      storedWindow('window-beta', [
        storedTab('tab-beta', {
          title: 'Beta',
          url: 'https://example.test/beta',
        }),
      ]),
    ])
    vi.mocked(browser.windows.getAll).mockResolvedValue([
      liveWindow(30, [
        liveTab(31, 30, 0, {
          title: 'Beta',
          url: 'https://example.test/beta',
        }),
      ]),
      liveWindow(40, [
        liveTab(41, 40, 0, {
          title: 'Alpha',
          url: 'https://example.test/alpha',
        }),
      ]),
    ])

    await Tree.initializeWindows()

    expect(Tree.windowsByUid.get('window-alpha' as UID)?.id).toBe(40)
    expect(Tree.windowsByUid.get('window-beta' as UID)?.id).toBe(30)
    expect(Tree.tabsByUid.get('tab-alpha' as UID)?.id).toBe(41)
    expect(Tree.tabsByUid.get('tab-beta' as UID)?.id).toBe(31)
    expect(Tree.Items.filter(Tree.isWindow)).toHaveLength(2)
    expectTreeInvariants()
  })

  it('ST-04 reconciles duplicate URLs and titles without reusing a live tab', async () => {
    const duplicate = {
      title: 'Duplicate',
      url: 'https://example.test/duplicate',
    }
    mockStoredTree([
      storedWindow('window-duplicates', [
        storedTab('tab-duplicate-a', duplicate),
        storedTab('tab-duplicate-b', duplicate),
      ]),
    ])
    vi.mocked(browser.windows.getAll).mockResolvedValue([
      liveWindow(50, [
        liveTab(51, 50, 0, duplicate),
        liveTab(52, 50, 1, duplicate),
      ]),
    ])

    await Tree.initializeWindows()

    const reconciledIds = ['tab-duplicate-a', 'tab-duplicate-b'].map(
      (uid) => Tree.tabsByUid.get(uid as UID)?.id,
    )
    expect(new Set(reconciledIds)).toEqual(new Set([51, 52]))
    expect(Tree.Items.filter(Tree.isWindow)).toHaveLength(1)
    expectTreeInvariants()
  })

  it('ST-05 reconciles reordered live tabs by identity rather than array position', async () => {
    mockStoredTree([
      storedWindow('window-reordered', [
        storedTab('tab-first', {
          title: 'First',
          url: 'https://example.test/first',
        }),
        storedTab('tab-second', {
          title: 'Second',
          url: 'https://example.test/second',
        }),
      ]),
    ])
    vi.mocked(browser.windows.getAll).mockResolvedValue([
      liveWindow(60, [
        liveTab(61, 60, 0, {
          title: 'Second',
          url: 'https://example.test/second',
        }),
        liveTab(62, 60, 1, {
          title: 'First',
          url: 'https://example.test/first',
        }),
      ]),
    ])

    await Tree.initializeWindows()

    expect(Tree.Items.filter(Tree.isWindow)).toHaveLength(1)
    expect(Tree.windowsByUid.get('window-reordered' as UID)?.id).toBe(60)
    expect(Tree.tabsByUid.get('tab-first' as UID)?.id).toBe(62)
    expect(Tree.tabsByUid.get('tab-second' as UID)?.id).toBe(61)
    expectTreeInvariants()
  })

  it('ST-06 keeps unmatched stored tabs saved and appends unmatched live tabs', async () => {
    mockStoredTree([
      storedWindow('window-partial', [
        storedTab('tab-matched', {
          title: 'Matched',
          url: 'https://example.test/matched',
        }),
        storedTab('tab-missing', {
          title: 'Missing',
          url: 'https://example.test/missing',
        }),
      ]),
    ])
    vi.mocked(browser.windows.getAll).mockResolvedValue([
      liveWindow(70, [
        liveTab(71, 70, 0, {
          title: 'Matched',
          url: 'https://example.test/matched',
        }),
        liveTab(72, 70, 1, {
          title: 'New live tab',
          url: 'https://example.test/new-live',
        }),
      ]),
    ])

    await Tree.initializeWindows()

    expect(Tree.tabsByUid.get('tab-matched' as UID)).toMatchObject({
      id: 71,
      state: State.OPEN,
    })
    expect(Tree.tabsByUid.get('tab-missing' as UID)).toMatchObject({
      id: 0,
      state: State.SAVED,
    })
    const appended = [...Tree.tabsByUid.values()].find((tab) => tab.id === 72)
    expect(appended).toMatchObject({
      title: 'New live tab',
      state: State.OPEN,
      windowUid: 'window-partial',
    })
    expect(appended?.uid).not.toBe('tab-matched')
    expect(appended?.uid).not.toBe('tab-missing')
    expectTreeInvariants()
  })

  it('ST-07 adds a new live window without mutating unmatched stored windows', async () => {
    mockStoredTree([
      storedWindow('window-old', [
        storedTab('tab-old', {
          title: 'Old',
          url: 'https://example.test/old',
        }),
      ]),
    ])
    vi.mocked(browser.windows.getAll).mockResolvedValue([
      liveWindow(80, [
        liveTab(81, 80, 0, {
          title: 'New',
          url: 'https://example.test/new',
        }),
      ]),
    ])

    await Tree.initializeWindows()

    expect(Tree.windowsByUid.get('window-old' as UID)).toMatchObject({
      id: 0,
      state: State.SAVED,
    })
    expect(Tree.tabsByUid.get('tab-old' as UID)).toMatchObject({
      id: 0,
      state: State.SAVED,
    })
    const live = Tree.Items.filter(Tree.isWindow).find(
      (window) => window.id === 80,
    )
    expect(live?.uid).not.toBe('window-old')
    expect(Tree.getTabs(live?.children ?? [])[0]).toMatchObject({
      id: 81,
      state: State.OPEN,
    })
    expectTreeInvariants()
  })

  it('ST-08 converts a previously open unrestored window and its tabs to saved state', async () => {
    mockStoredTree([
      storedWindow(
        'window-unrestored',
        [
          storedTab('tab-open', { active: true, id: 11 }),
          storedTab('tab-discarded', {
            id: 12,
            state: State.DISCARDED,
          }),
        ],
        { active: true, activeTabId: 11 },
      ),
    ])
    vi.mocked(browser.windows.getAll).mockResolvedValue([])

    await Tree.initializeWindows()

    expect(Tree.windowsByUid.get('window-unrestored' as UID)).toMatchObject({
      id: 0,
      state: State.SAVED,
      active: false,
      activeTabId: undefined,
    })
    expect(
      ['tab-open', 'tab-discarded'].map((uid) =>
        Tree.tabsByUid.get(uid as UID),
      ),
    ).toEqual([
      expect.objectContaining({ id: 0, state: State.SAVED, active: false }),
      expect.objectContaining({ id: 0, state: State.SAVED, active: false }),
    ])
    expectTreeInvariants()
  })

  it('ST-10 leaves missing startup tabs saved when restoration is disabled', async () => {
    Settings.values.restorePreviousSessionOnStartup = false
    mockStoredTree([
      storedWindow('window-disabled', [storedTab('tab-disabled')]),
    ])
    vi.mocked(browser.windows.getAll).mockResolvedValue([])
    const openTab = vi.spyOn(Tree, 'openTab').mockResolvedValue(undefined)

    await Tree.initializeWindows()

    expect(openTab).not.toHaveBeenCalled()
    expect(Tree.windowsByUid.get('window-disabled' as UID)?.state).toBe(
      State.SAVED,
    )
    expect(Tree.tabsByUid.get('tab-disabled' as UID)).toMatchObject({
      id: 0,
      state: State.SAVED,
    })
    expectTreeInvariants()
  })

  it('ST-09 restores each previously open unmatched tab once in saved tree order', async () => {
    Settings.values.restorePreviousSessionOnStartup = true
    mockStoredTree([
      storedWindow('window-restored', [
        storedTab('tab-parent'),
        storedTab('tab-child', {
          parentUid: 'tab-parent' as UID,
          indentLevel: 2,
        }),
      ]),
    ])
    vi.mocked(browser.windows.getAll).mockResolvedValue([])
    const openTab = vi.spyOn(Tree, 'openTab').mockResolvedValue(undefined)

    await Tree.initializeWindows()

    expect(openTab.mock.calls.map(([request]) => request.tabUid)).toEqual([
      'tab-parent',
      'tab-child',
    ])
    expect(openTab).toHaveBeenNthCalledWith(
      1,
      expect.objectContaining({
        tabUid: 'tab-parent',
        windowUid: 'window-restored',
      }),
    )
    expect(openTab).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({
        tabUid: 'tab-child',
        windowUid: 'window-restored',
      }),
    )
  })

  it('ST-09 continues restoring later tabs after one startup open fails', async () => {
    Settings.values.restorePreviousSessionOnStartup = true
    mockStoredTree([
      storedWindow('window-partial-restore', [
        storedTab('tab-fails'),
        storedTab('tab-still-opens'),
      ]),
    ])
    vi.mocked(browser.windows.getAll).mockResolvedValue([])
    vi.spyOn(console, 'error').mockImplementation(() => undefined)
    const openTab = vi
      .spyOn(Tree, 'openTab')
      .mockRejectedValueOnce(new Error('open failed'))
      .mockResolvedValueOnce(undefined)

    await Tree.initializeWindows()

    expect(openTab.mock.calls.map(([request]) => request.tabUid)).toEqual([
      'tab-fails',
      'tab-still-opens',
    ])
    expect(Tree.tabsByUid.get('tab-fails' as UID)?.state).toBe(State.SAVED)
    expect(Tree.tabsByUid.get('tab-still-opens' as UID)?.state).toBe(
      State.SAVED,
    )
  })

  it.each([true, false])(
    'ST-11 restores startup tabs with discarded=%s',
    async (openWindowWithTabsDiscarded) => {
      Settings.values.restorePreviousSessionOnStartup = true
      Settings.values.openWindowWithTabsDiscarded = openWindowWithTabsDiscarded
      mockStoredTree([
        storedWindow('window-discard-setting', [
          storedTab('tab-discard-setting'),
        ]),
      ])
      vi.mocked(browser.windows.getAll).mockResolvedValue([])
      const openTab = vi.spyOn(Tree, 'openTab').mockResolvedValue(undefined)

      await Tree.initializeWindows()

      expect(openTab).toHaveBeenCalledWith(
        expect.objectContaining({
          tabUid: 'tab-discard-setting',
          windowUid: 'window-discard-setting',
          discarded: openWindowWithTabsDiscarded,
        }),
      )
    },
  )

  it('ST-12 retains Session Flow UIDs when Firefox restores new native IDs', async () => {
    mockStoredTree([
      storedWindow(
        'window-stable',
        [
          storedTab('tab-stable-a', {
            id: 101,
            title: 'Stable A',
            url: 'https://example.test/stable-a',
          }),
          storedTab('tab-stable-b', {
            id: 102,
            title: 'Stable B',
            url: 'https://example.test/stable-b',
          }),
        ],
        { id: 100 },
      ),
    ])
    vi.mocked(browser.windows.getAll).mockResolvedValue([
      liveWindow(200, [
        liveTab(201, 200, 0, {
          title: 'Stable A',
          url: 'https://example.test/stable-a',
        }),
        liveTab(202, 200, 1, {
          title: 'Stable B',
          url: 'https://example.test/stable-b',
        }),
      ]),
    ])

    await Tree.initializeWindows()

    expect(Tree.Items.filter(Tree.isWindow).map((item) => item.uid)).toEqual([
      'window-stable',
    ])
    expect([...Tree.tabsByUid.values()].map((tab) => tab.uid)).toEqual([
      'tab-stable-a',
      'tab-stable-b',
    ])
    expect(Tree.tabsByUid.get('tab-stable-a' as UID)?.id).toBe(201)
    expect(Tree.tabsByUid.get('tab-stable-b' as UID)?.id).toBe(202)
    expectTreeInvariants()
  })

  it('ST-13 retains stable group metadata when Firefox assigns a new group ID', async () => {
    const group = {
      uid: 'stable-group' as UID,
      id: -1,
      title: 'Projects',
      color: 'blue' as const,
      collapsed: false,
    }
    mockStoredTree([
      storedWindow('window-grouped', [
        storedTab('tab-group-a', {
          title: 'Grouped A',
          url: 'https://example.test/group-a',
          tabGroup: group,
        }),
        storedTab('tab-group-b', {
          title: 'Grouped B',
          url: 'https://example.test/group-b',
          tabGroup: group,
        }),
      ]),
    ])
    const browserTabs = [
      liveTab(301, 300, 0, {
        title: 'Grouped A',
        url: 'https://example.test/group-a',
        groupId: 901,
      }),
      liveTab(302, 300, 1, {
        title: 'Grouped B',
        url: 'https://example.test/group-b',
        groupId: 901,
      }),
    ]
    vi.mocked(browser.windows.getAll).mockResolvedValue([
      liveWindow(300, browserTabs),
    ])
    vi.mocked(browser.tabGroups.query).mockResolvedValue([
      {
        id: 901,
        windowId: 300,
        title: 'Projects',
        color: 'blue',
        collapsed: false,
      },
    ])
    vi.mocked(browser.tabs.query).mockImplementation(async (queryInfo) => {
      if (queryInfo.groupId === 901) return browserTabs
      return browserTabs
    })

    await Tree.initializeWindows()

    const tabs = Tree.getTabs(
      Tree.windowsByUid.get('window-grouped' as UID)!.children,
    )
    expect(tabs.map((tab) => tab.uid)).toEqual(['tab-group-a', 'tab-group-b'])
    expect(tabs.map((tab) => tab.tabGroup)).toEqual([
      expect.objectContaining({ uid: 'stable-group', id: 901 }),
      expect.objectContaining({ uid: 'stable-group', id: 901 }),
    ])
    expectTreeInvariants()
  })

  it('ST-04 lets a container-specific tab claim its only match before a legacy wildcard tab', async () => {
    const work = {
      cookieStoreId: 'firefox-container-work',
      name: 'Work',
      color: 'blue',
      colorCode: '#37adff',
      icon: 'briefcase',
      iconUrl: 'resource://usercontext-content/briefcase.svg',
    }
    vi.mocked(browser.contextualIdentities.query).mockResolvedValue([work])
    await Tree.initializeContainers()
    const duplicateIdentity = {
      title: 'Same visible tab',
      url: 'https://example.test/same-visible-tab',
    }
    mockStoredTree([
      storedWindow('window-container-specificity', [
        storedTab('tab-legacy-wildcard', duplicateIdentity),
        storedTab('tab-known-work', {
          ...duplicateIdentity,
          container: work,
        }),
      ]),
    ])
    vi.mocked(browser.windows.getAll).mockResolvedValue([
      liveWindow(700, [
        liveTab(701, 700, 0, {
          ...duplicateIdentity,
          cookieStoreId: work.cookieStoreId,
        }),
        liveTab(702, 700, 1, duplicateIdentity),
      ]),
    ])

    await Tree.initializeWindows()

    expect(Tree.tabsByUid.get('tab-known-work' as UID)).toMatchObject({
      id: 701,
      container: work,
    })
    expect(Tree.tabsByUid.get('tab-legacy-wildcard' as UID)).toMatchObject({
      id: 702,
      container: undefined,
    })
    expect(Tree.tabsByUid.size).toBe(2)
    expectTreeInvariants()
  })
})
