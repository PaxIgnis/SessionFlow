import { beforeEach, describe, expect, it, vi } from 'vitest'
import { DEFAULT_SETTINGS } from '@/defaults/settings'
import { Settings } from '@/services/settings'
import { State, Tab, TreeItemType, WindowChild } from '@/types/session-tree'
import { loadBackgroundHandlers } from '../../helpers/background-handler-harness'

function deferred<T>() {
  let resolve!: (value: T | PromiseLike<T>) => void
  const promise = new Promise<T>((resolvePromise) => {
    resolve = resolvePromise
  })
  return { promise, resolve }
}

describe('background browser-event detach and attach ordering', () => {
  beforeEach(() => {
    Object.assign(Settings.values, structuredClone(DEFAULT_SETTINGS))
    vi.restoreAllMocks()
    vi.unstubAllGlobals()
    vi.doUnmock('@/services/background-actions')
    vi.doUnmock('@/services/background-on-created-queue')
    vi.doUnmock('@/services/background-session-restore')
    vi.doUnmock('@/services/background-tree')
    vi.doUnmock('@/services/runtime-port-service')
    vi.doUnmock('@/services/selection')
  })

  it('preserves stable identity and Session Flow metadata across a window transfer (EV-17)', async () => {
    const { fakeBrowser, initializeListeners, mocks } =
      await loadBackgroundHandlers()
    const transferred = treeTab(10, 'window-source', {
      uid: 'tab-stable' as UID,
      customLabel: 'My custom label',
      collapsed: true,
      isParent: true,
      savedTime: 123,
      tabGroup: {
        uid: 'group-stable' as UID,
        id: 7,
        title: 'Research',
        color: 'blue',
        collapsed: false,
      },
      container: {
        cookieStoreId: 'firefox-container-1',
        name: 'Work',
        color: 'blue',
        colorCode: '#37adff',
        icon: 'briefcase',
      },
    })
    mocks.Items.push(
      treeWindow(20, 'window-source', [transferred]),
      treeWindow(30, 'window-destination', []),
    )
    fakeBrowser.tabs.get.mockResolvedValueOnce(
      browserTab(10, 30, 0, {
        active: true,
        title: 'Live title',
        url: 'https://example.test/live',
        groupId: 7,
        cookieStoreId: 'firefox-container-1',
      }),
    )
    fakeBrowser.tabs.query.mockResolvedValueOnce([])
    mocks.addTab.mockReturnValue('tab-stable' as UID)
    initializeListeners()

    fakeBrowser.tabs.onDetached.emit(10, {
      oldWindowId: 20,
      oldPosition: 0,
    })
    await fakeBrowser.tabs.onAttached.emitAsync(10, {
      newWindowId: 30,
      newPosition: 0,
    })

    expect(mocks.removeTab).toHaveBeenCalledWith('tab-stable')
    expect(mocks.addTab.mock.calls[0]?.[10]).toBe('tab-stable')
    expect(mocks.addTab.mock.calls[0]?.[12]).toEqual(transferred.tabGroup)
    expect(mocks.addTab.mock.calls[0]?.[13]).toEqual(
      expect.objectContaining({
        cookieStoreId: 'firefox-container-1',
        name: 'Work',
        color: 'blue',
        colorCode: '#37adff',
        icon: 'briefcase',
      }),
    )
    expect(mocks.updateTab).toHaveBeenCalledWith(
      { tabUid: 'tab-stable' },
      expect.objectContaining({
        customLabel: 'My custom label',
        collapsed: true,
        isParent: true,
        savedTime: 123,
      }),
    )
  })

  it.each([
    {
      label: 'first',
      browserIndex: 0,
      tabToRight: browserTab(30, 30, 1),
      expectedIndex: 0,
    },
    {
      label: 'middle',
      browserIndex: 1,
      tabToRight: browserTab(40, 30, 2),
      expectedIndex: 1,
    },
    {
      label: 'last',
      browserIndex: 2,
      tabToRight: undefined,
      expectedIndex: undefined,
    },
  ])(
    'attaches a transferred tab at the $label destination position (EV-17)',
    async ({ browserIndex, tabToRight, expectedIndex }) => {
      const { fakeBrowser, initializeListeners, mocks } =
        await loadBackgroundHandlers()
      mocks.Items.push(
        treeWindow(20, 'window-source', [treeTab(10, 'window-source')]),
        treeWindow(30, 'window-destination', [
          treeTab(30, 'window-destination'),
          treeTab(40, 'window-destination'),
        ]),
      )
      fakeBrowser.tabs.get.mockResolvedValueOnce(
        browserTab(10, 30, browserIndex),
      )
      fakeBrowser.tabs.query.mockResolvedValueOnce(
        tabToRight ? [tabToRight] : [],
      )
      initializeListeners()

      fakeBrowser.tabs.onDetached.emit(10, {
        oldWindowId: 20,
        oldPosition: 0,
      })
      await fakeBrowser.tabs.onAttached.emitAsync(10, {
        newWindowId: 30,
        newPosition: browserIndex,
      })

      expect(mocks.addTab.mock.calls[0]?.[8]).toBe(expectedIndex)
      expect(mocks.addTab.mock.calls[0]?.[10]).toBe('tab-10')
    },
  )

  it('keeps grouped pending transfers separate until every tab attaches (EV-18)', async () => {
    const { fakeBrowser, initializeListeners, mocks } =
      await loadBackgroundHandlers()
    const group = {
      uid: 'group-stable' as UID,
      id: 7,
      title: 'Research',
      color: 'blue' as const,
      collapsed: false,
    }
    const source = treeWindow(20, 'window-source', [
      treeTab(10, 'window-source', { tabGroup: group }),
      treeTab(11, 'window-source', { tabGroup: group }),
    ])
    const destination = treeWindow(30, 'window-destination', [])
    mocks.Items.push(source, destination)
    mocks.removeTab.mockImplementation((uid: UID) => {
      source.children = source.children.filter((child) => child.uid !== uid)
    })
    mocks.addTab.mockImplementation((...args: unknown[]) => {
      const uid = args[10] as UID
      const id = args[2] as number
      const added = treeTab(id, 'window-destination', {
        uid,
        tabGroup: args[12] as Tab['tabGroup'],
      })
      const index = args[8] as number | undefined
      if (index === undefined) destination.children.push(added)
      else destination.children.splice(index, 0, added)
      return uid
    })
    fakeBrowser.tabs.get.mockImplementation(async (tabId: number) =>
      browserTab(tabId, 30, tabId === 10 ? 0 : 1, { groupId: 7 }),
    )
    fakeBrowser.tabs.query.mockImplementation(
      async (query: browser.tabs._QueryQueryInfo) =>
        query.index === 1 ? [browserTab(11, 30, 1, { groupId: 7 })] : [],
    )
    initializeListeners()

    fakeBrowser.tabs.onDetached.emit(10, {
      oldWindowId: 20,
      oldPosition: 0,
    })
    fakeBrowser.tabs.onDetached.emit(11, {
      oldWindowId: 20,
      oldPosition: 0,
    })
    await fakeBrowser.tabs.onAttached.emitAsync(11, {
      newWindowId: 30,
      newPosition: 1,
    })
    await fakeBrowser.tabs.onAttached.emitAsync(10, {
      newWindowId: 30,
      newPosition: 0,
    })

    expect(mocks.addTab).toHaveBeenCalledTimes(2)
    expect(mocks.addTab.mock.calls.map((call) => call[10])).toEqual([
      'tab-11',
      'tab-10',
    ])
    expect(mocks.addTab.mock.calls.map((call) => call[12])).toEqual([
      group,
      group,
    ])
    expect(mocks.tabGroupMembershipChanged).toHaveBeenCalledTimes(2)
  })

  it('waits for a destination window classification before attaching (EV-19)', async () => {
    const { fakeBrowser, initializeListeners, mocks } =
      await loadBackgroundHandlers()
    mocks.Items.push(
      treeWindow(20, 'window-source', [treeTab(10, 'window-source')]),
    )
    const classification = deferred<'new-window'>()
    mocks.waitForWindowClassification.mockReturnValueOnce(
      classification.promise,
    )
    fakeBrowser.tabs.get.mockResolvedValueOnce(browserTab(10, 30, 0))
    fakeBrowser.tabs.query.mockResolvedValueOnce([])
    initializeListeners()

    fakeBrowser.tabs.onDetached.emit(10, {
      oldWindowId: 20,
      oldPosition: 0,
    })
    const attach = fakeBrowser.tabs.onAttached.emitAsync(10, {
      newWindowId: 30,
      newPosition: 0,
    })
    await vi.waitFor(() => {
      expect(mocks.beginWindowClassification).toHaveBeenCalledWith(30)
    })
    mocks.Items.push(treeWindow(30, 'window-destination', []))
    classification.resolve('new-window')
    await attach

    expect(mocks.addTab).toHaveBeenCalledOnce()
    expect(mocks.addTab.mock.calls[0]?.[1]).toBe('window-destination')
    expect(mocks.addTab.mock.calls[0]?.[10]).toBe('tab-10')
  })

  it('cancels an attach that resumes after the detached tab closes (EV-20)', async () => {
    const { fakeBrowser, initializeListeners, mocks } =
      await loadBackgroundHandlers()
    const source = treeWindow(20, 'window-source', [
      treeTab(10, 'window-source'),
    ])
    mocks.Items.push(source, treeWindow(30, 'window-destination', []))
    mocks.removeTab.mockImplementation(() => {
      source.children = []
    })
    const getTab = deferred<browser.tabs.Tab>()
    fakeBrowser.tabs.get.mockReturnValueOnce(getTab.promise)
    initializeListeners()

    fakeBrowser.tabs.onDetached.emit(10, {
      oldWindowId: 20,
      oldPosition: 0,
    })
    const attach = fakeBrowser.tabs.onAttached.emitAsync(10, {
      newWindowId: 30,
      newPosition: 0,
    })
    await vi.waitFor(() => {
      expect(fakeBrowser.tabs.get).toHaveBeenCalledWith(10)
    })
    fakeBrowser.tabs.onRemoved.emit(10, {
      windowId: 20,
      isWindowClosing: false,
    })
    getTab.resolve(browserTab(10, 30, 0))
    await attach

    expect(mocks.addTab).not.toHaveBeenCalled()
  })

  it('does not give a reused tab ID metadata from an incomplete transfer (EV-21)', async () => {
    const { fakeBrowser, initializeListeners, mocks } =
      await loadBackgroundHandlers()
    const source = treeWindow(20, 'window-source', [
      treeTab(10, 'window-source', {
        uid: 'old-stable-uid' as UID,
        customLabel: 'Old identity',
      }),
    ])
    mocks.Items.push(source, treeWindow(30, 'window-destination', []))
    mocks.removeTab.mockImplementation(() => {
      source.children = []
    })
    initializeListeners()

    fakeBrowser.tabs.onDetached.emit(10, {
      oldWindowId: 20,
      oldPosition: 0,
    })
    fakeBrowser.tabs.onRemoved.emit(10, {
      windowId: 20,
      isWindowClosing: false,
    })
    await fakeBrowser.tabs.onCreated.emitAsync(browserTab(10, 30, 0))

    expect(mocks.addTab).toHaveBeenCalledOnce()
    expect(mocks.addTab.mock.calls[0]?.[10]).toBeUndefined()
    expect(mocks.updateTab).not.toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ customLabel: 'Old identity' }),
    )
  })
})

function treeTab(
  id: number,
  windowUid: string,
  overrides: Partial<Tab> = {},
): Tab {
  return {
    type: TreeItemType.TAB,
    uid: `tab-${id}` as UID,
    id,
    windowUid: windowUid as UID,
    selected: false,
    state: State.OPEN,
    indentLevel: 1,
    active: false,
    pinned: false,
    title: `Tab ${id}`,
    url: `https://example.test/${id}`,
    ...overrides,
  }
}

function treeWindow(id: number, uid: string, children: WindowChild[]) {
  return {
    type: TreeItemType.WINDOW,
    uid: uid as UID,
    id,
    incognito: false,
    selected: false,
    state: State.OPEN,
    indentLevel: 0,
    children,
  }
}

function browserTab(
  id: number,
  windowId: number,
  index: number,
  overrides: Partial<browser.tabs.Tab> = {},
): browser.tabs.Tab {
  return {
    id,
    windowId,
    index,
    active: false,
    discarded: false,
    pinned: false,
    title: `Tab ${id}`,
    url: `https://example.test/${id}`,
    ...overrides,
  } as browser.tabs.Tab
}
