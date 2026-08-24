import { beforeEach, describe, expect, it } from 'vitest'
import { Tree } from '@/services/background-tree'
import { State } from '@/types/session-tree'
import { createTab, createWindow, resetTree } from '../helpers/tree-fixtures'
import { installFakeBrowser } from '../helpers/fake-browser'

/*
 * openTab publishes a tab as open before Firefox hands back its id, so a tab
 * command issued in that window carries the saved-tab sentinel (-1). Tab
 * commands are serialized per tab uid, so by the time one runs the tree already
 * holds the real id. They used to act on the id the sender captured: close and
 * save skipped the browser entirely, leaving the Firefox tab open but no longer
 * in the session tree, while focus and reload rejected against tab -1.
 *
 * The reachable gesture is a double click on a saved tab followed by a second
 * one before the open lands: the row already reads OPEN, so tabDoubleClick
 * takes the open-tab branch and fires the configured action against the
 * sentinel.
 */
describe('tab commands carrying a stale tab id', () => {
  beforeEach(() => {
    installFakeBrowser()
    resetTree()
  })

  it('closes the tab Firefox actually opened, not the sentinel the sender sent', async () => {
    const tab = createTab('tab-open' as UID, { id: 4, state: State.OPEN })
    createWindow('window-1' as UID, [tab], { id: 20, state: State.OPEN })

    await Tree.closeTab({ tabId: -1, tabUid: tab.uid })

    expect(browser.tabs.remove).toHaveBeenCalledWith(4)
    expect(Tree.tabsByUid.has(tab.uid)).toBe(false)
  })

  it('saves the tab Firefox actually opened, not the sentinel the sender sent', async () => {
    const tab = createTab('tab-open' as UID, { id: 4, state: State.OPEN })
    const other = createTab('tab-other' as UID, { id: 5, state: State.OPEN })
    createWindow('window-1' as UID, [tab, other], {
      id: 20,
      state: State.OPEN,
    })

    await Tree.saveTab({ tabId: -1, tabUid: tab.uid })

    expect(browser.tabs.remove).toHaveBeenCalledWith(4)
    expect(Tree.tabsByUid.get(tab.uid)?.state).toBe(State.SAVED)
    expect(Tree.tabsByUid.get(tab.uid)?.id).toBe(-1)
  })

  it('clears the active tab marker using the resolved id', async () => {
    const tab = createTab('tab-open' as UID, { id: 4, state: State.OPEN })
    const other = createTab('tab-other' as UID, { id: 5, state: State.OPEN })
    const window = createWindow('window-1' as UID, [tab, other], {
      id: 20,
      state: State.OPEN,
      activeTabId: 4,
    })

    await Tree.closeTab({ tabId: -1, tabUid: tab.uid })

    expect(window.activeTabId).toBeUndefined()
  })

  it('still leaves Firefox alone when the tab really is saved', async () => {
    const tab = createTab('tab-saved' as UID, { id: -1, state: State.SAVED })
    const other = createTab('tab-other' as UID, { id: 5, state: State.OPEN })
    createWindow('window-1' as UID, [tab, other], {
      id: 20,
      state: State.OPEN,
    })

    await Tree.closeTab({ tabId: -1, tabUid: tab.uid })

    expect(browser.tabs.remove).not.toHaveBeenCalled()
    expect(Tree.tabsByUid.has(tab.uid)).toBe(false)
  })

  it('falls back to the requested id when the tree item has no live id', async () => {
    const tab = createTab('tab-open' as UID, { id: -1, state: State.OPEN })
    const other = createTab('tab-other' as UID, { id: 5, state: State.OPEN })
    createWindow('window-1' as UID, [tab, other], {
      id: 20,
      state: State.OPEN,
    })

    await Tree.closeTab({ tabId: 7, tabUid: tab.uid })

    expect(browser.tabs.remove).toHaveBeenCalledWith(7)
  })

  it('uses the sent id unchanged when it already matches the tree', async () => {
    const tab = createTab('tab-open' as UID, { id: 4, state: State.OPEN })
    createWindow('window-1' as UID, [tab], { id: 20, state: State.OPEN })

    await Tree.closeTab({ tabId: 4, tabUid: tab.uid })

    expect(browser.tabs.remove).toHaveBeenCalledExactlyOnceWith(4)
  })

  it('resolves the live id for focus and reload targets', () => {
    const tab = createTab('tab-open' as UID, { id: 4, state: State.OPEN })
    createWindow('window-1' as UID, [tab], { id: 20, state: State.OPEN })

    expect(Tree.resolveTabId(tab.uid, -1)).toBe(4)
    expect(Tree.resolveTabId(tab.uid, 0)).toBe(4)
    expect(Tree.resolveTabId(tab.uid, 4)).toBe(4)
  })

  it('falls back to the requested id for an unknown or idless tab', () => {
    const tab = createTab('tab-saved' as UID, { id: -1, state: State.SAVED })
    createWindow('window-1' as UID, [tab], { id: 20, state: State.OPEN })

    expect(Tree.resolveTabId(tab.uid, 7)).toBe(7)
    expect(Tree.resolveTabId('tab-missing' as UID, 7)).toBe(7)
  })
})
