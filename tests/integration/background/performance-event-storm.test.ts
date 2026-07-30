import { beforeEach, describe, expect, it, vi } from 'vitest'
import { DEFAULT_SETTINGS } from '@/defaults/settings'
import { Settings } from '@/services/settings'
import { State, Tab, TreeItemType, WindowChild } from '@/types/session-tree'
import { loadBackgroundHandlers } from '../../helpers/background-handler-harness'

describe('background event-storm resilience', () => {
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

  it('coalesces rapid create, update, move, and remove events without failing (PF-05)', async () => {
    const { fakeBrowser, initializeListeners, mocks, setBrowserTabs } =
      await loadBackgroundHandlers()
    const existingTabs = Array.from({ length: 500 }, (_, index) =>
      treeTab(1_000 + index),
    )
    const createdTabs = Array.from({ length: 500 }, (_, index) =>
      browserTab(2_000 + index, index, 21),
    )
    mocks.Items.push(treeWindow(20, existingTabs), treeWindow(21, []))
    setBrowserTabs(
      20,
      existingTabs.map((tab, index) => browserTab(tab.id, index, 20)).reverse(),
    )
    setBrowserTabs(21, createdTabs)
    initializeListeners()

    const startedAt = performance.now()
    await Promise.all(
      createdTabs.map((tab) => fakeBrowser.tabs.onCreated.emitAsync(tab)),
    )
    await Promise.all(
      existingTabs.map((tab, index) =>
        fakeBrowser.tabs.onUpdated.emitAsync(
          tab.id,
          { status: 'loading' },
          browserTab(tab.id, index, 20, { status: 'loading' }),
        ),
      ),
    )
    await Promise.all(
      existingTabs.map((tab, index) =>
        fakeBrowser.tabs.onMoved.emitAsync(tab.id, {
          windowId: 20,
          fromIndex: index,
          toIndex: existingTabs.length - index - 1,
        }),
      ),
    )
    for (const tab of existingTabs) {
      fakeBrowser.tabs.onRemoved.emit(tab.id, {
        windowId: 20,
        isWindowClosing: false,
      })
    }
    const elapsedMs = performance.now() - startedAt

    expect(elapsedMs).toBeLessThan(10_000)
    expect(mocks.addTab.mock.calls.length).toBeGreaterThanOrEqual(500)
    expect(mocks.addTab.mock.calls.length).toBeLessThanOrEqual(501)
    expect(mocks.updateTab).toHaveBeenCalledTimes(500)
    expect(mocks.removeTab.mock.calls.length).toBeGreaterThanOrEqual(500)
    expect(mocks.removeTab.mock.calls.length).toBeLessThanOrEqual(501)
    expect(mocks.recomputeSessionTree.mock.calls.length).toBeLessThanOrEqual(1)
  }, 30_000)

  it('settles event storms when Firefox tab lookups and queries reject (PF-11)', async () => {
    const { fakeBrowser, initializeListeners, mocks } =
      await loadBackgroundHandlers()
    const tabs = Array.from({ length: 200 }, (_, index) =>
      treeTab(3_000 + index),
    )
    mocks.Items.push(treeWindow(20, tabs))
    fakeBrowser.tabs.get.mockRejectedValue(new Error('tab lookup failed'))
    fakeBrowser.tabs.query.mockRejectedValue(new Error('tab query failed'))
    const consoleDebug = vi.spyOn(console, 'debug').mockImplementation(() => {})
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {})
    initializeListeners()

    await Promise.all(
      tabs.flatMap((tab, index) => [
        fakeBrowser.tabs.onUpdated.emitAsync(
          tab.id,
          { status: 'complete' },
          browserTab(tab.id, index, 20, { status: 'complete' }),
        ),
        fakeBrowser.tabs.onMoved.emitAsync(tab.id, {
          windowId: 20,
          fromIndex: index,
          toIndex: tabs.length - index - 1,
        }),
      ]),
    )

    expect(consoleDebug).toHaveBeenCalledWith(
      'Failed to refresh completed tab update:',
      expect.any(Error),
    )
    expect(consoleError).toHaveBeenCalledWith(
      'Failed to reconcile moved tab:',
      expect.any(Error),
    )
    expect(mocks.updateTab).not.toHaveBeenCalled()
    expect(mocks.removeTab).not.toHaveBeenCalled()
  }, 30_000)
})

function treeWindow(id: number, children: WindowChild[]) {
  return {
    type: TreeItemType.WINDOW,
    uid: `storm-window-${id}` as UID,
    id,
    incognito: false,
    selected: false,
    state: State.OPEN,
    indentLevel: 0,
    children,
  }
}

function treeTab(id: number): Tab {
  return {
    type: TreeItemType.TAB,
    uid: `storm-tab-${id}` as UID,
    id,
    windowUid: 'storm-window-20' as UID,
    selected: false,
    state: State.OPEN,
    indentLevel: 1,
    active: false,
    pinned: false,
    title: `Storm tab ${id}`,
    url: `https://storm.test/${id}`,
  }
}

function browserTab(
  id: number,
  index: number,
  windowId: number,
  overrides: Partial<browser.tabs.Tab> = {},
): browser.tabs.Tab {
  return {
    id,
    windowId,
    index,
    active: index === 0,
    discarded: false,
    pinned: false,
    title: `Storm tab ${id}`,
    url: `https://storm.test/${id}`,
    ...overrides,
  } as browser.tabs.Tab
}
