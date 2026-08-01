import { beforeEach, describe, expect, it, vi } from 'vitest'
import { OnCreatedQueue } from '@/services/background-on-created-queue'
import { Tree } from '@/services/background-tree'
import { State } from '@/types/session-tree'
import {
  installFakeBrowser,
  type FakeBrowser,
} from '../../helpers/fake-browser'
import {
  createNote,
  createTab,
  createWindow,
  resetTree,
} from '../../helpers/tree-fixtures'

describe('external URL imports', () => {
  let fakeBrowser: FakeBrowser

  beforeEach(() => {
    vi.restoreAllMocks()
    fakeBrowser = installFakeBrowser()
    resetTree()
  })

  it('inserts external URLs as saved siblings in a saved window', async () => {
    const parent = createNote('note-parent' as UID, {
      indentLevel: 1,
      isParent: true,
    })
    const existing = createTab('tab-existing' as UID, {
      parentUid: parent.uid,
      indentLevel: 2,
    })
    const window = createWindow('window-1' as UID, [parent, existing])

    await Tree.importExternalUrls({
      action: 'importExternalUrls',
      items: [
        { url: 'https://one.example', title: 'One' },
        { url: 'https://two.example/path' },
      ],
      targetIndex: 1,
      parentUid: parent.uid,
      targetWindowUid: window.uid,
    })

    expect(window.children.map((item) => item.uid)).toEqual([
      parent.uid,
      expect.any(String),
      expect.any(String),
      existing.uid,
    ])
    const imported = Tree.getTabs(window.children).filter(
      (tab) => tab.uid !== existing.uid,
    )
    expect(imported).toMatchObject([
      {
        state: State.SAVED,
        id: -1,
        title: 'One',
        url: 'https://one.example/',
        parentUid: parent.uid,
        indentLevel: 2,
      },
      {
        state: State.SAVED,
        id: -1,
        title: 'https://two.example/path',
        url: 'https://two.example/path',
        parentUid: parent.uid,
        indentLevel: 2,
      },
    ])
    expect(fakeBrowser.tabs.create).not.toHaveBeenCalled()
  })

  it('applies normal adjacent-tab group rules to every imported URL', async () => {
    const group = {
      uid: 'group-1' as UID,
      id: 7,
      title: 'Group',
      color: 'blue' as const,
      collapsed: false,
    }
    const above = createTab('tab-above' as UID, { tabGroup: group })
    const below = createTab('tab-below' as UID, { tabGroup: group })
    const window = createWindow('window-1' as UID, [above, below])

    await Tree.importExternalUrls({
      action: 'importExternalUrls',
      items: [{ url: 'https://one.example' }, { url: 'https://two.example' }],
      targetIndex: 1,
      targetWindowUid: window.uid,
    })

    const imported = Tree.getTabs(window.children).filter(
      (tab) => tab.uid !== above.uid && tab.uid !== below.uid,
    )
    expect(imported).toHaveLength(2)
    expect(imported.map((tab) => tab.tabGroup)).toEqual([
      { ...group, id: -1 },
      { ...group, id: -1 },
    ])
  })

  it('opens imported tabs in order when the target window is live', async () => {
    const existing = createTab('tab-existing' as UID, {
      state: State.OPEN,
      id: 10,
    })
    const window = createWindow('window-1' as UID, [existing], {
      state: State.OPEN,
      id: 20,
    })
    const openTab = vi.spyOn(Tree, 'openTab').mockResolvedValue(undefined)

    await Tree.importExternalUrls({
      action: 'importExternalUrls',
      items: [{ url: 'https://one.example' }, { url: 'https://two.example' }],
      targetIndex: 1,
      targetWindowUid: window.uid,
    })

    const imported = Tree.getTabs(window.children).filter(
      (tab) => tab.uid !== existing.uid,
    )
    expect(openTab).toHaveBeenNthCalledWith(1, {
      tabUid: imported[0].uid,
      windowUid: window.uid,
    })
    expect(openTab).toHaveBeenNthCalledWith(2, {
      tabUid: imported[1].uid,
      windowUid: window.uid,
    })
  })

  it('keeps successful live imports ordered and removes failed placeholders (PD-ED-04)', async () => {
    const existing = createTab('tab-existing' as UID, {
      state: State.OPEN,
      id: 10,
    })
    const window = createWindow('window-1' as UID, [existing], {
      state: State.OPEN,
      id: 20,
    })
    let nextId = 30
    vi.spyOn(Tree, 'openTab').mockImplementation(async ({ tabUid }) => {
      const tab = Tree.tabsByUid.get(tabUid)
      if (!tab) throw new Error('Missing imported tab')
      if (tab.url === 'https://fail.example/') {
        throw new Error('Firefox rejected tab creation')
      }
      Tree.updateTab({ tabUid }, { id: nextId++, state: State.OPEN }, false)
    })

    await expect(
      Tree.importExternalUrls({
        action: 'importExternalUrls',
        items: [
          { url: 'https://one.example' },
          { url: 'https://fail.example' },
          { url: 'https://three.example' },
        ],
        targetIndex: 1,
        targetWindowUid: window.uid,
      }),
    ).rejects.toThrow('1 of 3 externally dropped tabs could not be opened')

    expect(
      Tree.getTabs(window.children).map((tab) => ({
        url: tab.url,
        state: tab.state,
      })),
    ).toEqual([
      { url: existing.url, state: State.OPEN },
      { url: 'https://one.example/', state: State.OPEN },
      { url: 'https://three.example/', state: State.OPEN },
    ])
  })

  it('keeps duplicate links ordered after the last pinned tab', async () => {
    const pinnedOne = createTab('tab-pinned-one' as UID, { pinned: true })
    const pinnedTwo = createTab('tab-pinned-two' as UID, { pinned: true })
    const existing = createTab('tab-existing' as UID)
    const window = createWindow('window-1' as UID, [
      pinnedOne,
      pinnedTwo,
      existing,
    ])

    await Tree.importExternalUrls({
      action: 'importExternalUrls',
      items: [
        { url: 'https://same.example', title: 'First copy' },
        { url: 'https://same.example', title: 'Second copy' },
      ],
      targetIndex: 0,
      parentUid: pinnedOne.uid,
      targetWindowUid: window.uid,
    })

    expect(
      Tree.getTabs(window.children).map((tab) => ({
        uid: tab.uid,
        title: tab.title,
        parentUid: tab.parentUid,
      })),
    ).toEqual([
      { uid: pinnedOne.uid, title: pinnedOne.title, parentUid: undefined },
      { uid: pinnedTwo.uid, title: pinnedTwo.title, parentUid: undefined },
      { uid: expect.any(String), title: 'First copy', parentUid: undefined },
      { uid: expect.any(String), title: 'Second copy', parentUid: undefined },
      { uid: existing.uid, title: existing.title, parentUid: undefined },
    ])
  })

  it('creates a new live browser window when there is no tree window target', async () => {
    const createWindowAndWait = vi
      .spyOn(OnCreatedQueue, 'createWindowAndWait')
      .mockResolvedValue({
        id: 25,
        focused: true,
        incognito: false,
        alwaysOnTop: false,
        tabs: [
          {
            id: 26,
            index: 0,
            highlighted: true,
            active: true,
            pinned: false,
            incognito: false,
          },
        ],
      })
    const addWindow = vi.spyOn(Tree, 'addWindow').mockResolvedValue(undefined)

    await Tree.importExternalUrls({
      action: 'importExternalUrls',
      items: [
        { url: 'https://example.test', title: 'Example' },
        { url: 'about:config', title: 'Configuration' },
        { url: 'javascript:alert(1)' },
      ],
      targetIndex: 0,
    })

    expect(createWindowAndWait).toHaveBeenCalledTimes(1)
    const [properties] = createWindowAndWait.mock.calls[0]
    expect(properties?.url).toEqual([
      'https://example.test/',
      expect.stringContaining(
        '/redirect.html?targetUrl=about%3Aconfig&targetTitle=Configuration',
      ),
    ])
    expect(addWindow).toHaveBeenCalledWith(25)
  })

  it('rejects a parent from another window without mutating either tree', async () => {
    const foreignParent = createNote('foreign-parent' as UID)
    createWindow('window-foreign' as UID, [foreignParent])
    const targetWindow = createWindow('window-target' as UID)

    await expect(
      Tree.importExternalUrls({
        action: 'importExternalUrls',
        items: [{ url: 'https://example.test' }],
        targetIndex: 0,
        parentUid: foreignParent.uid,
        targetWindowUid: targetWindow.uid,
      }),
    ).rejects.toThrow('External drop parent is not in the target window')

    expect(targetWindow.children).toEqual([])
  })

  it('does not move a stale native-tab payload when Firefox rejects tabs.get (PD-ED-03)', async () => {
    const sourceTab = createTab('tab-source' as UID, {
      id: 42,
      state: State.OPEN,
    })
    const sourceWindow = createWindow('window-source' as UID, [sourceTab], {
      id: 10,
      state: State.OPEN,
    })
    const targetWindow = createWindow('window-target' as UID, [], {
      id: 20,
      state: State.OPEN,
    })
    fakeBrowser.tabs.get.mockRejectedValueOnce(new Error('Unknown tab 42'))
    const moveTreeItems = vi.spyOn(Tree, 'moveTreeItems')
    const moveFirefoxNativeTabs = (
      Tree as typeof Tree & {
        moveFirefoxNativeTabs: (message: {
          firefoxTabIds: number[]
          targetIndex: number
          parentUid?: UID
          targetWindowUid: UID
        }) => Promise<void>
      }
    ).moveFirefoxNativeTabs

    await expect(
      moveFirefoxNativeTabs({
        firefoxTabIds: [sourceTab.id],
        targetIndex: 0,
        targetWindowUid: targetWindow.uid,
      }),
    ).resolves.toBeUndefined()

    expect(moveTreeItems).not.toHaveBeenCalled()
    expect(sourceWindow.children).toEqual([sourceTab])
    expect(targetWindow.children).toEqual([])
  })
})
