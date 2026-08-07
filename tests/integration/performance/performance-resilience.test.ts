import { beforeEach, describe, expect, it, vi } from 'vitest'
import { STORAGE_KEY } from '@/defaults/constants'
import { DEFAULT_SETTINGS } from '@/defaults/settings'
import { Tree } from '@/services/background-tree'
import { Settings } from '@/services/settings'
import { captureSessionSnapshot } from '@/services/session-snapshot-codec'
import { projectSnapshotForRestore } from '@/services/session-snapshot-restore'
import {
  State,
  TopLevelTreeItem,
  TreeItemType,
  Window,
} from '@/types/session-tree'
import { installFakeBrowser } from '../../helpers/fake-browser'
import { resetTree } from '../../helpers/tree-fixtures'
import { expectTreeInvariants } from '../../helpers/tree-invariants'

const PERFORMANCE_BUDGET_MS = 10_000

describe('performance and long-running resilience', () => {
  beforeEach(() => {
    vi.restoreAllMocks()
    installFakeBrowser()
    resetTree()
    Object.assign(Settings.values, structuredClone(DEFAULT_SETTINGS), {
      fetchMissingFaviconsOnStartup: false,
      matchOpenedWindowsWithSavedWindowsOnStartup: true,
      restorePreviousSessionOnStartup: false,
    })
  })

  it('reconciles hundreds of windows and thousands of tabs within the startup budget (PF-01)', async () => {
    const stored = buildStoredWindows(200, 20, ({ windowIndex, tabIndex }) => ({
      title: `Window ${windowIndex} tab ${tabIndex}`,
      url: `https://scale.test/${windowIndex}/${tabIndex}`,
    }))
    const live = buildLiveWindows(stored)
    mockStoredTree(stored)
    vi.mocked(browser.windows.getAll).mockResolvedValue(live)

    const startedAt = performance.now()
    await Tree.initializeWindows()
    const elapsedMs = performance.now() - startedAt

    expect(elapsedMs).toBeLessThan(PERFORMANCE_BUDGET_MS)
    expect(Tree.windowsByUid.size).toBe(200)
    expect(Tree.tabsByUid.size).toBe(4_000)
    expect(
      [...Tree.windowsByUid.values()].every((window) => window.id >= 0),
    ).toBe(true)
    expect([...Tree.tabsByUid.values()].every((tab) => tab.id >= 0)).toBe(true)
    expectTreeInvariants()
  }, 30_000)

  it('keeps one-to-one startup matching under heavy duplicate URLs (PF-02)', async () => {
    const stored = buildStoredWindows(100, 20, ({ windowIndex, tabIndex }) => ({
      title: `Duplicate URL window ${windowIndex} tab ${tabIndex}`,
      url: 'https://duplicate.test/shared',
    }))
    const live = buildLiveWindows(stored).reverse()
    mockStoredTree(stored)
    vi.mocked(browser.windows.getAll).mockResolvedValue(live)

    const startedAt = performance.now()
    await Tree.initializeWindows()
    const elapsedMs = performance.now() - startedAt

    expect(elapsedMs).toBeLessThan(PERFORMANCE_BUDGET_MS)
    expect(Tree.windowsByUid.size).toBe(100)
    expect(Tree.tabsByUid.size).toBe(2_000)
    for (let windowIndex = 0; windowIndex < stored.length; windowIndex++) {
      const window = Tree.windowsByUid.get(`scale-window-${windowIndex}` as UID)
      expect(window?.id).toBe(10_000 + windowIndex)
      expect(window?.children.map((item) => item.uid)).toEqual(
        Array.from(
          { length: 20 },
          (_, tabIndex) => `scale-tab-${windowIndex}-${tabIndex}`,
        ),
      )
    }
    expectTreeInvariants()
  }, 30_000)

  it('serializes and reloads a 25,000-item mixed tree within the storage budget (PF-10)', async () => {
    Tree.Items = buildMixedTree(250, 99)
    expect(totalTreeItems(Tree.Items)).toBe(25_000)
    let storedPayload: unknown
    vi.mocked(browser.storage.local.set).mockImplementation(async (value) => {
      storedPayload = value[STORAGE_KEY]
    })

    const saveStartedAt = performance.now()
    await Tree.saveSessionTreeToStorage()
    const saveElapsedMs = performance.now() - saveStartedAt

    expect(saveElapsedMs).toBeLessThan(PERFORMANCE_BUDGET_MS)
    expect(storedPayload).toBeDefined()

    vi.mocked(browser.storage.local.get).mockResolvedValue({
      [STORAGE_KEY]: storedPayload,
    })
    resetTree()
    const loadStartedAt = performance.now()
    await Tree.loadSessionTreeFromStorage()
    const loadElapsedMs = performance.now() - loadStartedAt

    expect(loadElapsedMs).toBeLessThan(PERFORMANCE_BUDGET_MS)
    expect(totalTreeItems(Tree.Items)).toBe(25_000)
    expect(Tree.windowsByUid.size).toBe(250)
    expect(Tree.tabsByUid.size).toBe(14_750)
    expect(Tree.notesByUid.size).toBe(5_000)
    expect(Tree.separatorsByUid.size).toBe(5_000)
    expectTreeInvariants()
  }, 30_000)

  it('captures and projects a 25,000-item snapshot within the storage budget', async () => {
    Tree.Items = buildMixedTree(250, 99)

    const captureStartedAt = performance.now()
    const capture = await captureSessionSnapshot(Tree.Items, {
      includePrivateWindows: true,
    })
    const captureElapsed = performance.now() - captureStartedAt
    const restoreStartedAt = performance.now()
    const restored = projectSnapshotForRestore({
      payload: capture.payload,
      mode: 'all',
      selectedUids: new Set(),
      existingUids: new Set(),
    })
    const restoreElapsed = performance.now() - restoreStartedAt

    expect(captureElapsed).toBeLessThan(PERFORMANCE_BUDGET_MS)
    expect(restoreElapsed).toBeLessThan(PERFORMANCE_BUDGET_MS)
    expect(totalTreeItems(restored.items)).toBe(25_000)
  }, 30_000)

  it('projects a single 25,000-item window within the storage budget', async () => {
    Tree.Items = buildMixedTree(1, 24_999)

    const capture = await captureSessionSnapshot(Tree.Items, {
      includePrivateWindows: true,
    })
    const restoreStartedAt = performance.now()
    const restored = projectSnapshotForRestore({
      payload: capture.payload,
      mode: 'all',
      selectedUids: new Set(),
      existingUids: new Set(),
    })
    const restoreElapsed = performance.now() - restoreStartedAt

    expect(restoreElapsed).toBeLessThan(PERFORMANCE_BUDGET_MS)
    expect(totalTreeItems(restored.items)).toBe(25_000)
  }, 30_000)
})

function buildStoredWindows(
  windowCount: number,
  tabsPerWindow: number,
  tabFields: (indexes: { windowIndex: number; tabIndex: number }) => {
    title: string
    url: string
  },
): Window[] {
  return Array.from({ length: windowCount }, (_, windowIndex) => {
    const windowUid = `scale-window-${windowIndex}` as UID
    return {
      type: TreeItemType.WINDOW,
      uid: windowUid,
      id: windowIndex,
      incognito: false,
      selected: false,
      state: State.OPEN,
      indentLevel: 0,
      children: Array.from({ length: tabsPerWindow }, (_, tabIndex) => ({
        type: TreeItemType.TAB,
        uid: `scale-tab-${windowIndex}-${tabIndex}` as UID,
        id: tabIndex,
        active: tabIndex === 0,
        selected: false,
        state: State.OPEN,
        ...tabFields({ windowIndex, tabIndex }),
        windowUid,
        indentLevel: 1,
        pinned: false,
      })),
    }
  })
}

function buildLiveWindows(stored: Window[]): browser.windows.Window[] {
  return stored.map((storedWindow, windowIndex) => ({
    id: 10_000 + windowIndex,
    type: 'normal',
    incognito: false,
    focused: windowIndex === 0,
    alwaysOnTop: false,
    tabs: storedWindow.children.filter(Tree.isTab).map((tab, tabIndex) => ({
      id: 100_000 + windowIndex * 100 + tabIndex,
      windowId: 10_000 + windowIndex,
      index: tabIndex,
      active: tabIndex === 0,
      discarded: false,
      pinned: tab.pinned,
      title: tab.title,
      url: tab.url,
    })) as browser.tabs.Tab[],
  }))
}

function mockStoredTree(items: Window[]): void {
  vi.mocked(browser.storage.local.get).mockImplementation(async (key) => {
    if (key === STORAGE_KEY) return { [STORAGE_KEY]: structuredClone(items) }
    return {}
  })
}

function buildMixedTree(
  windowCount: number,
  childrenPerWindow: number,
): Window[] {
  return Array.from({ length: windowCount }, (_, windowIndex) => {
    const windowUid = `storage-window-${windowIndex}` as UID
    return {
      type: TreeItemType.WINDOW,
      uid: windowUid,
      id: -1,
      incognito: false,
      selected: false,
      state: State.SAVED,
      indentLevel: 0,
      children: Array.from({ length: childrenPerWindow }, (_, childIndex) => {
        const common = {
          uid: `storage-item-${windowIndex}-${childIndex}` as UID,
          selected: false,
          windowUid,
          indentLevel: 1,
        }
        if (childIndex % 5 === 0) {
          return {
            ...common,
            type: TreeItemType.NOTE,
            text: `Note ${windowIndex}-${childIndex}`,
          }
        }
        if (childIndex % 5 === 1) {
          return {
            ...common,
            type: TreeItemType.SEPARATOR,
          }
        }
        return {
          ...common,
          type: TreeItemType.TAB,
          id: -1,
          active: false,
          state: State.SAVED,
          title: `Tab ${windowIndex}-${childIndex}`,
          url: `https://storage.test/${windowIndex}/${childIndex}`,
          pinned: childIndex < 3,
        }
      }),
    }
  }) as Window[]
}

function totalTreeItems(items: TopLevelTreeItem[]): number {
  return items.reduce(
    (total, item) =>
      total +
      1 +
      (item.type === TreeItemType.WINDOW ? item.children.length : 0),
    0,
  )
}
