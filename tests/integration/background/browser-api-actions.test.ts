import { beforeEach, describe, expect, it, vi } from 'vitest'
import { OnCreatedQueue } from '@/services/background-on-created-queue'
import { Tree } from '@/services/background-tree'
import { State } from '@/types/session-tree'
import { installFakeBrowser } from '../../helpers/fake-browser'
import {
  createNote,
  createTab,
  createWindow,
  resetTree,
} from '../../helpers/tree-fixtures'
import { expectTreeInvariants } from '../../helpers/tree-invariants'

describe('background browser API interactions', () => {
  beforeEach(() => {
    vi.restoreAllMocks()
    installFakeBrowser()
    resetTree()
  })

  it('moves saved tabs in the tree without calling browser.tabs.move', async () => {
    const tab = createTab('tab-1' as UID, { state: State.SAVED })
    const note = createNote('note-1' as UID)
    const window = createWindow('window-1' as UID, [note, tab], {
      state: State.SAVED,
    })

    await Tree.moveTab(tab.uid, window.uid, 0, undefined, false, false)

    expect(browser.tabs.move).not.toHaveBeenCalled()
    expect(window.children.map((item) => item.uid)).toEqual([
      tab.uid,
      note.uid,
    ])
    expectTreeInvariants()
  })

  it('moves open tabs in the browser using an index that excludes notes', async () => {
    const note = createNote('note-1' as UID)
    const firstTab = createTab('tab-first' as UID, {
      id: 10,
      state: State.OPEN,
    })
    const movedTab = createTab('tab-moved' as UID, {
      id: 11,
      state: State.OPEN,
    })
    const window = createWindow(
      'window-1' as UID,
      [note, firstTab, movedTab],
      {
        id: 20,
        state: State.OPEN,
      },
    )
    vi.mocked(browser.tabs.move).mockResolvedValue({
      id: movedTab.id,
    } as browser.tabs.Tab)

    await Tree.moveTab(movedTab.uid, window.uid, 0, undefined, false, false)

    expect(browser.tabs.move).toHaveBeenCalledWith(movedTab.id, {
      windowId: window.id,
      index: 0,
    })
    expect(window.children.map((item) => item.uid)).toEqual([
      movedTab.uid,
      note.uid,
      firstTab.uid,
    ])
    expectTreeInvariants()
  })

  it('does not call browser.tabs.remove when closing a saved tab id', () => {
    const tab = createTab('tab-1' as UID, { id: -1, state: State.SAVED })
    const note = createNote('note-1' as UID)
    const window = createWindow('window-1' as UID, [tab, note])

    Tree.closeTab({ tabId: -1, tabUid: tab.uid })

    expect(browser.tabs.remove).not.toHaveBeenCalled()
    expect(window.children.map((item) => item.uid)).toEqual([note.uid])
    expectTreeInvariants()
  })

  it('removes a saved single-tab window once when closing its saved tab', () => {
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {})
    const tab = createTab('tab-1' as UID, { id: -1, state: State.SAVED })
    const window = createWindow('window-1' as UID, [tab], {
      id: -1,
      state: State.SAVED,
    })

    Tree.closeTab({ tabId: -1, tabUid: tab.uid })

    expect(Tree.tabsByUid.has(tab.uid)).toBe(false)
    expect(Tree.windowsByUid.has(window.uid)).toBe(false)
    expect(browser.tabs.remove).not.toHaveBeenCalled()
    expect(consoleError).not.toHaveBeenCalledWith(
      `Error Removing Window ${window.uid} from sessionTree`,
    )
    expectTreeInvariants()
  })

  it('clears active state when saving the only open tab in an active window', () => {
    const tab = createTab('tab-1' as UID, {
      active: true,
      id: 10,
      state: State.OPEN,
    })
    const window = createWindow('window-1' as UID, [tab], {
      active: true,
      activeTabId: tab.id,
      id: 20,
      state: State.OPEN,
    })

    Tree.saveTab({ tabId: tab.id, tabUid: tab.uid })

    expect(window.state).toBe(State.SAVED)
    expect(window.id).toBe(-1)
    expect(window.active).toBe(false)
    expect(window.activeTabId).toBeUndefined()
    expect(tab.state).toBe(State.SAVED)
    expect(tab.active).toBe(false)
    expect(browser.tabs.remove).toHaveBeenCalledWith(10)
    expectTreeInvariants()
  })

  it('removes a saved note-only window from the tree without calling browser.windows.remove', () => {
    const note = createNote('note-1' as UID)
    const childNote = createNote('note-child' as UID, {
      parentUid: note.uid,
      indentLevel: 2,
    })
    const window = createWindow('window-1' as UID, [note, childNote], {
      id: -1,
      state: State.SAVED,
    })

    Tree.closeWindow({ windowId: -1, windowUid: window.uid })

    expect(browser.windows.remove).not.toHaveBeenCalled()
    expect(Tree.windowsByUid.has(window.uid)).toBe(false)
    expect(Tree.notesByUid.has(note.uid)).toBe(false)
    expect(Tree.notesByUid.has(childNote.uid)).toBe(false)
    expectTreeInvariants()
  })

  it('removes an open note-only window from the tree and closes the browser window', async () => {
    const note = createNote('note-1' as UID)
    const window = createWindow('window-1' as UID, [note], {
      id: 20,
      state: State.OPEN,
    })
    vi.mocked(browser.windows.get).mockResolvedValue({
      id: window.id,
    } as browser.windows.Window)

    Tree.closeWindow({ windowId: window.id, windowUid: window.uid })

    expect(Tree.windowsByUid.has(window.uid)).toBe(false)
    expect(Tree.notesByUid.has(note.uid)).toBe(false)
    await vi.waitFor(() => {
      expect(browser.windows.remove).toHaveBeenCalledWith(window.id)
    })
    expectTreeInvariants()
  })

  it('keeps tree state consistent when browser tab move rejects', async () => {
    const firstTab = createTab('tab-first' as UID, {
      id: 10,
      state: State.OPEN,
    })
    const movedTab = createTab('tab-moved' as UID, {
      id: 11,
      state: State.OPEN,
    })
    const window = createWindow('window-1' as UID, [firstTab, movedTab], {
      id: 20,
      state: State.OPEN,
    })
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {})
    vi.mocked(browser.tabs.move).mockRejectedValue(new Error('move failed'))

    await Tree.moveTab(movedTab.uid, window.uid, 0, undefined, false, false)

    expect(consoleError).toHaveBeenCalledWith(
      'Error moving tab in browser:',
      expect.any(Error),
    )
    expect(window.children.map((item) => item.uid)).toEqual([
      movedTab.uid,
      firstTab.uid,
    ])
    expectTreeInvariants()
  })

  it.each([
    {
      scenario: 'rejects',
      setupCreateWindow: () => {
        const error = new Error('create failed')
        vi.spyOn(OnCreatedQueue, 'createWindowAndWait').mockRejectedValue(error)
        return error
      },
      expectedLog: 'Error creating window:',
    },
    {
      scenario: 'returns undefined',
      setupCreateWindow: () => {
        vi.spyOn(OnCreatedQueue, 'createWindowAndWait').mockResolvedValue(
          undefined as unknown as browser.windows.Window,
        )
        return undefined
      },
      expectedLog: 'Window is undefined',
    },
  ])(
    'rolls back saved tab and window state when opening a saved tab $scenario',
    async ({ setupCreateWindow, expectedLog }) => {
      const tab = createTab('tab-1' as UID, {
        id: -1,
        state: State.SAVED,
        url: 'https://example.test/saved-tab',
      })
      const window = createWindow('window-1' as UID, [tab], {
        id: -1,
        state: State.SAVED,
      })
      const loggedError = setupCreateWindow()
      const consoleError = vi
        .spyOn(console, 'error')
        .mockImplementation(() => {})

      await Tree.openTab({
        tabUid: tab.uid,
        windowUid: window.uid,
      })

      expect(OnCreatedQueue.createWindowAndWait).toHaveBeenCalledWith({
        url: tab.url,
      })
      if (loggedError) {
        expect(consoleError).toHaveBeenCalledWith(expectedLog, loggedError)
      } else {
        expect(consoleError).toHaveBeenCalledWith(expectedLog)
      }
      expect(window.state).toBe(State.SAVED)
      expect(window.id).toBe(-1)
      expect(tab.state).toBe(State.SAVED)
      expect(tab.id).toBe(-1)
      expect(browser.windows.create).not.toHaveBeenCalled()
      expect(browser.tabs.create).not.toHaveBeenCalled()
      expectTreeInvariants()
    },
  )
})
