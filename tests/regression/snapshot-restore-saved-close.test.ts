import { beforeEach, describe, expect, it, vi } from 'vitest'
import { DEFAULT_SETTINGS } from '@/defaults/settings'
import { installFakeBrowser } from '../helpers/fake-browser'

describe('snapshot-restored saved items', () => {
  let fakeBrowser: ReturnType<typeof installFakeBrowser>

  beforeEach(() => {
    vi.resetModules()
    vi.restoreAllMocks()
    fakeBrowser = installFakeBrowser()
  })

  it('keeps a reopened snapshot-restored window when Firefox closes it', async () => {
    const { OnCreatedQueue } =
      await import('@/services/background-on-created-queue')
    const { initializeListeners } =
      await import('@/services/background-handlers')
    const { Tree } = await import('@/services/background-tree')
    const { captureSessionSnapshot } =
      await import('@/services/session-snapshot-codec')
    const { projectSnapshotForRestore } =
      await import('@/services/session-snapshot-restore')
    const { Settings } = await import('@/services/settings')
    const { State, TreeItemType } = await import('@/types/session-tree')
    const { createTab, createWindow, resetTree } =
      await import('../helpers/tree-fixtures')
    const { expectTreeInvariants } = await import('../helpers/tree-invariants')

    Object.assign(Settings.values, structuredClone(DEFAULT_SETTINGS), {
      saveWindowOnCloseIfContainsSavedTabs: false,
      saveWindowOnCloseIfContainsNotes: false,
      saveWindowOnCloseIfPreviouslySaved: true,
      saveTabOnCloseIfPreviouslySaved: false,
    })
    resetTree()
    const sourceTab = createTab('source-tab' as UID, {
      id: 10,
      state: State.OPEN,
    })
    createWindow('source-window' as UID, [sourceTab], {
      id: 20,
      state: State.OPEN,
    })
    const payload = (
      await captureSessionSnapshot(Tree.Items, {
        includePrivateWindows: true,
      })
    ).payload
    resetTree()
    const projection = projectSnapshotForRestore({
      payload,
      mode: 'all',
      selectedUids: new Set(),
      existingUids: new Set(),
    })
    await Tree.appendTreeItemsAfterPersist(projection.items, [])
    const restoredWindow = Tree.Items[0]
    expect(restoredWindow.type).toBe(TreeItemType.WINDOW)
    if (restoredWindow.type !== TreeItemType.WINDOW) {
      throw new Error('Expected restored window')
    }
    const restoredTab = restoredWindow.children[0]
    expect(restoredTab.type).toBe(TreeItemType.TAB)
    if (restoredTab.type !== TreeItemType.TAB) {
      throw new Error('Expected restored tab')
    }
    vi.spyOn(OnCreatedQueue, 'createWindowAndWait').mockResolvedValue({
      id: 30,
      tabs: [{ id: 101 }],
    } as browser.windows.Window)
    initializeListeners()

    await Tree.openWindow({ windowUid: restoredWindow.uid })
    fakeBrowser.windows.onRemoved.emit(30)

    expect(Tree.windowsByUid.get(restoredWindow.uid)).toBe(restoredWindow)
    expect(restoredWindow).toMatchObject({
      id: -1,
      state: State.SAVED,
    })
    expect(restoredTab).toMatchObject({
      id: -1,
      state: State.SAVED,
    })
    expectTreeInvariants()
  })

  it('keeps a reopened snapshot-restored tab when Firefox closes the tab', async () => {
    const { OnCreatedQueue } =
      await import('@/services/background-on-created-queue')
    const { initializeListeners } =
      await import('@/services/background-handlers')
    const { Tree } = await import('@/services/background-tree')
    const { captureSessionSnapshot } =
      await import('@/services/session-snapshot-codec')
    const { projectSnapshotForRestore } =
      await import('@/services/session-snapshot-restore')
    const { Settings } = await import('@/services/settings')
    const { State, TreeItemType } = await import('@/types/session-tree')
    const { createTab, createWindow, resetTree } =
      await import('../helpers/tree-fixtures')
    const { expectTreeInvariants } = await import('../helpers/tree-invariants')

    Object.assign(Settings.values, structuredClone(DEFAULT_SETTINGS), {
      saveTabOnClose: false,
      saveTabOnCloseIfPreviouslySaved: true,
    })
    resetTree()
    const firstSourceTab = createTab('source-tab-1' as UID, {
      id: 10,
      state: State.OPEN,
    })
    const secondSourceTab = createTab('source-tab-2' as UID, {
      id: 11,
      state: State.OPEN,
    })
    createWindow('source-window' as UID, [firstSourceTab, secondSourceTab], {
      id: 20,
      state: State.OPEN,
    })
    const payload = (
      await captureSessionSnapshot(Tree.Items, {
        includePrivateWindows: true,
      })
    ).payload
    resetTree()
    const projection = projectSnapshotForRestore({
      payload,
      mode: 'all',
      selectedUids: new Set(),
      existingUids: new Set(),
    })
    await Tree.appendTreeItemsAfterPersist(projection.items, [])
    const restoredWindow = Tree.Items[0]
    expect(restoredWindow.type).toBe(TreeItemType.WINDOW)
    if (restoredWindow.type !== TreeItemType.WINDOW) {
      throw new Error('Expected restored window')
    }
    const [firstRestoredTab, secondRestoredTab] = restoredWindow.children
    expect(firstRestoredTab.type).toBe(TreeItemType.TAB)
    expect(secondRestoredTab.type).toBe(TreeItemType.TAB)
    if (
      firstRestoredTab.type !== TreeItemType.TAB ||
      secondRestoredTab.type !== TreeItemType.TAB
    ) {
      throw new Error('Expected restored tabs')
    }
    vi.spyOn(OnCreatedQueue, 'createWindowAndWait').mockResolvedValue({
      id: 30,
      tabs: [{ id: 101 }],
    } as browser.windows.Window)
    vi.spyOn(OnCreatedQueue, 'createTabAndWait').mockResolvedValue({
      id: 102,
      windowId: 30,
      index: 1,
      active: false,
      discarded: false,
      pinned: false,
    } as browser.tabs.Tab)
    initializeListeners()

    await Tree.openWindow({ windowUid: restoredWindow.uid })
    fakeBrowser.tabs.onRemoved.emit(102, {
      windowId: 30,
      isWindowClosing: false,
    })

    expect(restoredWindow).toMatchObject({
      id: 30,
      state: State.OPEN,
    })
    expect(firstRestoredTab).toMatchObject({
      id: 101,
      state: State.OPEN,
    })
    expect(secondRestoredTab).toMatchObject({
      id: -1,
      state: State.SAVED,
    })
    expect(restoredWindow.children).toContain(secondRestoredTab)
    expectTreeInvariants()
  })
})
