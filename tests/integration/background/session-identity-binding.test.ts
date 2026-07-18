import { beforeEach, describe, expect, it, vi } from 'vitest'
import {
  TAB_UID_SESSION_KEY,
  WINDOW_UID_SESSION_KEY,
} from '@/services/background-session-identity'
import { stampOpenTreeIdentities } from '@/services/background-session-restore'
import { Tree } from '@/services/background-tree'
import { State } from '@/types/session-tree'
import { installFakeBrowser } from '../../helpers/fake-browser'
import {
  createTab,
  createWindow,
  resetTree,
} from '../../helpers/tree-fixtures'

describe('session identity binding', () => {
  beforeEach(() => {
    installFakeBrowser()
    resetTree()
  })

  it('stamps an identity when adding a live tab', async () => {
    const window = createWindow('window-1' as UID, [], {
      id: 20,
      state: State.OPEN,
    })

    const tabUid = Tree.addTab(
      false,
      window.uid,
      10,
      false,
      State.OPEN,
      'Tab',
      'https://example.test/tab',
      false,
    )

    await vi.waitFor(() => {
      expect(browser.sessions.setTabValue).toHaveBeenCalledWith(
        10,
        TAB_UID_SESSION_KEY,
        { version: 1, uid: tabUid },
      )
    })
  })

  it('stamps identities when browser IDs are rebound', async () => {
    const tab = createTab('tab-1' as UID, { id: -1, state: State.SAVED })
    const window = createWindow('window-1' as UID, [tab], {
      id: -1,
      state: State.SAVED,
    })

    Tree.updateTabId(tab.uid, 11)
    Tree.updateWindowId(window.uid, 21)

    await vi.waitFor(() => {
      expect(browser.sessions.setTabValue).toHaveBeenCalledWith(
        11,
        TAB_UID_SESSION_KEY,
        { version: 1, uid: tab.uid },
      )
      expect(browser.sessions.setWindowValue).toHaveBeenCalledWith(
        21,
        WINDOW_UID_SESSION_KEY,
        { version: 1, uid: window.uid },
      )
    })
  })

  it('repairs identities for browser-backed startup items only', async () => {
    const openTab = createTab('tab-open' as UID, {
      id: 10,
      state: State.OPEN,
    })
    const discardedTab = createTab('tab-discarded' as UID, {
      id: 11,
      state: State.DISCARDED,
    })
    const savedTab = createTab('tab-saved' as UID, {
      id: -1,
      state: State.SAVED,
    })
    const openWindow = createWindow(
      'window-open' as UID,
      [openTab, discardedTab, savedTab],
      { id: 20, state: State.OPEN },
    )
    createWindow('window-saved' as UID, [], {
      id: -1,
      state: State.SAVED,
    })

    await stampOpenTreeIdentities()

    expect(browser.sessions.setWindowValue).toHaveBeenCalledTimes(1)
    expect(browser.sessions.setWindowValue).toHaveBeenCalledWith(
      20,
      WINDOW_UID_SESSION_KEY,
      { version: 1, uid: openWindow.uid },
    )
    expect(browser.sessions.setTabValue).toHaveBeenCalledTimes(2)
    expect(browser.sessions.setTabValue).toHaveBeenCalledWith(
      10,
      TAB_UID_SESSION_KEY,
      { version: 1, uid: openTab.uid },
    )
    expect(browser.sessions.setTabValue).toHaveBeenCalledWith(
      11,
      TAB_UID_SESSION_KEY,
      { version: 1, uid: discardedTab.uid },
    )
  })

  it('stamps child identities when adding a populated browser window', async () => {
    vi.mocked(browser.windows.get).mockResolvedValue({
      alwaysOnTop: false,
      id: 20,
      focused: true,
      incognito: false,
      tabs: [
        {
          active: true,
          discarded: false,
          highlighted: true,
          id: 10,
          incognito: false,
          index: 0,
          pinned: false,
          title: 'Window tab',
          url: 'https://example.test/window-tab',
          windowId: 20,
        } as browser.tabs.Tab,
      ],
    })

    await Tree.addWindow(20)

    const window = [...Tree.windowsByUid.values()][0]
    const tab = Tree.getTabs(window.children)[0]
    await vi.waitFor(() => {
      expect(browser.sessions.setWindowValue).toHaveBeenCalledWith(
        20,
        WINDOW_UID_SESSION_KEY,
        { version: 1, uid: window.uid },
      )
      expect(browser.sessions.setTabValue).toHaveBeenCalledWith(
        10,
        TAB_UID_SESSION_KEY,
        { version: 1, uid: tab.uid },
      )
    })
  })
})
