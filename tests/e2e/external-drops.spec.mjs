import { browser, expect } from '@wdio/globals'
import {
  cleanupSeededTabs,
  createPrivateFixtureTabs,
  seedSingleSessionTab,
} from './support/session-fixtures.mjs'
import {
  SessionTreePage,
  tabsInWindow,
  TreeItemState,
  windowsInTree,
} from './support/session-tree-page.mjs'
import {
  closeSessionTreePopup,
  openSessionTreePopup,
} from './support/session-tree-popup.mjs'

describe('Firefox external drop workflows', () => {
  let seed
  let popup
  let sessionTree

  beforeEach(async () => {
    seed = await seedSingleSessionTab('PD External Seed')
    popup = await openSessionTreePopup()
    sessionTree = new SessionTreePage()
    await sessionTree.expectLoaded()
    await sessionTree.updateSettings({
      enableDragAndDrop: true,
      enableDropFromExternalSources: true,
      saveTabOnClose: false,
      saveWindowOnClose: false,
    })
    // Reload the test page so the drag handlers start from the stored settings,
    // independent of the asynchronous settingsUpdated listener timing.
    await browser.refresh()
    sessionTree = new SessionTreePage()
    await sessionTree.expectLoaded()
  })

  afterEach(async () => {
    if (popup?.popupHandle) {
      const handles = await browser.getWindowHandles()
      if (handles.includes(popup.popupHandle)) {
        await browser.switchToWindow(popup.popupHandle)
        await sessionTree.removeAllNotes()
      }
    }
    if (seed) await cleanupSeededTabs(seed)
    if (popup?.popupHandle) {
      const handles = await browser.getWindowHandles()
      if (handles.includes(popup.popupHandle)) {
        await browser.switchToWindow(popup.popupHandle)
        const normalHandle = handles.find(
          (handle) => handle !== popup.popupHandle,
        )
        if (normalHandle) await closeSessionTreePopup(normalHandle)
      }
    }
  })

  it('imports Firefox URL, URI-list, and plain-text payloads into live, nested, saved, and empty targets (PD-ED-01)', async () => {
    let tree = await sessionTree.backgroundTreeSnapshot()
    const windowItem = windowsInTree(tree)[0]
    await sessionTree.sendTreeCommand({
      action: 'updateWindowTitle',
      windowUid: windowItem.uid,
      newTitle: 'PD External Target',
    })
    await sessionTree.sendTreeCommand({
      action: 'createNote',
      parentUid: windowItem.uid,
      text: 'PD External Nested',
    })
    await sessionTree.waitForItemTextVisible('PD External Nested')

    const firstDrop = await sessionTree.dropExternalData(
      'PD External Target',
      'middle',
      {
        'text/x-moz-url': 'https://moz-drop.invalid/path\r\nMozilla URL Drop',
        'text/plain': 'https://moz-drop.invalid/path',
      },
    )
    expect(firstDrop).toMatchObject({
      types: expect.arrayContaining(['text/plain']),
      plainText: 'https://moz-drop.invalid/path',
      dragEnterAccepted: true,
      dragOverAccepted: true,
      dropAccepted: true,
    })
    await sessionTree.waitForBackgroundTree(
      (currentTree) =>
        windowsInTree(currentTree).some((candidate) =>
          tabsInWindow(candidate).some(
            (tab) => tab.url === 'https://moz-drop.invalid/path',
          ),
        ),
      'Expected the Firefox URL payload to finish importing.',
    )
    await sessionTree.dropExternalData('PD External Nested', 'middle', {
      'text/uri-list': '# URI List Drop\r\nhttps://uri-drop.invalid/path',
      'text/plain': 'https://uri-drop.invalid/path',
    })
    await sessionTree.waitForBackgroundTree((currentTree) => {
      const currentWindow = windowsInTree(currentTree).find(
        (candidate) => candidate.uid === windowItem.uid,
      )
      const nestedNote = currentWindow?.children.find(
        (item) => item.text === 'PD External Nested',
      )
      const tabs = currentWindow ? tabsInWindow(currentWindow) : []
      return tabs.some(
        (tab) =>
          tab.url === 'https://uri-drop.invalid/path' &&
          tab.parentUid === nestedNote?.uid,
      )
    }, 'Expected external URL formats in live and nested targets.')

    tree = await sessionTree.backgroundTreeSnapshot()
    const liveWindow = windowsInTree(tree).find(
      (candidate) => candidate.uid === windowItem.uid,
    )
    await sessionTree.sendTreeCommand({
      action: 'saveWindow',
      windowId: liveWindow.id,
      windowUid: liveWindow.uid,
    })
    await sessionTree.waitForBackgroundTree(
      (currentTree) =>
        windowsInTree(currentTree).some(
          (candidate) =>
            candidate.uid === windowItem.uid &&
            candidate.state === TreeItemState.Saved,
        ),
      'Expected a saved external-drop target window.',
    )
    await sessionTree.dropExternalData('PD External Target', 'middle', {
      'text/plain': 'https://plain-drop.invalid/path',
    })
    await sessionTree.waitForBackgroundTree((currentTree) => {
      const savedWindow = windowsInTree(currentTree).find(
        (candidate) => candidate.uid === windowItem.uid,
      )
      return tabsInWindow(savedWindow).some(
        (tab) =>
          tab.url === 'https://plain-drop.invalid/path' &&
          tab.state === TreeItemState.Saved,
      )
    }, 'Expected plain text to import as a saved tab in a saved window.')

    await sessionTree.sendTreeCommand({
      action: 'closeWindow',
      windowId: -1,
      windowUid: windowItem.uid,
    })
    await sessionTree.waitForBackgroundTree(
      (currentTree) => windowsInTree(currentTree).length === 0,
      'Expected an empty tree before the tree-end import.',
    )
    await sessionTree.dropExternalData(null, 'middle', {
      'text/plain': 'https://empty-drop.invalid/path',
    })
    await sessionTree.waitForBackgroundTree(
      (currentTree) =>
        windowsInTree(currentTree).some((candidate) =>
          tabsInWindow(candidate).some(
            (tab) =>
              tab.url === 'https://empty-drop.invalid/path' ||
              tab.title.includes('empty-drop.invalid/path'),
          ),
        ),
      'Expected an empty-tree external drop to create a Firefox window.',
    )
  })

  it('blocks a native Firefox tab move across privacy boundaries while URL-copy remains permitted (PD-ED-06)', async () => {
    const before = await sessionTree.backgroundTreeSnapshot()
    const normalWindow = windowsInTree(before)[0]
    const sourceTab = tabsInWindow(normalWindow)[0]
    const privateFixture = await createPrivateFixtureTabs(seed, [
      'PD External Private',
    ])
    let privateWindow
    await sessionTree.waitForBackgroundTree((tree) => {
      privateWindow = windowsInTree(tree).find(
        (candidate) =>
          candidate.incognito &&
          tabsInWindow(candidate).some(
            (tab) => tab.id === privateFixture.tabIds[0],
          ),
      )
      return Boolean(privateWindow)
    }, 'Expected the private native-drop target window.')
    await sessionTree.sendTreeCommand({
      action: 'updateWindowTitle',
      windowUid: privateWindow.uid,
      newTitle: 'PD Private Drop Target',
    })

    let nativeMoveRejected = false
    try {
      await sessionTree.sendTreeCommand({
        action: 'moveFirefoxNativeTabs',
        firefoxTabIds: [sourceTab.id],
        targetIndex: 0,
        targetWindowUid: privateWindow.uid,
      })
    } catch {
      nativeMoveRejected = true
    }
    expect(nativeMoveRejected).toBe(true)
    await browser.pause(250)
    let current = await sessionTree.backgroundTreeSnapshot()
    expect(
      tabsInWindow(
        windowsInTree(current).find(
          (candidate) => candidate.uid === normalWindow.uid,
        ),
      ).some((tab) => tab.uid === sourceTab.uid),
    ).toBe(true)
    expect(
      tabsInWindow(
        windowsInTree(current).find(
          (candidate) => candidate.uid === privateWindow.uid,
        ),
      ).some((tab) => tab.uid === sourceTab.uid),
    ).toBe(false)

    await sessionTree.dropExternalData('PD Private Drop Target', 'middle', {
      'text/uri-list': 'https://private-copy.invalid/path',
    })
    await sessionTree.waitForBackgroundTree((tree) => {
      const target = windowsInTree(tree).find(
        (candidate) => candidate.uid === privateWindow.uid,
      )
      return (
        target?.incognito === true &&
        tabsInWindow(target).some(
          (tab) => tab.url === 'https://private-copy.invalid/path',
        )
      )
    }, 'Expected a URL-copy import to create a distinct private tab.')
  })
})
