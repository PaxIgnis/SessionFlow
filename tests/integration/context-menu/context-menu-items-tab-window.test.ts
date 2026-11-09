import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
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
const unloadTabs = vi.hoisted(() => vi.fn())
const saveTabs = vi.hoisted(() => vi.fn())
const pinTabs = vi.hoisted(() => vi.fn())
const unpinTabs = vi.hoisted(() => vi.fn())
const setTabsContainer = vi.hoisted(() => vi.fn())
const saveWindows = vi.hoisted(() => vi.fn())
const openWindows = vi.hoisted(() => vi.fn())
const openModal = vi.hoisted(() => vi.fn())
const showNotification = vi.hoisted(() => vi.fn())

vi.mock('@/services/notification-state', () => ({
  showNotification,
}))

vi.mock('@/services/foreground-messages', () => ({
  openWindows,
  openTabs,
  reloadTabs,
  unloadTabs,
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

  it('enables unload only when a selected tab can actually be unloaded', async () => {
    const select = (...tabs: ReturnType<typeof makeForegroundTab>[]) => {
      Selection.selectedItems.value = tabs.map((item) => ({
        item,
        type: SelectionType.TAB,
      }))
    }
    const saved = makeForegroundTab('saved' as UID, { state: State.SAVED })
    const discarded = makeForegroundTab('unloaded' as UID, {
      state: State.DISCARDED,
    })
    const active = makeForegroundTab('active' as UID, {
      state: State.OPEN,
      active: true,
    })
    const open = makeForegroundTab('open' as UID, { state: State.OPEN })
    resetForegroundTree([
      makeForegroundWindow('window-1' as UID, [saved, discarded, active, open]),
    ])
    const { contextMenuItemsTab } =
      await import('@/services/context-menu-items-tab')

    select(saved, discarded, active)
    expect(contextMenuItemsTab.unloadTab().enabled).toBe(false)

    select(saved, open)
    const unload = contextMenuItemsTab.unloadTab()
    expect(unload.enabled).toBe(true)
    unload.action?.()
    expect(unloadTabs).toHaveBeenCalledWith([
      expect.objectContaining({ uid: saved.uid }),
      expect.objectContaining({ uid: open.uid }),
    ])
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

  function selectWindows(
    ...windows: ReturnType<typeof makeForegroundWindow>[]
  ) {
    resetForegroundTree(windows)
    Selection.selectedItems.value = windows.map((window) => ({
      item: SessionTree.windowsByUid.get(window.uid)!,
      type: SelectionType.WINDOW,
    }))
  }

  it('opens only saved windows and is disabled when none are selected', async () => {
    const saved = makeForegroundWindow('window-saved' as UID, [], {
      state: State.SAVED,
    })
    const live = makeForegroundWindow('window-live' as UID, [], {
      state: State.OPEN,
    })
    const { contextMenuItemsWindow } =
      await import('@/services/context-menu-items-window')

    selectWindows(live)
    expect(contextMenuItemsWindow.openWindow().enabled).toBe(false)

    selectWindows(saved, live)
    const open = contextMenuItemsWindow.openWindow()
    expect(open.enabled).toBe(true)
    open.action?.()
    expect(openWindows).toHaveBeenCalledWith([
      expect.objectContaining({ uid: saved.uid }),
    ])
  })

  it('reloads and unloads every tab of the selected window, ignoring descendant scope', async () => {
    const tabs = [
      makeForegroundTab('tab-open' as UID, { state: State.OPEN }),
      makeForegroundTab('tab-unloaded' as UID, { state: State.DISCARDED }),
      makeForegroundTab('tab-saved' as UID, { state: State.SAVED }),
    ]
    selectWindows(
      makeForegroundWindow('window-1' as UID, tabs, { state: State.OPEN }),
    )
    Settings.values.contextMenuReloadDescendants = 'never'
    Settings.values.contextMenuUnloadDescendants = 'never'
    const { contextMenuItemsWindow } =
      await import('@/services/context-menu-items-window')
    const everyTab = tabs.map(({ uid }) => expect.objectContaining({ uid }))

    const reload = contextMenuItemsWindow.reloadWindow()
    expect(reload).toMatchObject({ id: 'reloadWindow', label: 'Reload tabs' })
    reload.action?.()
    expect(reloadTabs).toHaveBeenCalledWith(everyTab)

    const unload = contextMenuItemsWindow.unloadWindow()
    expect(unload).toMatchObject({ id: 'unloadWindow', label: 'Unload tabs' })
    unload.action?.()
    expect(unloadTabs).toHaveBeenCalledWith(everyTab)
  })

  it('disables reload and unload when no tab can be acted on', async () => {
    selectWindows(
      makeForegroundWindow(
        'window-1' as UID,
        [makeForegroundTab('tab-saved' as UID, { state: State.SAVED })],
        { state: State.SAVED },
      ),
    )
    const { contextMenuItemsWindow } =
      await import('@/services/context-menu-items-window')

    expect(contextMenuItemsWindow.reloadWindow().enabled).toBe(false)
    expect(contextMenuItemsWindow.unloadWindow().enabled).toBe(false)
  })

  it('creates a new tab in each selected live window only', async () => {
    const browser = installFakeBrowser()
    const saved = makeForegroundWindow('window-saved' as UID, [], {
      state: State.SAVED,
    })
    const live = makeForegroundWindow('window-live' as UID, [], {
      id: 42,
      state: State.OPEN,
    })
    const { contextMenuItemsWindow } =
      await import('@/services/context-menu-items-window')

    selectWindows(saved)
    expect(contextMenuItemsWindow.newTab().enabled).toBe(false)

    selectWindows(saved, live)
    const newTab = contextMenuItemsWindow.newTab()
    expect(newTab.enabled).toBe(true)
    newTab.action?.()
    expect(browser.tabs.create).toHaveBeenCalledOnce()
    expect(browser.tabs.create).toHaveBeenCalledWith({ windowId: 42 })
  })

  describe('copying URLs', () => {
    const urls = ['https://a.test/', 'https://b.test/']
    function selectWindowWithTabs() {
      selectWindows(
        makeForegroundWindow(
          'window-1' as UID,
          [
            makeForegroundTab('tab-a' as UID, {
              state: State.OPEN,
              url: urls[0],
            }),
            makeForegroundTab('tab-b' as UID, {
              state: State.SAVED,
              url: urls[1],
            }),
          ],
          { state: State.OPEN },
        ),
      )
    }

    afterEach(() => {
      vi.unstubAllGlobals()
    })

    it('copies open and saved tab URLs, one per line', async () => {
      const browser = installFakeBrowser()
      browser.permissions.request.mockResolvedValue(true)
      const writeText = vi.fn().mockResolvedValue(undefined)
      vi.stubGlobal('navigator', { clipboard: { writeText } })
      selectWindowWithTabs()
      const { contextMenuItemsWindow } =
        await import('@/services/context-menu-items-window')

      const copy = contextMenuItemsWindow.copyWindowUrls()
      expect(copy.enabled).toBe(true)
      copy.action?.()

      // The permission request must start inside the click gesture.
      expect(browser.permissions.request).toHaveBeenCalledWith({
        permissions: ['clipboardWrite'],
      })
      await vi.waitFor(() => {
        expect(writeText).toHaveBeenCalledWith(urls.join('\n'))
      })
      await vi.waitFor(() => {
        expect(showNotification).toHaveBeenCalledWith('URLs copied.')
      })
    })

    it('reports failure and writes nothing when permission is denied', async () => {
      const browser = installFakeBrowser()
      browser.permissions.request.mockResolvedValue(false)
      const consoleError = vi
        .spyOn(console, 'error')
        .mockImplementation(() => {})
      const writeText = vi.fn()
      vi.stubGlobal('navigator', { clipboard: { writeText } })
      selectWindowWithTabs()
      const { contextMenuItemsWindow } =
        await import('@/services/context-menu-items-window')

      contextMenuItemsWindow.copyWindowUrls().action?.()

      await vi.waitFor(() => {
        expect(showNotification).toHaveBeenCalledWith(
          'Session Flow could not copy the URLs.',
        )
      })
      expect(writeText).not.toHaveBeenCalled()
      consoleError.mockRestore()
    })

    it('is disabled for a window with no tabs', async () => {
      selectWindows(
        makeForegroundWindow('window-1' as UID, [], { state: State.OPEN }),
      )
      const { contextMenuItemsWindow } =
        await import('@/services/context-menu-items-window')

      expect(contextMenuItemsWindow.copyWindowUrls().enabled).toBe(false)
    })
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
