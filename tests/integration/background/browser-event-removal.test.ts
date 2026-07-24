import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { DEFAULT_SETTINGS } from '@/defaults/settings'
import { Settings } from '@/services/settings'
import { State, TreeItemType } from '@/types/session-tree'
import { loadBackgroundHandlers } from '../../helpers/background-handler-harness'

describe('background browser-event removal ordering', () => {
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

  afterEach(() => {
    vi.useRealTimers()
  })

  it('cancels a stale deletion timer when Firefox reuses a group ID (EV-24)', async () => {
    vi.useFakeTimers()
    const { fakeBrowser, initializeListeners, mocks, settings } =
      await loadBackgroundHandlers()
    settings.values.saveTabsWhenTabGroupDeleted = true
    initializeListeners()
    const removedGroup = browserGroup(7, 'Removed group')
    const replacementGroup = browserGroup(7, 'Replacement group')

    fakeBrowser.tabGroups.onRemoved.emit(removedGroup, {
      isWindowClosing: false,
    })
    fakeBrowser.tabGroups.onCreated.emit(replacementGroup)
    await vi.advanceTimersByTimeAsync(100)

    expect(mocks.tabGroupUpdated).toHaveBeenCalledWith(replacementGroup)
    expect(mocks.tabGroupRemoved).toHaveBeenCalledOnce()
    expect(mocks.tabGroupRemoved).toHaveBeenCalledWith(removedGroup, false)
    expect(mocks.tabGroupRemoved.mock.invocationCallOrder[0]).toBeLessThan(
      mocks.tabGroupUpdated.mock.invocationCallOrder[0],
    )
  })

  it('handles an ordinary tab close exactly once (EV-22)', async () => {
    const { fakeBrowser, initializeListeners, mocks, settings } =
      await loadBackgroundHandlers()
    settings.values.saveTabOnClose = false
    mocks.Items.push(treeWindow([treeTab(10), treeTab(11)]))
    initializeListeners()

    fakeBrowser.tabs.onRemoved.emit(10, {
      windowId: 20,
      isWindowClosing: false,
    })

    expect(mocks.removeTab).toHaveBeenCalledOnce()
    expect(mocks.removeTab).toHaveBeenCalledWith('tab-10')
    expect(mocks.removeWindow).not.toHaveBeenCalled()
    expect(mocks.saveWindow).not.toHaveBeenCalled()
  })

  it('leaves child removal to the window-close event (EV-22)', async () => {
    const { fakeBrowser, initializeListeners, mocks } =
      await loadBackgroundHandlers()
    mocks.Items.push(treeWindow([treeTab(10), treeTab(11)]))
    initializeListeners()

    fakeBrowser.tabs.onRemoved.emit(10, {
      windowId: 20,
      isWindowClosing: true,
    })
    fakeBrowser.tabs.onRemoved.emit(11, {
      windowId: 20,
      isWindowClosing: true,
    })
    fakeBrowser.windows.onRemoved.emit(20)

    expect(mocks.removeTab).not.toHaveBeenCalled()
    expect(mocks.removeWindow).toHaveBeenCalledOnce()
    expect(mocks.removeWindow).toHaveBeenCalledWith('window-20')
  })

  it('treats closing Firefox final tab as one window closure (EV-23)', async () => {
    const { fakeBrowser, initializeListeners, mocks } =
      await loadBackgroundHandlers()
    mocks.Items.push(treeWindow([treeTab(10)]))
    initializeListeners()

    fakeBrowser.tabs.onRemoved.emit(10, {
      windowId: 20,
      isWindowClosing: true,
    })
    fakeBrowser.windows.onRemoved.emit(20)

    expect(mocks.removeTab).not.toHaveBeenCalled()
    expect(mocks.setTabSaved).not.toHaveBeenCalled()
    expect(mocks.removeWindow).toHaveBeenCalledOnce()
  })

  it.each(['tabs-first', 'group-first'] as const)(
    'associates grouped tab removals when events arrive %s (EV-24)',
    async (eventOrder) => {
      vi.useFakeTimers()
      const { fakeBrowser, initializeListeners, mocks, settings } =
        await loadBackgroundHandlers()
      settings.values.saveTabsWhenTabGroupDeleted = true
      const group = browserGroup(7, 'Research')
      mocks.Items.push(
        treeWindow([treeTab(10, { tabGroup: treeGroup(7, 'Research') })]),
      )
      initializeListeners()
      const removeTab = () =>
        fakeBrowser.tabs.onRemoved.emit(10, {
          windowId: 20,
          isWindowClosing: false,
        })
      const removeGroup = () =>
        fakeBrowser.tabGroups.onRemoved.emit(group, {
          isWindowClosing: false,
        })

      if (eventOrder === 'tabs-first') {
        removeTab()
        removeGroup()
      } else {
        removeGroup()
        removeTab()
      }
      await vi.advanceTimersByTimeAsync(100)

      expect(mocks.tabGroupRemoved).toHaveBeenCalledWith(group, true)
    },
  )

  it.each(['tabs-first', 'group-first'] as const)(
    'applies ordinary tab-close saving before clearing a deleted group when events arrive %s (TG-27)',
    async (eventOrder) => {
      vi.useFakeTimers()
      const { fakeBrowser, initializeListeners, mocks, settings } =
        await loadBackgroundHandlers()
      settings.values.saveTabsWhenTabGroupDeleted = false
      settings.values.saveTabOnClose = true
      const group = browserGroup(7, 'Research')
      mocks.Items.push(
        treeWindow([treeTab(10, { tabGroup: treeGroup(7, 'Research') })]),
      )
      initializeListeners()
      const removeTab = () =>
        fakeBrowser.tabs.onRemoved.emit(10, {
          windowId: 20,
          isWindowClosing: false,
        })
      const removeGroup = () =>
        fakeBrowser.tabGroups.onRemoved.emit(group, {
          isWindowClosing: false,
        })

      if (eventOrder === 'tabs-first') {
        removeTab()
        removeGroup()
      } else {
        removeGroup()
        removeTab()
      }
      await vi.advanceTimersByTimeAsync(100)

      expect(mocks.setTabSaved).toHaveBeenCalledWith('tab-10')
      expect(mocks.tabGroupRemoved).toHaveBeenCalledWith(group, false)
      expect(mocks.setTabSaved.mock.invocationCallOrder[0]).toBeLessThan(
        mocks.tabGroupRemoved.mock.invocationCallOrder[0],
      )
    },
  )

  it('keeps two concurrent group deletions isolated (EV-25)', async () => {
    vi.useFakeTimers()
    const { fakeBrowser, initializeListeners, mocks, settings } =
      await loadBackgroundHandlers()
    settings.values.saveTabsWhenTabGroupDeleted = true
    const groupSeven = browserGroup(7, 'Seven')
    const groupEight = browserGroup(8, 'Eight')
    mocks.Items.push(
      treeWindow([
        treeTab(10, { tabGroup: treeGroup(7, 'Seven') }),
        treeTab(11, { tabGroup: treeGroup(8, 'Eight') }),
      ]),
    )
    initializeListeners()

    fakeBrowser.tabs.onRemoved.emit(10, {
      windowId: 20,
      isWindowClosing: false,
    })
    fakeBrowser.tabs.onRemoved.emit(11, {
      windowId: 20,
      isWindowClosing: false,
    })
    fakeBrowser.tabGroups.onRemoved.emit(groupEight, {
      isWindowClosing: false,
    })
    fakeBrowser.tabGroups.onRemoved.emit(groupSeven, {
      isWindowClosing: false,
    })
    await vi.advanceTimersByTimeAsync(100)

    expect(mocks.tabGroupRemoved).toHaveBeenCalledTimes(2)
    expect(mocks.tabGroupRemoved).toHaveBeenCalledWith(groupSeven, true)
    expect(mocks.tabGroupRemoved).toHaveBeenCalledWith(groupEight, true)
  })

  it.each(['tabs-first', 'window-first'] as const)(
    'preserves configured window state when shutdown events arrive %s (EV-30)',
    async (eventOrder) => {
      const { fakeBrowser, initializeListeners, mocks, settings } =
        await loadBackgroundHandlers()
      settings.values.saveWindowOnClose = true
      mocks.Items.push(treeWindow([treeTab(10), treeTab(11)]))
      initializeListeners()
      const removeTabs = () => {
        fakeBrowser.tabs.onRemoved.emit(10, {
          windowId: 20,
          isWindowClosing: true,
        })
        fakeBrowser.tabs.onRemoved.emit(11, {
          windowId: 20,
          isWindowClosing: true,
        })
      }
      const removeWindow = () => fakeBrowser.windows.onRemoved.emit(20)

      if (eventOrder === 'tabs-first') {
        removeTabs()
        removeWindow()
      } else {
        removeWindow()
        removeTabs()
      }

      expect(mocks.removeTab).not.toHaveBeenCalled()
      expect(mocks.saveWindow).toHaveBeenCalledOnce()
      expect(mocks.saveWindow).toHaveBeenCalledWith('window-20')
      expect(mocks.removeWindow).not.toHaveBeenCalled()
    },
  )
})

function browserGroup(id: number, title: string): browser.tabGroups.TabGroup {
  return {
    id,
    windowId: 20,
    title,
    color: 'blue',
    collapsed: false,
  }
}

function treeWindow(children: ReturnType<typeof treeTab>[]) {
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

function treeTab(id: number, overrides: Record<string, unknown> = {}) {
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

function treeGroup(id: number, title: string) {
  return {
    uid: `group-${id}` as UID,
    id,
    title,
    color: 'blue' as const,
    collapsed: false,
  }
}
