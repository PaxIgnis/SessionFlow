import { beforeEach, describe, expect, it, vi } from 'vitest'
import { Selection } from '@/services/selection'
import { Settings } from '@/services/settings'
import { SessionTree } from '@/services/foreground-tree'
import { SelectionType, State } from '@/types/session-tree'
import { installFakeBrowser } from '../../helpers/fake-browser'
import {
  makeForegroundTab,
  makeForegroundWindow,
  resetForegroundTree,
} from '../../helpers/foreground-tree-fixtures'

const openTabs = vi.hoisted(() => vi.fn())
const reloadTabs = vi.hoisted(() => vi.fn())
const saveTabs = vi.hoisted(() => vi.fn())
const pinTabs = vi.hoisted(() => vi.fn())
const unpinTabs = vi.hoisted(() => vi.fn())
const setTabsContainer = vi.hoisted(() => vi.fn())
const saveWindows = vi.hoisted(() => vi.fn())
const openModal = vi.hoisted(() => vi.fn())

vi.mock('@/services/foreground-messages', () => ({
  openTabs,
  reloadTabs,
  saveTabs,
  pinTabs,
  unpinTabs,
  setTabsContainer,
  saveWindows,
}))

vi.mock('@/services/modal-state', () => ({
  openModal,
}))

vi.mock('@/services/container-menu-icons', () => ({
  containerMenuIcon: vi.fn(
    async (container) => `colored-${container.icon}-${container.colorCode}`,
  ),
}))

describe('tab context menu items', () => {
  const browser = installFakeBrowser()
  it('still offers clearing when Firefox containers are disabled', async () => {
    const tab = makeForegroundTab('saved' as UID, {
      container: {
        cookieStoreId: 'deleted',
        name: 'Old container',
        color: 'blue',
        colorCode: '#37adff',
        icon: 'briefcase',
      },
    })
    resetForegroundTree([makeForegroundWindow('window' as UID, [tab])])
    Selection.selectedItems.value = [
      { item: SessionTree.tabsByUid.get(tab.uid)!, type: SelectionType.TAB },
    ]
    browser.contextualIdentities.query.mockRejectedValueOnce(
      new Error('disabled'),
    )
    const { contextMenuItemsTab } =
      await import('@/services/context-menu-items-tab')
    const menu = contextMenuItemsTab.setContainer()
    expect(await menu.loadSubmenu!()).toEqual([])
    expect(menu.submenu![0].enabled).toBe(true)
    menu.submenu![0].action?.()
    expect(setTabsContainer).toHaveBeenCalledWith([tab.uid])
  })
  it('sets and clears only selected tabs without changing unselected descendants', async () => {
    const parent = makeForegroundTab('parent' as UID, {
      collapsed: true,
      isParent: true,
    })
    const child = makeForegroundTab('child' as UID, { parentUid: parent.uid })
    const container = {
      cookieStoreId: 'firefox-container-1',
      name: 'Work',
      color: 'blue',
      colorCode: '#37adff',
      icon: 'briefcase',
    }
    const second = makeForegroundTab('second' as UID, { container })
    browser.contextualIdentities.query.mockResolvedValue([container])
    resetForegroundTree([
      makeForegroundWindow('window' as UID, [parent, child, second]),
    ])
    Selection.selectedItems.value = [parent, second].map((tab) => ({
      item: SessionTree.tabsByUid.get(tab.uid)!,
      type: SelectionType.TAB,
    }))
    const { contextMenuItemsTab } =
      await import('@/services/context-menu-items-tab')
    const set = contextMenuItemsTab.setContainer()
    expect(set.enabled).toBe(true)
    expect(set.submenu?.[0].label).toBe('No Container')
    const options = await set.loadSubmenu!()
    expect(options.map((item) => item.type ?? item.label)).toEqual([
      'separator',
      'Work',
      'separator',
      'New Container',
    ])
    expect(options[1]).toMatchObject({
      label: 'Work',
      icons: { '16': 'colored-briefcase-#37adff' },
    })
    options[1].action?.()
    expect(setTabsContainer).toHaveBeenCalledWith(
      [parent.uid, second.uid],
      container.cookieStoreId,
    )
    const clear = set.submenu![0]
    expect(clear.enabled).toBe(true)
    clear.action?.()
    expect(setTabsContainer).toHaveBeenCalledWith([second.uid])
    expect(openModal).not.toHaveBeenCalled()
    Selection.selectedItems.value = []
    options.at(-1)!.action?.()
    expect(openModal).toHaveBeenCalledWith({
      kind: 'createContainer',
      tabUids: [parent.uid, second.uid],
    })
  })

  it('offers creation when there are no containers without consecutive separators', async () => {
    const tab = makeForegroundTab('normal' as UID)
    resetForegroundTree([makeForegroundWindow('window' as UID, [tab])])
    Selection.selectedItems.value = [
      { item: SessionTree.tabsByUid.get(tab.uid)!, type: SelectionType.TAB },
    ]
    browser.contextualIdentities.query.mockResolvedValueOnce([])
    const { contextMenuItemsTab } =
      await import('@/services/context-menu-items-tab')
    expect(
      (await contextMenuItemsTab.setContainer().loadSubmenu!()).map(
        (item) => item.type ?? item.label,
      ),
    ).toEqual(['separator', 'New Container'])
  })

  it('disables assignment for private tabs and clearing when no container is selected', async () => {
    const tab = makeForegroundTab('private' as UID)
    resetForegroundTree([
      makeForegroundWindow('window' as UID, [tab], { incognito: true }),
    ])
    Selection.selectedItems.value = [
      { item: SessionTree.tabsByUid.get(tab.uid)!, type: SelectionType.TAB },
    ]
    const { contextMenuItemsTab } =
      await import('@/services/context-menu-items-tab')
    expect(contextMenuItemsTab.setContainer().enabled).toBe(false)
    expect(contextMenuItemsTab.setContainer().submenu![0].enabled).toBe(false)
  })

  beforeEach(() => {
    vi.clearAllMocks()
    Selection.selectedItems.value = []
    resetForegroundTree()
  })

  it('enables saved/open/pinned tab actions based on selected tab states', async () => {
    const saved = makeForegroundTab('tab-saved' as UID, {
      state: State.SAVED,
      pinned: false,
    })
    const open = makeForegroundTab('tab-open' as UID, {
      state: State.OPEN,
      pinned: true,
    })
    resetForegroundTree([
      makeForegroundWindow('window-1' as UID, [saved, open]),
    ])
    const indexedSaved = SessionTree.tabsByUid.get(saved.uid)!
    const indexedOpen = SessionTree.tabsByUid.get(open.uid)!
    Selection.selectedItems.value = [
      { item: indexedSaved, type: SelectionType.TAB },
      { item: indexedOpen, type: SelectionType.TAB },
    ]
    const { contextMenuItemsTab } =
      await import('@/services/context-menu-items-tab')

    expect(contextMenuItemsTab.openTab().enabled).toBe(true)
    expect(contextMenuItemsTab.reloadTab().enabled).toBe(true)
    expect(contextMenuItemsTab.saveTab().enabled).toBe(true)
    expect(contextMenuItemsTab.pinTab().enabled).toBe(true)
    expect(contextMenuItemsTab.unpinTab().enabled).toBe(true)
  })

  it('keeps reload disabled when every selected tab is saved', async () => {
    const saved = makeForegroundTab('tab-saved' as UID, {
      id: -1,
      state: State.SAVED,
    })
    Selection.selectedItems.value = [{ item: saved, type: SelectionType.TAB }]
    const { contextMenuItemsTab } =
      await import('@/services/context-menu-items-tab')

    const reload = contextMenuItemsTab.reloadTab()
    expect(reload.enabled).toBe(false)
  })

  it('applies each tab action descendant scope independently', async () => {
    const parent = makeForegroundTab('tab-parent' as UID, {
      state: State.OPEN,
      collapsed: true,
      isParent: true,
    })
    const child = makeForegroundTab('tab-child' as UID, {
      state: State.OPEN,
      parentUid: parent.uid,
      indentLevel: 2,
    })
    const window = makeForegroundWindow('window-1' as UID, [parent, child])
    resetForegroundTree([window])
    const indexedParent = SessionTree.tabsByUid.get(parent.uid)!
    indexedParent.selected = true
    Selection.selectedItems.value = [
      { item: indexedParent, type: SelectionType.TAB },
    ]
    Settings.values.contextMenuOpenDescendants = 'collapsed'
    Settings.values.contextMenuReloadDescendants = 'never'
    Settings.values.contextMenuSaveDescendants = 'collapsed'
    Settings.values.contextMenuPinDescendants = 'collapsed'
    const { contextMenuItemsTab } =
      await import('@/services/context-menu-items-tab')

    contextMenuItemsTab.openTab().action?.()
    contextMenuItemsTab.reloadTab().action?.()
    contextMenuItemsTab.saveTab().action?.()
    contextMenuItemsTab.pinTab().action?.()

    expect(openTabs).toHaveBeenCalledWith([
      expect.objectContaining({ uid: parent.uid }),
      expect.objectContaining({ uid: child.uid }),
    ])
    expect(reloadTabs).toHaveBeenCalledWith([
      expect.objectContaining({ uid: parent.uid }),
    ])
    expect(saveTabs).toHaveBeenCalledWith([
      expect.objectContaining({ uid: parent.uid }),
      expect.objectContaining({ uid: child.uid }),
    ])
    expect(pinTabs).toHaveBeenCalledWith([
      expect.objectContaining({ uid: parent.uid }),
      expect.objectContaining({ uid: child.uid }),
    ])
  })

  it('opens edit custom label modal only for a single selected tab', async () => {
    const tab = makeForegroundTab('tab-1' as UID, { customLabel: 'Label' })
    Selection.selectedItems.value = [{ item: tab, type: SelectionType.TAB }]
    const { contextMenuItemsTab } =
      await import('@/services/context-menu-items-tab')

    const item = contextMenuItemsTab.editLabel()
    item.action?.()

    expect(item.enabled).toBe(true)
    expect(openModal).toHaveBeenCalledWith({
      kind: 'editCustomLabel',
      uid: tab.uid,
      customLabel: 'Label',
    })
  })
})

describe('window context menu items', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    Selection.selectedItems.value = []
    resetForegroundTree()
  })

  it('enables save and close when at least one selected window is open', async () => {
    const saved = makeForegroundWindow('window-saved' as UID, [], {
      state: State.SAVED,
    })
    const open = makeForegroundWindow('window-open' as UID, [], {
      state: State.OPEN,
    })
    Selection.selectedItems.value = [
      { item: saved, type: SelectionType.WINDOW },
      { item: open, type: SelectionType.WINDOW },
    ]
    const { contextMenuItemsWindow } =
      await import('@/services/context-menu-items-window')

    expect(contextMenuItemsWindow.saveWindow().enabled).toBe(true)
  })

  it('dispatches window actions and opens edit title modal', async () => {
    const window = makeForegroundWindow('window-1' as UID, [], {
      state: State.OPEN,
    })
    Selection.selectedItems.value = [
      { item: window, type: SelectionType.WINDOW },
    ]
    const { contextMenuItemsWindow } =
      await import('@/services/context-menu-items-window')

    contextMenuItemsWindow.saveWindow().action?.()
    contextMenuItemsWindow.editWindowTitle().action?.()

    expect(saveWindows).toHaveBeenCalledWith([window])
    expect(openModal).toHaveBeenCalledWith({
      kind: 'editWindowTitle',
      window,
    })
  })
})
