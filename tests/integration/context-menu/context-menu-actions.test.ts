import { beforeEach, describe, expect, it, vi } from 'vitest'
import { ContextMenu } from '@/services/context-menu'
import {
  createContextMenu,
  createContextMenuItems,
  handleContextMenuClick,
  open,
} from '@/services/context-menu-actions'
import { Selection } from '@/services/selection'
import {
  ContextMenuConfig,
  ContextMenuItem,
  ContextMenuItemType,
  ContextMenuType,
} from '@/types/context-menu'
import { SelectionType, State } from '@/types/session-tree'
import { installFakeBrowser } from '../../helpers/fake-browser'
import { makeForegroundTab } from '../../helpers/foreground-tree-fixtures'

const openTabs = vi.hoisted(() => vi.fn())
const reloadTabs = vi.hoisted(() => vi.fn())
const saveTabs = vi.hoisted(() => vi.fn())
const closeTabs = vi.hoisted(() => vi.fn())
const duplicateTabs = vi.hoisted(() => vi.fn())
const pinTabs = vi.hoisted(() => vi.fn())
const unpinTabs = vi.hoisted(() => vi.fn())
const tabIndentIncrease = vi.hoisted(() => vi.fn())
const tabIndentDecrease = vi.hoisted(() => vi.fn())
const createNote = vi.hoisted(() => vi.fn())
const openModal = vi.hoisted(() => vi.fn())

vi.mock('@/services/foreground-messages', () => ({
  openTabs,
  reloadTabs,
  saveTabs,
  closeTabs,
  duplicateTabs,
  pinTabs,
  unpinTabs,
  tabIndentIncrease,
  tabIndentDecrease,
  createNote,
}))

vi.mock('@/services/modal-state', () => ({
  openModal,
}))

describe('context menu actions', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    installFakeBrowser()
    Selection.selectedItems.value = []
  })

  it('maps action config entries and skips missing or unsupported entries', () => {
    const config: ContextMenuConfig = [
      { type: ContextMenuItemType.Action, id: 'openTab' },
      { type: ContextMenuItemType.Action, id: 'missingAction' },
      { type: ContextMenuItemType.Separator, id: 'separator' },
      {
        type: ContextMenuItemType.Submenu,
        id: 'submenu',
        items: [{ type: ContextMenuItemType.Action, id: 'reloadTab' }],
      },
    ]

    const items = createContextMenuItems(config)

    expect(items).toHaveLength(1)
    expect(items[0]).toMatchObject({
      id: 'openTab',
    })
    expect(items[0].action).toEqual(expect.any(Function))
  })

  it('creates enabled and disabled browser menu entries and clears selection after click', () => {
    const selectedTab = makeForegroundTab('selected-tab' as UID)
    selectedTab.selected = true
    Selection.selectedItems.value = [
      { item: selectedTab, type: SelectionType.TAB },
    ]
    const enabledAction = vi.fn()
    const disabledAction = vi.fn()
    const items: ContextMenuItem[] = [
      { id: 'enabled', label: 'Enabled action', action: enabledAction },
      {
        id: 'disabled',
        label: 'Disabled action',
        enabled: false,
        action: disabledAction,
      },
    ]

    createContextMenu(items)

    expect(browser.menus.create).toHaveBeenCalledTimes(2)
    expect(browser.menus.create).toHaveBeenNthCalledWith(
      1,
      expect.objectContaining({
        type: 'normal',
        title: 'Enabled action',
        contexts: ['all'],
      }),
    )
    expect(browser.menus.create).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({
        type: 'normal',
        title: 'Disabled action',
        contexts: ['all'],
        enabled: false,
      }),
    )

    const firstCreateCall = vi.mocked(browser.menus.create).mock.calls[0][0]
    firstCreateCall.onclick?.(
      {} as browser.menus.OnClickData,
      {} as browser.tabs.Tab,
    )

    expect(enabledAction).toHaveBeenCalledTimes(1)
    expect(Selection.selectedItems.value).toEqual([])
    expect(selectedTab.selected).toBe(false)
  })

  it('opens a tab context menu by overriding defaults, clearing old items, and creating configured items', () => {
    const tab = makeForegroundTab('tab-open' as UID, {
      state: State.OPEN,
      pinned: false,
    })
    Selection.selectedItems.value = [{ item: tab, type: SelectionType.TAB }]

    open(ContextMenuType.Tab)

    expect(browser.menus.overrideContext).toHaveBeenCalledWith({
      showDefaults: false,
    })
    expect(browser.menus.removeAll).toHaveBeenCalledTimes(1)
    expect(browser.menus.create).toHaveBeenCalled()
    const createdTitles = vi
      .mocked(browser.menus.create)
      .mock.calls.map(([properties]) => properties.title)
    expect(createdTitles).toContain('Open')
    expect(createdTitles).toContain('Close')
    expect(browser.menus.create).toHaveBeenCalledWith(
      expect.objectContaining({
        title: 'Open',
        enabled: false,
      }),
    )
  })

  it('selects the right-clicked tab and opens its browser menu', () => {
    const tab = makeForegroundTab('tab-context' as UID, {
      state: State.OPEN,
    })

    handleContextMenuClick(
      ContextMenuType.Tab,
      { ctrlKey: false, metaKey: false } as MouseEvent,
      undefined,
      tab,
    )

    expect(Selection.selectedItems.value).toEqual([
      { item: tab, type: SelectionType.TAB },
    ])
    expect(tab.selected).toBe(true)
    expect(browser.menus.create).toHaveBeenCalled()
  })

  it('logs overrideContext failures without preventing menu clear or creation', () => {
    const error = new Error('override unavailable')
    vi.mocked(browser.menus.overrideContext).mockImplementation(() => {
      throw error
    })
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {})
    const tab = makeForegroundTab('tab-open' as UID, {
      state: State.OPEN,
    })
    Selection.selectedItems.value = [{ item: tab, type: SelectionType.TAB }]

    try {
      open(ContextMenuType.Tab)

      expect(consoleError).toHaveBeenCalledWith(
        'Error overriding context menu:',
        error,
      )
      expect(browser.menus.removeAll).toHaveBeenCalledTimes(1)
      expect(browser.menus.create).toHaveBeenCalled()
    } finally {
      consoleError.mockRestore()
    }
  })

  it('clears old browser items but creates nothing when a context type has no mapped items', () => {
    const originalConfig = ContextMenu.panelConfig
    ContextMenu.panelConfig = [
      { type: ContextMenuItemType.Action, id: 'missingPanelAction' },
    ]

    try {
      open(ContextMenuType.Panel)

      expect(browser.menus.removeAll).toHaveBeenCalledTimes(1)
      expect(browser.menus.create).not.toHaveBeenCalled()
    } finally {
      ContextMenu.panelConfig = originalConfig
    }
  })
})
