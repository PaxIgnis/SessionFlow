import { beforeEach, describe, expect, it, vi } from 'vitest'
import { DEFAULT_SETTINGS } from '@/defaults/settings'
import {
  handleCreatedTab,
  handleCreatedWindow,
  isTabRelocating,
} from '@/services/background-session-restore'
import { Settings } from '@/services/settings'
import { Tree } from '@/services/background-tree'
import { State } from '@/types/session-tree'
import { installFakeBrowser } from '../helpers/fake-browser'
import {
  createTab,
  createWindow,
  resetTree,
} from '../helpers/tree-fixtures'

function restoredTab(overrides: Partial<browser.tabs.Tab> = {}) {
  return {
    active: true,
    discarded: false,
    highlighted: true,
    id: 101,
    incognito: false,
    index: 0,
    pinned: false,
    status: 'complete',
    title: 'Restored',
    url: 'https://example.test/restored',
    windowId: 99,
    ...overrides,
  } as browser.tabs.Tab
}

describe('Firefox session restoration fallback', () => {
  beforeEach(() => {
    vi.restoreAllMocks()
    installFakeBrowser()
    resetTree()
    Object.assign(Settings.values, structuredClone(DEFAULT_SETTINGS))
  })

  it('leaves a saved tab untouched when browser placement fails before rebinding', async () => {
    const savedTab = createTab('tab-saved' as UID, {
      id: -1,
      state: State.SAVED,
    })
    createWindow('window-1' as UID, [savedTab], {
      id: 20,
      state: State.OPEN,
    })
    vi.mocked(browser.sessions.getTabValue).mockResolvedValue({
      version: 1,
      uid: savedTab.uid,
    })
    const error = new Error('move failed')
    vi.mocked(browser.tabs.move).mockRejectedValue(error)
    vi.spyOn(console, 'error').mockImplementation(() => {})

    await expect(handleCreatedTab(restoredTab())).resolves.toBe(false)

    expect(savedTab).toMatchObject({ id: -1, state: State.SAVED })
    expect(isTabRelocating(101)).toBe(false)
  })

  it('still restores a saved group when pin reconciliation fails', async () => {
    const savedTab = createTab('tab-saved' as UID, {
      id: -1,
      state: State.SAVED,
      pinned: true,
      tabGroup: {
        uid: 'group-1' as UID,
        id: -1,
        color: 'blue',
        collapsed: false,
      },
    })
    createWindow('window-1' as UID, [savedTab], {
      id: 20,
      state: State.OPEN,
    })
    vi.mocked(browser.sessions.getTabValue).mockResolvedValue({
      version: 1,
      uid: savedTab.uid,
    })
    const error = new Error('pin failed')
    vi.mocked(browser.tabs.update).mockRejectedValue(error)
    const restoreTabGroup = vi
      .spyOn(Tree, 'restoreTabGroup')
      .mockResolvedValue(undefined)
    vi.spyOn(console, 'error').mockImplementation(() => {})

    await expect(
      handleCreatedTab(restoredTab({ windowId: 20 })),
    ).resolves.toBe(true)

    expect(savedTab).toMatchObject({ id: 101, state: State.OPEN })
    expect(restoreTabGroup).toHaveBeenCalledWith(savedTab.uid)
  })

  it('keeps a restored window rebound when browser reordering fails', async () => {
    const first = createTab('tab-first' as UID, {
      id: -1,
      state: State.SAVED,
    })
    const second = createTab('tab-second' as UID, {
      id: -1,
      state: State.SAVED,
    })
    const savedWindow = createWindow('window-saved' as UID, [first, second], {
      id: -1,
      state: State.SAVED,
    })
    const browserTabs = [
      restoredTab({ id: 102, index: 0, windowId: 30 }),
      restoredTab({ id: 101, index: 1, windowId: 30 }),
    ]
    vi.mocked(browser.sessions.getWindowValue).mockResolvedValue({
      version: 1,
      uid: savedWindow.uid,
    })
    vi.mocked(browser.sessions.getTabValue).mockImplementation(
      async (tabId) => ({
        version: 1,
        uid: tabId === 101 ? first.uid : second.uid,
      }),
    )
    vi.mocked(browser.windows.get).mockResolvedValue({
      alwaysOnTop: false,
      id: 30,
      incognito: false,
      focused: true,
      tabs: browserTabs,
    })
    vi.mocked(browser.tabs.move).mockRejectedValue(new Error('move failed'))
    vi.spyOn(console, 'error').mockImplementation(() => {})

    await expect(
      handleCreatedWindow({ id: 30 } as browser.windows.Window),
    ).resolves.toBe(true)

    expect(savedWindow).toMatchObject({ id: 30, state: State.OPEN })
    expect(first).toMatchObject({ id: 101, state: State.OPEN })
    expect(second).toMatchObject({ id: 102, state: State.OPEN })
  })
})
