import fc from 'fast-check'
import { describe, expect, it, vi } from 'vitest'
import { State, Tab, TreeItemType, Window } from '@/types/session-tree'
import { loadBackgroundHandlers } from '../helpers/background-handler-harness'

interface BrowserEventCommand {
  kind: 'create' | 'move' | 'remove' | 'attach'
  tabSeed: number
  windowSeed: number
  indexSeed: number
}

const commandsArbitrary = fc.array(
  fc.record({
    kind: fc.constantFrom('create', 'move', 'remove', 'attach'),
    tabSeed: fc.nat(),
    windowSeed: fc.nat(),
    indexSeed: fc.nat(),
  }),
  { minLength: 1, maxLength: 20 },
)

describe('Firefox browser-event sequence properties', () => {
  it('keeps one tree tab per live Firefox tab through create/move/remove/attach sequences', async () => {
    const harness = await loadBackgroundHandlers()
    harness.initializeListeners()
    const windows = [treeWindow(20), treeWindow(30)]
    const browserTabs = new Map<number, browser.tabs.Tab>()
    let nextTabId = 100

    harness.mocks.addTab.mockImplementation(
      (
        active: boolean,
        windowUid: UID,
        tabId: number,
        _selected: boolean,
        state: State,
        title: string,
        url: string,
        pinned: boolean,
        index?: number,
        parentUid?: UID,
        tabUid?: UID,
      ) => {
        const window = windows.find((candidate) => candidate.uid === windowUid)
        if (!window) return undefined
        const uid = tabUid ?? (`tab-${tabId}` as UID)
        const tab: Tab = {
          type: TreeItemType.TAB,
          uid,
          id: tabId,
          active,
          selected: false,
          state,
          title,
          url,
          windowUid,
          indentLevel: 1,
          pinned,
          parentUid,
        }
        window.children.splice(index ?? window.children.length, 0, tab)
        harness.mocks.tabsByUid.set(uid, tab)
        return uid
      },
    )
    harness.mocks.removeTab.mockImplementation((uid: UID) => {
      const tab = harness.mocks.tabsByUid.get(uid) as Tab | undefined
      if (!tab) return
      const window = windows.find(
        (candidate) => candidate.uid === tab.windowUid,
      )
      const index =
        window?.children.findIndex((child) => child.uid === uid) ?? -1
      if (window && index >= 0) window.children.splice(index, 1)
      harness.mocks.tabsByUid.delete(uid)
    })

    await fc.assert(
      fc.asyncProperty(commandsArbitrary, async (commands) => {
        harness.mocks.Items.splice(0, harness.mocks.Items.length, ...windows)
        harness.mocks.windowsByUid.clear()
        harness.mocks.tabsByUid.clear()
        windows.forEach((window) => {
          window.children.splice(0)
          harness.mocks.windowsByUid.set(window.uid, window)
        })
        browserTabs.clear()
        nextTabId = 100
        syncBrowserTabs(harness, windows, browserTabs)

        for (const command of commands) {
          if (command.kind === 'create' || browserTabs.size === 0) {
            const window = windows[command.windowSeed % windows.length]
            const tab = browserTab(nextTabId++, window.id, 0)
            browserTabs.set(tab.id!, tab)
            syncBrowserTabs(harness, windows, browserTabs)
            await harness.fakeBrowser.tabs.onCreated.emitAsync(tab)
          } else {
            const tab = select([...browserTabs.values()], command.tabSeed)!
            if (tab.id === undefined || tab.windowId === undefined) {
              throw new Error('Generated browser tab requires id and windowId')
            }
            const tabId = tab.id
            const currentWindowId = tab.windowId
            if (command.kind === 'remove') {
              browserTabs.delete(tabId)
              await harness.fakeBrowser.tabs.onRemoved.emitAsync(tabId, {
                windowId: currentWindowId,
                isWindowClosing: false,
              })
              syncBrowserTabs(harness, windows, browserTabs)
            } else if (command.kind === 'attach') {
              const oldWindowId = currentWindowId
              const destination = windows.find(
                (window) => window.id !== oldWindowId,
              )!
              const oldPosition = tab.index
              harness.fakeBrowser.tabs.onDetached.emit(tabId, {
                oldWindowId,
                oldPosition,
              })
              tab.windowId = destination.id
              tab.index = command.indexSeed
              syncBrowserTabs(harness, windows, browserTabs)
              await harness.fakeBrowser.tabs.onAttached.emitAsync(tabId, {
                newWindowId: destination.id,
                newPosition: tab.index,
              })
            } else {
              const sameWindowTabs = [...browserTabs.values()].filter(
                (candidate) => candidate.windowId === tab.windowId,
              )
              const fromIndex = tab.index
              tab.index = command.indexSeed % sameWindowTabs.length
              syncBrowserTabs(harness, windows, browserTabs)
              await harness.fakeBrowser.tabs.onMoved.emitAsync(tabId, {
                windowId: currentWindowId,
                fromIndex,
                toIndex: tab.index,
              })
            }
          }

          expectTreeMatchesBrowser(windows, browserTabs)
        }
      }),
      { numRuns: 30 },
    )
  })
})

function syncBrowserTabs(
  harness: Awaited<ReturnType<typeof loadBackgroundHandlers>>,
  windows: Window[],
  tabs: Map<number, browser.tabs.Tab>,
): void {
  for (const window of windows) {
    const ordered = [...tabs.values()]
      .filter((tab) => tab.windowId === window.id)
      .sort((left, right) => left.index - right.index)
    ordered.forEach((tab, index) => {
      tab.index = index
    })
    harness.setBrowserTabs(window.id, ordered)
    harness.setBrowserWindow({
      id: window.id,
      type: 'normal',
      incognito: false,
      tabs: ordered,
    } as browser.windows.Window)
  }
}

function expectTreeMatchesBrowser(
  windows: Window[],
  tabs: Map<number, browser.tabs.Tab>,
): void {
  const treeTabs = windows.flatMap((window) =>
    window.children.filter(
      (item): item is Tab => item.type === TreeItemType.TAB,
    ),
  )
  expect(treeTabs).toHaveLength(tabs.size)
  expect(new Set(treeTabs.map((tab) => tab.id))).toEqual(new Set(tabs.keys()))

  for (const window of windows) {
    const browserOrder = [...tabs.values()]
      .filter((tab) => tab.windowId === window.id)
      .sort((left, right) => left.index - right.index)
      .map((tab) => tab.id)
    expect(window.children.map((item) => (item as Tab).id)).toEqual(
      browserOrder,
    )
  }
}

function treeWindow(id: number): Window {
  return {
    type: TreeItemType.WINDOW,
    uid: `window-${id}` as UID,
    id,
    incognito: false,
    selected: false,
    state: State.OPEN,
    children: [],
    indentLevel: 0,
  }
}

function browserTab(id: number, windowId: number, index: number) {
  return {
    id,
    windowId,
    index,
    active: false,
    discarded: false,
    pinned: false,
    title: `Tab ${id}`,
    url: `https://example.test/${id}`,
  } as browser.tabs.Tab
}

function select<T>(items: T[], seed: number): T | undefined {
  if (items.length === 0) return undefined
  return items[seed % items.length]
}
