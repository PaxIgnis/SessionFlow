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

describe('background browser-event creation ordering', () => {
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

  it('deduplicates a tab created before its window classification completes (EV-01)', async () => {
    const { fakeBrowser, initializeListeners, mocks } =
      await loadBackgroundHandlers()
    const classification = deferred<'new-window'>()
    mocks.waitForWindowClassification.mockReturnValueOnce(
      classification.promise,
    )
    const tab = {
      id: 10,
      windowId: 30,
      index: 0,
      active: true,
      discarded: false,
      pinned: false,
      title: 'First tab',
      url: 'https://example.test/first',
    } as browser.tabs.Tab
    mocks.addWindow.mockImplementationOnce(async () => {
      mocks.Items.push({
        type: TreeItemType.WINDOW,
        uid: 'window-30' as UID,
        id: 30,
        incognito: false,
        selected: false,
        state: State.OPEN,
        indentLevel: 0,
        children: [
          {
            type: TreeItemType.TAB,
            uid: 'tab-10' as UID,
            id: 10,
            windowUid: 'window-30' as UID,
            selected: false,
            state: State.OPEN,
            indentLevel: 1,
            active: true,
            pinned: false,
            title: 'First tab',
            url: 'https://example.test/first',
          },
        ],
      })
    })
    initializeListeners()

    fakeBrowser.tabs.onCreated.emit(tab)
    await vi.waitFor(() => {
      expect(mocks.beginWindowClassification).toHaveBeenCalledWith(30)
    })
    await fakeBrowser.windows.onCreated.emitAsync({
      id: 30,
      type: 'normal',
      incognito: false,
      tabs: [tab],
    } as browser.windows.Window)
    classification.resolve('new-window')
    await classification.promise
    await Promise.resolve()

    const windows = mocks.Items.filter(
      (item) => (item as { type?: TreeItemType }).type === TreeItemType.WINDOW,
    )
    expect(windows).toHaveLength(1)
    expect((windows[0] as { children: object[] }).children).toHaveLength(1)
    expect(mocks.addWindow).toHaveBeenCalledOnce()
    expect(mocks.addTab).not.toHaveBeenCalled()
  })

  it('inserts the first tab at the start without a left neighbor (EV-02)', async () => {
    const { fakeBrowser, initializeListeners, mocks } =
      await loadBackgroundHandlers()
    mocks.Items.push(treeWindow([]))
    mocks.addTab.mockReturnValue('tab-first' as UID)
    initializeListeners()

    await fakeBrowser.tabs.onCreated.emitAsync(browserTab(10, 0))

    expect(mocks.addTab).toHaveBeenCalledWith(
      true,
      'window-20',
      10,
      false,
      State.OPEN,
      'Tab 10',
      'https://example.test/10',
      false,
      0,
    )
  })

  it.each([
    { label: 'beginning', browserIndex: 0, expectedTreeIndex: 0 },
    { label: 'middle', browserIndex: 1, expectedTreeIndex: 2 },
    { label: 'end', browserIndex: 2, expectedTreeIndex: 5 },
  ])(
    'translates a $label browser position around notes, separators, and saved tabs (EV-03)',
    async ({ browserIndex, expectedTreeIndex }) => {
      const { fakeBrowser, initializeListeners, mocks } =
        await loadBackgroundHandlers()
      mocks.Items.push(treeWindow(mixedChildren()))
      initializeListeners()

      await fakeBrowser.tabs.onCreated.emitAsync(
        browserTab(12, browserIndex, { active: false }),
      )

      expect(mocks.addTab.mock.calls[0]?.[8]).toBe(expectedTreeIndex)
    },
  )

  it.each([
    {
      label: 'pinned',
      overrides: { pinned: true },
      expectedState: State.OPEN,
      expectedPinned: true,
    },
    {
      label: 'discarded',
      overrides: { discarded: true },
      expectedState: State.DISCARDED,
      expectedPinned: false,
    },
    {
      label: 'hidden',
      overrides: { hidden: true },
      expectedState: State.OPEN,
      expectedPinned: false,
    },
  ])(
    'captures a newly created $label tab (EV-04)',
    async ({ overrides, expectedState, expectedPinned }) => {
      const { fakeBrowser, initializeListeners, mocks } =
        await loadBackgroundHandlers()
      mocks.Items.push(treeWindow([]))
      initializeListeners()

      await fakeBrowser.tabs.onCreated.emitAsync(browserTab(10, 0, overrides))

      expect(mocks.addTab.mock.calls[0]?.[4]).toBe(expectedState)
      expect(mocks.addTab.mock.calls[0]?.[7]).toBe(expectedPinned)
    },
  )

  it('applies group metadata once to a newly created grouped tab (EV-04)', async () => {
    const { fakeBrowser, initializeListeners, mocks } =
      await loadBackgroundHandlers()
    mocks.Items.push(treeWindow([]))
    mocks.addTab.mockReturnValue('tab-grouped' as UID)
    initializeListeners()

    await fakeBrowser.tabs.onCreated.emitAsync(
      browserTab(10, 0, { groupId: 7 }),
    )

    expect(mocks.addTab).toHaveBeenCalledOnce()
    expect(mocks.tabGroupMembershipChanged).toHaveBeenCalledOnce()
    expect(mocks.tabGroupMembershipChanged).toHaveBeenCalledWith(10, 7)
  })

  it('suppresses one extension-created tab without suppressing the next user tab (EV-05)', async () => {
    const { fakeBrowser, initializeListeners, mocks } =
      await loadBackgroundHandlers()
    mocks.Items.push(treeWindow([]))
    mocks.isNewTabExtensionGenerated
      .mockResolvedValueOnce(true)
      .mockResolvedValueOnce(false)
    initializeListeners()

    await fakeBrowser.tabs.onCreated.emitAsync(browserTab(10, 0))
    await fakeBrowser.tabs.onCreated.emitAsync(
      browserTab(11, 0, { title: 'User tab' }),
    )

    expect(mocks.isNewTabExtensionGenerated).toHaveBeenNthCalledWith(1, 10)
    expect(mocks.isNewTabExtensionGenerated).toHaveBeenNthCalledWith(2, 11)
    expect(mocks.addTab).toHaveBeenCalledOnce()
    expect(mocks.addTab.mock.calls[0]?.[2]).toBe(11)
  })

  it('does not add a tab that closes while creation processing is deferred (EV-06)', async () => {
    const { fakeBrowser, initializeListeners, mocks } =
      await loadBackgroundHandlers()
    mocks.Items.push({
      type: TreeItemType.WINDOW,
      uid: 'window-1' as UID,
      id: 20,
      incognito: false,
      selected: false,
      state: State.OPEN,
      indentLevel: 0,
      children: [],
    })
    const extensionCheck = deferred<boolean>()
    mocks.isNewTabExtensionGenerated.mockReturnValueOnce(extensionCheck.promise)
    initializeListeners()

    fakeBrowser.tabs.onCreated.emit({
      id: 10,
      windowId: 20,
      index: 0,
      active: true,
      discarded: false,
      pinned: false,
      title: 'Short lived',
      url: 'https://example.test/short-lived',
    } as browser.tabs.Tab)
    await vi.waitFor(() => {
      expect(mocks.isNewTabExtensionGenerated).toHaveBeenCalledWith(10)
    })

    fakeBrowser.tabs.onRemoved.emit(10, {
      windowId: 20,
      isWindowClosing: false,
    })
    extensionCheck.resolve(false)
    await extensionCheck.promise
    await Promise.resolve()

    expect(mocks.addTab).not.toHaveBeenCalled()
  })
})

function browserTab(
  id: number,
  index: number,
  overrides: Partial<browser.tabs.Tab> = {},
): browser.tabs.Tab {
  return {
    id,
    windowId: 20,
    index,
    active: index === 0,
    discarded: false,
    hidden: false,
    pinned: false,
    title: `Tab ${id}`,
    url: `https://example.test/${id}`,
    ...overrides,
  } as browser.tabs.Tab
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

function mixedChildren(): WindowChild[] {
  const tab = (uid: string, id: number, state: State): Tab => ({
    type: TreeItemType.TAB,
    uid: uid as UID,
    id,
    windowUid: 'window-20' as UID,
    selected: false,
    state,
    indentLevel: 1,
    active: false,
    pinned: false,
    title: uid,
    url: `https://example.test/${uid}`,
  })
  return [
    {
      type: TreeItemType.NOTE,
      uid: 'note-1' as UID,
      windowUid: 'window-20' as UID,
      selected: false,
      indentLevel: 1,
      text: 'between tabs',
    },
    tab('tab-10', 10, State.OPEN),
    {
      type: TreeItemType.SEPARATOR,
      uid: 'separator-1' as UID,
      windowUid: 'window-20' as UID,
      selected: false,
      indentLevel: 1,
    },
    tab('tab-saved', -1, State.SAVED),
    tab('tab-11', 11, State.OPEN),
  ]
}
