import { browser } from '@wdio/globals'
import {
  cleanupSeededTabs,
  closeSeededTab,
  extensionFixtureTitle,
  navigateSeededHandle,
  openFixtureTab,
  openFixtureWindow,
  seedSingleSessionTab,
  SESSION_FIXTURE_TITLES,
  switchToSeededHandle,
  trackFixtureHandleByTitle,
} from './support/session-fixtures.mjs'
import {
  DropPosition,
  openWindowsInTree,
  savedWindowsInTree,
  SessionTreePage,
  tabsInWindow,
  TreeItemState,
  windowsInTree,
} from './support/session-tree-page.mjs'
import {
  closeSessionTreePopup,
  openSessionTreePopup,
} from './support/session-tree-popup.mjs'
import {
  browserTabTitlesInWindow,
  browserWindowIdContainingTitle,
  createNativeTabGroup,
  moveNativeTabGroup,
  nativeTabGroupSnapshot,
  removeBrowserTabsByTitle,
} from './support/tab-groups.mjs'

const SOURCE_GROUP_TITLE = 'SessionFlow source group'
const DESTINATION_GROUP_TITLE = 'SessionFlow destination group'

let seed
let popup
let sessionTree

describe('native Firefox tab-group workflows', () => {
  afterEach(async () => {
    if (popup?.popupHandle) {
      const handles = await browser.getWindowHandles()
      if (handles.includes(popup.popupHandle)) {
        await browser.switchToWindow(popup.popupHandle)
        if (sessionTree) {
          await sessionTree.updateSettings({
            saveTabOnClose: false,
            saveTabsWhenTabGroupDeleted: false,
            saveWindowOnClose: false,
          })
          await removeSavedTreeItems()
        }
      }
    }

    if (seed) {
      await cleanupSeededTabs(seed)
      seed = undefined
    }

    if (popup?.popupHandle) {
      const handles = await browser.getWindowHandles()
      if (handles.includes(popup.popupHandle)) {
        await browser.switchToWindow(popup.popupHandle)
        await closeSessionTreePopup(popup.originalHandle)
      }
    }

    popup = undefined
    sessionTree = undefined
  })

  it('preserves a singleton group moved in the session tree', async () => {
    await openSeededSessionTree()
    await addFixtureTabs(
      SESSION_FIXTURE_TITLES.alpha,
      SESSION_FIXTURE_TITLES.beta,
    )

    await createNativeTabGroup([SESSION_FIXTURE_TITLES.alpha], {
      title: SOURCE_GROUP_TITLE,
    })
    const sourceGroupUid = await waitForTreeGroupUid(
      SESSION_FIXTURE_TITLES.alpha,
      SOURCE_GROUP_TITLE,
    )

    await sessionTree.dragTreeItem(
      SESSION_FIXTURE_TITLES.alpha,
      SESSION_FIXTURE_TITLES.beta,
      DropPosition.Below,
    )

    await waitForNativeGroup(
      [SESSION_FIXTURE_TITLES.alpha],
      (snapshot) => snapshot.tabs[0]?.groupId !== -1,
      'Expected the moved singleton tab to remain in a native group.',
    )
    await waitForTreeTabs(
      [SESSION_FIXTURE_TITLES.alpha],
      ([tab]) => tab.tabGroup?.uid === sourceGroupUid,
      'Expected the moved singleton tab to preserve its SessionFlow group.',
    )
  })

  it('moves a singleton tab into the destination group between its members', async () => {
    await openSeededSessionTree()
    await addFixtureTabs(
      SESSION_FIXTURE_TITLES.alpha,
      SESSION_FIXTURE_TITLES.beta,
      SESSION_FIXTURE_TITLES.gamma,
    )

    await createNativeTabGroup([SESSION_FIXTURE_TITLES.alpha], {
      title: SOURCE_GROUP_TITLE,
    })
    await createNativeTabGroup(
      [SESSION_FIXTURE_TITLES.beta, SESSION_FIXTURE_TITLES.gamma],
      { title: DESTINATION_GROUP_TITLE, color: 'purple' },
    )
    const destinationGroupUid = await waitForTreeGroupUid(
      SESSION_FIXTURE_TITLES.beta,
      DESTINATION_GROUP_TITLE,
    )

    await sessionTree.dragTreeItem(
      SESSION_FIXTURE_TITLES.alpha,
      SESSION_FIXTURE_TITLES.gamma,
      DropPosition.Above,
    )

    await waitForNativeGroup(
      [
        SESSION_FIXTURE_TITLES.alpha,
        SESSION_FIXTURE_TITLES.beta,
        SESSION_FIXTURE_TITLES.gamma,
      ],
      (snapshot) =>
        snapshot.tabs.length === 3 &&
        new Set(snapshot.tabs.map((tab) => tab.groupId)).size === 1 &&
        snapshot.tabs[0].groupId !== -1,
      'Expected all three tabs to join the destination native group.',
    )
    await waitForTreeTabs(
      [
        SESSION_FIXTURE_TITLES.alpha,
        SESSION_FIXTURE_TITLES.beta,
        SESSION_FIXTURE_TITLES.gamma,
      ],
      (tabs) => tabs.every((tab) => tab.tabGroup?.uid === destinationGroupUid),
      'Expected the destination group to take precedence in SessionFlow.',
    )
  })

  it('reconciles a native multi-tab group moved within its window', async () => {
    await openSeededSessionTree()
    await addFixtureTabs(
      SESSION_FIXTURE_TITLES.alpha,
      SESSION_FIXTURE_TITLES.beta,
      SESSION_FIXTURE_TITLES.gamma,
    )

    const { group } = await createNativeTabGroup(
      [SESSION_FIXTURE_TITLES.alpha, SESSION_FIXTURE_TITLES.beta],
      { title: SOURCE_GROUP_TITLE },
    )
    await waitForTreeGroupUid(SESSION_FIXTURE_TITLES.alpha, SOURCE_GROUP_TITLE)
    await moveNativeTabGroup(group.id, 0)

    const browserTitles = await waitForBrowserGroupOrder(group.windowId, [
      SESSION_FIXTURE_TITLES.alpha,
      SESSION_FIXTURE_TITLES.beta,
    ])
    await sessionTree.waitForBackgroundTree((tree) => {
      const windowItem = windowsInTree(tree).find(
        (candidate) => candidate.id === group.windowId,
      )
      if (!windowItem) return false
      return (
        tabsInWindow(windowItem)
          .filter((tab) => browserTitles.includes(tab.title))
          .map((tab) => tab.title)
          .join('|') === browserTitles.join('|')
      )
    }, 'Expected SessionFlow tab order to match the moved native group order.')
  })

  it('keeps group metadata when a native group moves to another window', async () => {
    await openSeededSessionTree()
    await addFixtureTabs(
      SESSION_FIXTURE_TITLES.alpha,
      SESSION_FIXTURE_TITLES.beta,
    )
    await switchToPrimaryBrowserWindow()
    await openFixtureWindow(seed, SESSION_FIXTURE_TITLES.gamma)
    await browser.switchToWindow(popup.popupHandle)

    const { group } = await createNativeTabGroup(
      [SESSION_FIXTURE_TITLES.alpha, SESSION_FIXTURE_TITLES.beta],
      { title: SOURCE_GROUP_TITLE, color: 'green' },
    )
    const stableGroupUid = await waitForTreeGroupUid(
      SESSION_FIXTURE_TITLES.alpha,
      SOURCE_GROUP_TITLE,
    )
    const targetWindowId = await browserWindowIdContainingTitle(
      SESSION_FIXTURE_TITLES.gamma,
    )

    await moveNativeTabGroup(group.id, 0, targetWindowId)

    await waitForNativeGroup(
      [SESSION_FIXTURE_TITLES.alpha, SESSION_FIXTURE_TITLES.beta],
      (snapshot) =>
        snapshot.tabs.length === 2 &&
        snapshot.tabs.every((tab) => tab.windowId === targetWindowId) &&
        new Set(snapshot.tabs.map((tab) => tab.groupId)).size === 1,
      'Expected the native group to move intact to the second window.',
    )
    await sessionTree.waitForBackgroundTree((tree) => {
      const targetWindow = windowsInTree(tree).find(
        (candidate) => candidate.id === targetWindowId,
      )
      if (!targetWindow) return false
      const groupedTabs = tabsInWindow(targetWindow).filter((tab) =>
        [SESSION_FIXTURE_TITLES.alpha, SESSION_FIXTURE_TITLES.beta].includes(
          tab.title,
        ),
      )
      return (
        groupedTabs.length === 2 &&
        groupedTabs.every((tab) => tab.tabGroup?.uid === stableGroupUid)
      )
    }, 'Expected SessionFlow to retain the moved group metadata in the second window.')
  })

  it('saves a closed group and documents the last-tab group-removal behavior', async () => {
    await openSeededSessionTree()
    await sessionTree.updateSettings({ saveTabsWhenTabGroupDeleted: true })
    await addFixtureTabs(
      SESSION_FIXTURE_TITLES.alpha,
      SESSION_FIXTURE_TITLES.beta,
    )

    await createNativeTabGroup(
      [SESSION_FIXTURE_TITLES.alpha, SESSION_FIXTURE_TITLES.beta],
      { title: SOURCE_GROUP_TITLE },
    )
    await waitForTreeGroupUid(SESSION_FIXTURE_TITLES.alpha, SOURCE_GROUP_TITLE)
    await removeBrowserTabsByTitle([
      SESSION_FIXTURE_TITLES.alpha,
      SESSION_FIXTURE_TITLES.beta,
    ])

    await waitForSavedGroupedTabs([
      SESSION_FIXTURE_TITLES.alpha,
      SESSION_FIXTURE_TITLES.beta,
    ])

    await switchToPrimaryBrowserWindow()
    await openFixtureTab(seed, SESSION_FIXTURE_TITLES.gamma)
    await browser.switchToWindow(popup.popupHandle)
    await createNativeTabGroup([SESSION_FIXTURE_TITLES.gamma], {
      title: DESTINATION_GROUP_TITLE,
    })
    await waitForTreeGroupUid(
      SESSION_FIXTURE_TITLES.gamma,
      DESTINATION_GROUP_TITLE,
    )
    await removeBrowserTabsByTitle([SESSION_FIXTURE_TITLES.gamma])

    await waitForSavedGroupedTabs([SESSION_FIXTURE_TITLES.gamma])
  })

  it('restores a saved grouped window as one native group', async () => {
    await openSeededSessionTree()
    await switchToPrimaryBrowserWindow()
    await openFixtureWindow(seed, SESSION_FIXTURE_TITLES.alpha)
    await openFixtureTab(seed, SESSION_FIXTURE_TITLES.beta)
    await browser.switchToWindow(popup.popupHandle)

    await createNativeTabGroup(
      [SESSION_FIXTURE_TITLES.alpha, SESSION_FIXTURE_TITLES.beta],
      { title: SOURCE_GROUP_TITLE, color: 'orange', collapsed: true },
    )
    const stableGroupUid = await waitForTreeGroupUid(
      SESSION_FIXTURE_TITLES.alpha,
      SOURCE_GROUP_TITLE,
    )
    const groupedWindow = await treeWindowContainingTitle(
      SESSION_FIXTURE_TITLES.alpha,
    )

    await sessionTree.sendTreeCommand({
      action: 'saveWindow',
      windowId: groupedWindow.id,
      windowUid: groupedWindow.uid,
    })
    await sessionTree.waitForBackgroundTree((tree) => {
      const savedWindow = savedWindowsInTree(tree).find(
        (candidate) => candidate.uid === groupedWindow.uid,
      )
      if (!savedWindow) return false
      const groupedTabs = tabsInWindow(savedWindow)
      return (
        groupedTabs.length === 2 &&
        groupedTabs.every(
          (tab) =>
            tab.state === TreeItemState.Saved &&
            tab.tabGroup?.uid === stableGroupUid &&
            tab.tabGroup.id === -1,
        )
      )
    }, 'Expected the grouped window and its group metadata to be saved.')

    await sessionTree.sendTreeCommand({
      action: 'openWindow',
      windowUid: groupedWindow.uid,
    })
    const restoredAlphaTitle = extensionFixtureTitle(
      SESSION_FIXTURE_TITLES.alpha,
    )
    await waitForNativeGroup(
      [restoredAlphaTitle, SESSION_FIXTURE_TITLES.beta],
      (snapshot) =>
        snapshot.tabs.length === 2 &&
        new Set(snapshot.tabs.map((tab) => tab.groupId)).size === 1 &&
        snapshot.groups[0]?.title === SOURCE_GROUP_TITLE &&
        snapshot.groups[0]?.color === 'orange' &&
        snapshot.groups[0]?.collapsed === true,
      'Expected both reopened tabs in one restored native group.',
    )

    await trackFixtureHandleByTitle(seed, restoredAlphaTitle)
    await browser.switchToWindow(popup.popupHandle)
  })
})

async function openSeededSessionTree() {
  seed = await seedSingleSessionTab()
  popup = await openSessionTreePopup()
  sessionTree = new SessionTreePage()
  await sessionTree.expectLoaded()
  await sessionTree.updateSettings({
    saveTabOnClose: false,
    saveTabsWhenTabGroupDeleted: false,
    saveWindowOnClose: false,
  })
  await navigateSeededHandle(seed, SESSION_FIXTURE_TITLES.initial)
  await browser.switchToWindow(popup.popupHandle)

  const tracked = await treeContainsOpenTab(SESSION_FIXTURE_TITLES.initial)
  if (!tracked) {
    await closeSeededTab(seed, SESSION_FIXTURE_TITLES.initial)
    await openFixtureWindow(seed, SESSION_FIXTURE_TITLES.initial)
    await browser.switchToWindow(popup.popupHandle)
  }
  await waitForTreeTabs(
    [SESSION_FIXTURE_TITLES.initial],
    ([tab]) => tab.state === TreeItemState.Open,
    'Expected the initial fixture tab to be tracked.',
  )
}

async function switchToPrimaryBrowserWindow() {
  await switchToSeededHandle(seed, SESSION_FIXTURE_TITLES.initial)
}

async function addFixtureTabs(...titles) {
  await switchToPrimaryBrowserWindow()
  for (const title of titles) {
    await openFixtureTab(seed, title)
  }
  await browser.switchToWindow(popup.popupHandle)
  await waitForTreeTabs(
    titles,
    (tabs) => tabs.length === titles.length,
    `Expected fixture tabs in SessionFlow: ${titles.join(', ')}.`,
  )
}

async function waitForTreeGroupUid(title, groupTitle) {
  let groupUid
  await waitForTreeTabs(
    [title],
    ([tab]) => {
      groupUid = tab.tabGroup?.uid
      return tab.tabGroup?.title === groupTitle && tab.tabGroup.id !== -1
    },
    `Expected "${title}" in tree group "${groupTitle}".`,
  )
  return groupUid
}

async function waitForTreeTabs(titles, predicate, timeoutMsg) {
  await sessionTree.waitForBackgroundTree((tree) => {
    const tabs = windowsInTree(tree)
      .flatMap((windowItem) => tabsInWindow(windowItem))
      .filter((tab) => titles.includes(tab.title))
    return tabs.length === titles.length && predicate(tabs)
  }, timeoutMsg)
}

async function waitForNativeGroup(titles, predicate, timeoutMsg) {
  let lastSnapshot
  await browser.waitUntil(
    async () => {
      lastSnapshot = await nativeTabGroupSnapshot(titles)
      return predicate(lastSnapshot)
    },
    {
      timeout: 10_000,
      timeoutMsg: `${timeoutMsg} Last snapshot: ${JSON.stringify(lastSnapshot)}`,
    },
  )
}

async function waitForBrowserGroupOrder(windowId, leadingTitles) {
  let titles = []
  await browser.waitUntil(
    async () => {
      titles = await browserTabTitlesInWindow(windowId)
      return leadingTitles.every((title, index) => titles[index] === title)
    },
    {
      timeout: 10_000,
      timeoutMsg: `Expected native group at start of window. Last order: ${titles.join(', ')}.`,
    },
  )
  return titles
}

async function waitForSavedGroupedTabs(titles) {
  await waitForTreeTabs(
    titles,
    (tabs) =>
      tabs.every(
        (tab) =>
          tab.state === TreeItemState.Saved &&
          tab.tabGroup &&
          tab.tabGroup.id === -1,
      ),
    `Expected saved grouped tabs: ${titles.join(', ')}.`,
  )
}

async function treeContainsOpenTab(title) {
  const tree = await sessionTree.backgroundTreeSnapshot()
  return openWindowsInTree(tree).some((windowItem) =>
    tabsInWindow(windowItem).some(
      (tab) => tab.title === title && tab.state === TreeItemState.Open,
    ),
  )
}

async function treeWindowContainingTitle(title) {
  const tree = await sessionTree.backgroundTreeSnapshot()
  const windowItem = windowsInTree(tree).find((candidate) =>
    tabsInWindow(candidate).some((tab) => tab.title === title),
  )
  if (!windowItem) {
    throw new Error(`Expected a tree window containing "${title}".`)
  }
  return windowItem
}

async function removeSavedTreeItems() {
  const tree = await sessionTree.backgroundTreeSnapshot()
  for (const windowItem of savedWindowsInTree(tree)) {
    await sessionTree.sendTreeCommand({
      action: 'closeWindow',
      windowId: windowItem.id,
      windowUid: windowItem.uid,
    })
  }

  const remainingTree = await sessionTree.backgroundTreeSnapshot()
  const savedTabs = openWindowsInTree(remainingTree).flatMap((windowItem) =>
    tabsInWindow(windowItem).filter((tab) => tab.state === TreeItemState.Saved),
  )
  for (const tab of savedTabs) {
    await sessionTree.sendTreeCommand({
      action: 'closeTab',
      tabId: tab.id,
      tabUid: tab.uid,
    })
  }
}
