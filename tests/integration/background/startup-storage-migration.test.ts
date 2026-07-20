import { beforeEach, describe, expect, it, vi } from 'vitest'
import { STORAGE_KEY } from '@/defaults/constants'
import { DEFAULT_SETTINGS } from '@/defaults/settings'
import { Settings } from '@/services/settings'
import { Tree } from '@/services/background-tree'
import { State, TreeItemType } from '@/types/session-tree'
import { installFakeBrowser } from '../../helpers/fake-browser'
import {
  liveTab,
  liveWindow,
  mockStoredTree,
} from '../../helpers/startup-fixtures'
import { resetTree } from '../../helpers/tree-fixtures'
import { expectTreeInvariants } from '../../helpers/tree-invariants'

describe('startup storage migration', () => {
  beforeEach(() => {
    vi.restoreAllMocks()
    installFakeBrowser()
    resetTree()
    Object.assign(Settings.values, structuredClone(DEFAULT_SETTINGS), {
      matchOpenedWindowsWithSavedWindowsOnStartup: true,
      restorePreviousSessionOnStartup: true,
    })
    vi.mocked(browser.windows.getAll).mockResolvedValue([])
  })

  it.each([null, {}, 'tree', 42])(
    'ST-14 ignores malformed session-tree root %j without retaining corrupt indexes',
    async (storedValue) => {
      mockStoredTree(storedValue)
      vi.mocked(browser.windows.getAll).mockResolvedValue([
        liveWindow(90, [liveTab(91, 90, 0)]),
      ])

      await Tree.initializeWindows()

      expect(Tree.Items.filter(Tree.isWindow)).toHaveLength(1)
      expect(Tree.Items.filter(Tree.isWindow)[0].id).toBe(90)
      expect(Tree.tabsByUid.size).toBe(1)
      expectTreeInvariants()
    },
  )

  it('ST-14 drops invalid records and repairs invalid primitive fields', async () => {
    mockStoredTree([
      null,
      'not-an-item',
      { type: 99, uid: 'unknown' },
      {
        type: TreeItemType.WINDOW,
        uid: 'window-valid',
        id: 'invalid',
        incognito: 'invalid',
        selected: 'invalid',
        state: 'invalid',
        indentLevel: 'invalid',
        children: [
          17,
          { type: 88, uid: 'unknown-child' },
          {
            type: TreeItemType.TAB,
            uid: 'tab-valid',
            id: 'invalid',
            state: 'invalid',
            title: 42,
            url: null,
            pinned: 'invalid',
            selected: 'invalid',
            indentLevel: 'invalid',
          },
        ],
      },
    ])

    await Tree.initializeWindows()

    expect(Tree.Items).toHaveLength(1)
    expect(Tree.windowsByUid.get('window-valid' as UID)).toMatchObject({
      id: 0,
      incognito: false,
      selected: false,
      state: State.SAVED,
    })
    expect(Tree.tabsByUid.get('tab-valid' as UID)).toMatchObject({
      id: 0,
      state: State.SAVED,
      title: 'Untitled',
      url: '',
      pinned: false,
      selected: false,
      windowUid: 'window-valid',
    })
    expect(Tree.tabsByUid.size).toBe(1)
    expectTreeInvariants()
  })

  it('ST-15 migrates legacy windows, tabs, notes, and separators with missing fields', async () => {
    mockStoredTree([
      {
        type: TreeItemType.WINDOW,
        state: State.OPEN,
        children: [
          {
            type: TreeItemType.TAB,
            state: State.OPEN,
            title: 'Legacy tab',
            url: 'https://example.test/legacy',
          },
          {
            type: TreeItemType.NOTE,
            text: 'Legacy note',
          },
          {
            type: TreeItemType.SEPARATOR,
          },
        ],
      },
    ])
    const openTab = vi.spyOn(Tree, 'openTab').mockResolvedValue(undefined)

    await Tree.initializeWindows()

    const window = Tree.Items.find(Tree.isWindow)!
    const [tab] = Tree.getTabs(window.children)
    const note = window.children.find(Tree.isNote)
    const separator = window.children.find(Tree.isSeparator)
    expect(window.uid).toBeTruthy()
    expect(window.incognito).toBe(false)
    expect(tab.uid).toBeTruthy()
    expect(tab.windowUid).toBe(window.uid)
    expect(tab.pinned).toBe(false)
    expect(note).toMatchObject({
      text: 'Legacy note',
      selected: false,
      windowUid: window.uid,
    })
    expect(note?.uid).toBeTruthy()
    expect(separator).toMatchObject({
      selected: false,
      windowUid: window.uid,
      isParent: false,
      collapsed: false,
    })
    expect(separator?.uid).toBeTruthy()
    expect(openTab).toHaveBeenCalledWith(
      expect.objectContaining({ tabUid: tab.uid, windowUid: window.uid }),
    )
    expectTreeInvariants()
  })

  it('ST-16 regenerates duplicate item UIDs without dropping either item', async () => {
    mockStoredTree([
      {
        type: TreeItemType.WINDOW,
        uid: 'window-duplicate-test',
        state: State.SAVED,
        children: [
          {
            type: TreeItemType.TAB,
            uid: 'duplicate-uid',
            state: State.SAVED,
            title: 'First duplicate',
            url: 'https://example.test/first-duplicate',
          },
          {
            type: TreeItemType.NOTE,
            uid: 'duplicate-uid',
            text: 'Second duplicate',
          },
        ],
      },
    ])

    await Tree.initializeWindows()

    const window = Tree.windowsByUid.get('window-duplicate-test' as UID)!
    expect(window.children).toHaveLength(2)
    expect(new Set(window.children.map((item) => item.uid)).size).toBe(2)
    expect(window.children.some((item) => item.uid === 'duplicate-uid')).toBe(
      true,
    )
    expect(window.children.find(Tree.isTab)?.title).toBe('First duplicate')
    expect(window.children.find(Tree.isNote)?.text).toBe('Second duplicate')
    expectTreeInvariants()
  })

  it('ST-17 removes missing, cross-window, self, and cyclic parent links', async () => {
    mockStoredTree([
      {
        type: TreeItemType.WINDOW,
        uid: 'window-a',
        state: State.SAVED,
        children: [
          {
            type: TreeItemType.TAB,
            uid: 'tab-a',
            state: State.SAVED,
            title: 'A',
            url: 'https://example.test/a',
            parentUid: 'tab-b',
          },
          {
            type: TreeItemType.TAB,
            uid: 'tab-b',
            state: State.SAVED,
            title: 'B',
            url: 'https://example.test/b',
            parentUid: 'tab-a',
          },
          {
            type: TreeItemType.NOTE,
            uid: 'note-missing-parent',
            text: 'Missing parent',
            parentUid: 'does-not-exist',
          },
          {
            type: TreeItemType.NOTE,
            uid: 'note-self-parent',
            text: 'Self parent',
            parentUid: 'note-self-parent',
          },
        ],
      },
      {
        type: TreeItemType.WINDOW,
        uid: 'window-b',
        state: State.SAVED,
        children: [
          {
            type: TreeItemType.TAB,
            uid: 'tab-cross-window',
            state: State.SAVED,
            title: 'Cross-window parent',
            url: 'https://example.test/cross-window',
            parentUid: 'tab-a',
          },
        ],
      },
    ])

    await Tree.initializeWindows()

    expect(Tree.tabsByUid.get('tab-cross-window' as UID)?.parentUid).toBe(
      undefined,
    )
    expect(Tree.notesByUid.get('note-missing-parent' as UID)?.parentUid).toBe(
      undefined,
    )
    expect(Tree.notesByUid.get('note-self-parent' as UID)?.parentUid).toBe(
      undefined,
    )
    const tabA = Tree.tabsByUid.get('tab-a' as UID)!
    const tabB = Tree.tabsByUid.get('tab-b' as UID)!
    expect(tabA.parentUid === undefined || tabB.parentUid === undefined).toBe(
      true,
    )
    expectTreeInvariants()
  })

  it('ST-25 preserves pre-tab-group data without fabricating group metadata', async () => {
    mockStoredTree([
      {
        type: TreeItemType.WINDOW,
        uid: 'window-pre-groups',
        state: State.SAVED,
        children: [
          {
            type: TreeItemType.TAB,
            uid: 'tab-pre-groups',
            state: State.SAVED,
            title: 'Pre-group tab',
            url: 'https://example.test/pre-groups',
          },
        ],
      },
    ])

    await Tree.initializeWindows()

    expect(Tree.tabsByUid.get('tab-pre-groups' as UID)).toMatchObject({
      title: 'Pre-group tab',
      tabGroup: undefined,
    })
    expectTreeInvariants()
  })

  it('ST-18 continues from the live Firefox snapshot when storage reading rejects', async () => {
    const readError = new Error('storage unavailable')
    vi.mocked(browser.storage.local.get).mockRejectedValue(readError)
    vi.mocked(browser.windows.getAll).mockResolvedValue([
      liveWindow(400, [
        liveTab(401, 400, 0, {
          title: 'Live after read failure',
          url: 'https://example.test/live-after-read-failure',
        }),
      ]),
    ])
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {})

    await Tree.initializeWindows()

    expect(consoleError).toHaveBeenCalledWith(
      'Error loading session tree from storage:',
      readError,
    )
    expect(Tree.initialized).toBe(true)
    expect(Tree.Items.filter(Tree.isWindow)).toHaveLength(1)
    expect([...Tree.tabsByUid.values()][0]).toMatchObject({
      id: 401,
      title: 'Live after read failure',
      state: State.OPEN,
    })
    expect(browser.storage.local.set).not.toHaveBeenCalled()
    expectTreeInvariants()
  })

  it('ST-19 exposes a failed write and retries the latest complete snapshot', async () => {
    mockStoredTree([
      {
        type: TreeItemType.WINDOW,
        uid: 'window-write-retry',
        state: State.SAVED,
        children: [
          {
            type: TreeItemType.TAB,
            uid: 'tab-write-retry',
            state: State.SAVED,
            title: 'Before failed save',
            url: 'https://example.test/write-retry',
          },
        ],
      },
    ])
    await Tree.initializeWindows()
    const beforeFailure = structuredClone(Tree.Items)
    const writeError = new Error('quota exhausted')
    vi.mocked(browser.storage.local.set)
      .mockRejectedValueOnce(writeError)
      .mockResolvedValueOnce(undefined)

    await expect(Tree.saveSessionTreeToStorage()).rejects.toThrow(
      'quota exhausted',
    )
    expect(Tree.Items).toEqual(beforeFailure)

    Tree.tabsByUid.get('tab-write-retry' as UID)!.customLabel =
      'After failed save'
    await expect(Tree.saveSessionTreeToStorage()).resolves.toBeUndefined()
    expect(browser.storage.local.set).toHaveBeenLastCalledWith({
      [STORAGE_KEY]: structuredClone(Tree.Items),
    })
  })
})
