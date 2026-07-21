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

describe('background browser-event move ordering', () => {
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

  it('lets only the newest overlapping move reconcile a window (EV-15)', async () => {
    const { fakeBrowser, initializeListeners, mocks } =
      await loadBackgroundHandlers()
    mocks.Items.push(treeWindow([treeTab(10), treeTab(11), treeTab(12)]))
    const firstQuery = deferred<browser.tabs.Tab[]>()
    const secondQuery = deferred<browser.tabs.Tab[]>()
    const thirdQuery = deferred<browser.tabs.Tab[]>()
    fakeBrowser.tabs.query
      .mockReturnValueOnce(firstQuery.promise)
      .mockReturnValueOnce(secondQuery.promise)
      .mockReturnValueOnce(thirdQuery.promise)
    initializeListeners()
    const moveListener = fakeBrowser.tabs.onMoved.listeners[0]

    const firstMove = Promise.resolve(
      moveListener(10, { windowId: 20, fromIndex: 0, toIndex: 0 }),
    )
    const secondMove = Promise.resolve(
      moveListener(11, { windowId: 20, fromIndex: 1, toIndex: 0 }),
    )
    const latestMove = Promise.resolve(
      moveListener(12, { windowId: 20, fromIndex: 2, toIndex: 1 }),
    )
    await vi.waitFor(() => {
      expect(fakeBrowser.tabs.query).toHaveBeenCalledTimes(3)
    })

    thirdQuery.resolve([
      browserTab(11, 0),
      browserTab(12, 1),
      browserTab(10, 2),
    ])
    await latestMove
    secondQuery.resolve([
      browserTab(11, 0),
      browserTab(10, 1),
      browserTab(12, 2),
    ])
    await secondMove
    firstQuery.resolve([
      browserTab(10, 0),
      browserTab(11, 1),
      browserTab(12, 2),
    ])
    await firstMove

    expect(mocks.removeTab).toHaveBeenCalledOnce()
    expect(mocks.addTab).toHaveBeenCalledOnce()
    expect(mocks.recomputeSessionTree).toHaveBeenCalledOnce()
    expect(mocks.removeTab).toHaveBeenCalledWith('tab-12')
  })

  it('moves a tab across a collapsed hierarchy without rewriting notes or separators (EV-13)', async () => {
    const { fakeBrowser, initializeListeners, mocks } =
      await loadBackgroundHandlers()
    mocks.Items.push(
      treeWindow([
        treeTab(10, { collapsed: true, isParent: true }),
        {
          type: TreeItemType.NOTE,
          uid: 'note-child' as UID,
          windowUid: 'window-20' as UID,
          selected: false,
          state: State.SAVED,
          indentLevel: 2,
          parentUid: 'tab-10' as UID,
          content: 'Child note',
        },
        {
          type: TreeItemType.SEPARATOR,
          uid: 'separator-child' as UID,
          windowUid: 'window-20' as UID,
          selected: false,
          state: State.SAVED,
          indentLevel: 2,
          parentUid: 'tab-10' as UID,
        },
        treeTab(11),
      ]),
    )
    fakeBrowser.tabs.query.mockResolvedValueOnce([
      browserTab(11, 0),
      browserTab(10, 1),
    ])
    initializeListeners()

    await fakeBrowser.tabs.onMoved.emitAsync(11, {
      windowId: 20,
      fromIndex: 1,
      toIndex: 0,
    })

    expect(mocks.removeTab).toHaveBeenCalledWith('tab-11')
    expect(mocks.addTab.mock.calls[0]?.[8]).toBe(0)
    expect(mocks.addTab.mock.calls[0]?.[10]).toBe('tab-11')
    expect(mocks.updateNote).not.toHaveBeenCalled()
    expect(mocks.updateSeparator).not.toHaveBeenCalled()
    expect(mocks.recomputeSessionTree).toHaveBeenCalledOnce()
  })

  it('does not emit tree mutations for a no-op browser move (EV-14)', async () => {
    const { fakeBrowser, initializeListeners, mocks } =
      await loadBackgroundHandlers()
    mocks.Items.push(treeWindow([treeTab(10), treeTab(11)]))
    fakeBrowser.tabs.query.mockResolvedValueOnce([
      browserTab(10, 0),
      browserTab(11, 1),
    ])
    initializeListeners()

    await fakeBrowser.tabs.onMoved.emitAsync(10, {
      windowId: 20,
      fromIndex: 0,
      toIndex: 0,
    })

    expect(mocks.removeTab).not.toHaveBeenCalled()
    expect(mocks.addTab).not.toHaveBeenCalled()
    expect(mocks.updateTab).not.toHaveBeenCalled()
    expect(mocks.updateNote).not.toHaveBeenCalled()
    expect(mocks.updateSeparator).not.toHaveBeenCalled()
    expect(mocks.recomputeSessionTree).not.toHaveBeenCalled()
  })

  it.each(['group-first', 'tab-first'] as const)(
    'converges when native-group and individual move events arrive %s (EV-16)',
    async (eventOrder) => {
      const { fakeBrowser, initializeListeners, mocks } =
        await loadBackgroundHandlers()
      mocks.Items.push(treeWindow([treeTab(10), treeTab(11)]))
      fakeBrowser.tabs.query.mockResolvedValueOnce([
        browserTab(11, 0),
        browserTab(10, 1),
      ])
      initializeListeners()
      const group = {
        id: 7,
        windowId: 20,
        title: 'Research',
        color: 'blue',
        collapsed: false,
      } satisfies browser.tabGroups.TabGroup
      const emitGroupMove = () => fakeBrowser.tabGroups.onMoved.emit(group)
      const emitTabMove = () =>
        fakeBrowser.tabs.onMoved.emitAsync(11, {
          windowId: 20,
          fromIndex: 1,
          toIndex: 0,
        })

      if (eventOrder === 'group-first') {
        emitGroupMove()
        await emitTabMove()
      } else {
        await emitTabMove()
        emitGroupMove()
      }

      expect(mocks.tabGroupMoved).toHaveBeenCalledOnce()
      expect(mocks.tabGroupMoved).toHaveBeenCalledWith(group)
      expect(mocks.removeTab).toHaveBeenCalledOnce()
      expect(mocks.addTab).toHaveBeenCalledOnce()
      expect(mocks.recomputeSessionTree).toHaveBeenCalledOnce()
    },
  )
})

function treeTab(id: number, overrides: Partial<Tab> = {}): Tab {
  return {
    type: TreeItemType.TAB,
    uid: `tab-${id}` as UID,
    id,
    windowUid: 'window-20' as UID,
    selected: false,
    state: State.OPEN,
    indentLevel: 1,
    active: id === 10,
    pinned: false,
    title: `Tab ${id}`,
    url: `https://example.test/${id}`,
    ...overrides,
  }
}

function treeWindow(children: WindowChild[]) {
  return {
    type: TreeItemType.WINDOW,
    uid: 'window-20' as UID,
    id: 20,
    incognito: false,
    selected: false,
    state: State.OPEN,
    indentLevel: 0,
    children,
  }
}

function browserTab(id: number, index: number): browser.tabs.Tab {
  return {
    id,
    windowId: 20,
    index,
    active: id === 10,
    discarded: false,
    pinned: false,
    title: `Tab ${id}`,
    url: `https://example.test/${id}`,
  } as browser.tabs.Tab
}
