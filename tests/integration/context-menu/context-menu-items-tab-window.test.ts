import { beforeEach, describe, expect, it, vi } from 'vitest'
import { Selection } from '@/services/selection'
import { SelectionType, State } from '@/types/session-tree'
import {
  makeForegroundTab,
  makeForegroundWindow,
} from '../../helpers/foreground-tree-fixtures'

const duplicateTabs = vi.hoisted(() => vi.fn())
const openTabs = vi.hoisted(() => vi.fn())
const reloadTabs = vi.hoisted(() => vi.fn())
const saveTabs = vi.hoisted(() => vi.fn())
const closeTabs = vi.hoisted(() => vi.fn())
const pinTabs = vi.hoisted(() => vi.fn())
const unpinTabs = vi.hoisted(() => vi.fn())
const tabIndentIncrease = vi.hoisted(() => vi.fn())
const saveWindows = vi.hoisted(() => vi.fn())
const closeWindows = vi.hoisted(() => vi.fn())
const openModal = vi.hoisted(() => vi.fn())

vi.mock('@/services/foreground-messages', () => ({
  duplicateTabs,
  openTabs,
  reloadTabs,
  saveTabs,
  closeTabs,
  pinTabs,
  unpinTabs,
  tabIndentIncrease,
  tabIndentDecrease: vi.fn(),
  saveWindows,
  closeWindows,
}))

vi.mock('@/services/modal-state', () => ({
  openModal,
}))

describe('tab context menu items', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    Selection.selectedItems.value = []
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
    Selection.selectedItems.value = [
      { item: saved, type: SelectionType.TAB },
      { item: open, type: SelectionType.TAB },
    ]
    const { contextMenuItemsTab } = await import(
      '@/services/context-menu-items-tab'
    )

    expect(contextMenuItemsTab.openTab().enabled).toBe(true)
    expect(contextMenuItemsTab.reloadTab().enabled).toBe(true)
    expect(contextMenuItemsTab.saveTab().enabled).toBe(true)
    expect(contextMenuItemsTab.closeTab().enabled).toBe(true)
    expect(contextMenuItemsTab.pinTab().enabled).toBe(true)
    expect(contextMenuItemsTab.unpinTab().enabled).toBe(true)
  })

  it('dispatches tab actions with selected tabs', async () => {
    const tab = makeForegroundTab('tab-1' as UID)
    Selection.selectedItems.value = [{ item: tab, type: SelectionType.TAB }]
    const { contextMenuItemsTab } = await import(
      '@/services/context-menu-items-tab'
    )

    contextMenuItemsTab.duplicateTab().action?.()
    contextMenuItemsTab.tabIndentIncrease().action?.()

    expect(duplicateTabs).toHaveBeenCalledWith([tab])
    expect(tabIndentIncrease).toHaveBeenCalledWith([tab])
  })

  it('opens edit custom label modal only for a single selected tab', async () => {
    const tab = makeForegroundTab('tab-1' as UID, { customLabel: 'Label' })
    Selection.selectedItems.value = [{ item: tab, type: SelectionType.TAB }]
    const { contextMenuItemsTab } = await import(
      '@/services/context-menu-items-tab'
    )

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
    const { contextMenuItemsWindow } = await import(
      '@/services/context-menu-items-window'
    )

    expect(contextMenuItemsWindow.saveWindow().enabled).toBe(true)
    expect(contextMenuItemsWindow.closeWindow().enabled).toBe(true)
  })

  it('dispatches window actions and opens edit title modal', async () => {
    const window = makeForegroundWindow('window-1' as UID, [], {
      state: State.OPEN,
    })
    Selection.selectedItems.value = [
      { item: window, type: SelectionType.WINDOW },
    ]
    const { contextMenuItemsWindow } = await import(
      '@/services/context-menu-items-window'
    )

    contextMenuItemsWindow.saveWindow().action?.()
    contextMenuItemsWindow.closeWindow().action?.()
    contextMenuItemsWindow.editWindowTitle().action?.()

    expect(saveWindows).toHaveBeenCalledWith([window])
    expect(closeWindows).toHaveBeenCalledWith([window])
    expect(openModal).toHaveBeenCalledWith({
      kind: 'editWindowTitle',
      window,
    })
  })
})
