import { browser } from '@wdio/globals'
import {
  cleanupSeededTabs,
  closeSeededTab,
  createPrivateFixtureTabs,
  extensionFixtureTitle,
  navigateSeededHandle,
  openFixtureTab,
  openFixtureWindow,
  seedSingleSessionTab,
  SESSION_FIXTURE_TITLES,
  switchToSeededHandle,
  trackExtensionFixtureTabsInWindow,
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
  ungroupBrowserTabsByTitle,
  updateNativeTabGroup,
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

  it('renders an unnamed group and applies live metadata updates without reopening the popup (TG-04/TG-34)', async () => {
    await openSeededSessionTree()
    await addFixtureTabs(SESSION_FIXTURE_TITLES.alpha)

    const { group } = await createNativeTabGroup(
      [SESSION_FIXTURE_TITLES.alpha],
      { title: '', color: 'orange', collapsed: false },
    )
    await waitForTreeTabs(
      [SESSION_FIXTURE_TITLES.alpha],
      ([tab]) => tab.tabGroup?.title === '' && tab.tabGroup.color === 'orange',
      'Expected the unnamed native group in the open Session Flow popup.',
    )

    let indicator = await sessionTree.tabGroupIndicatorByTabTitle(
      SESSION_FIXTURE_TITLES.alpha,
    )
    await expect(indicator).toHaveAttribute('aria-label', 'Unnamed tab group')
    expect(await indicator.getAttribute('style')).toContain(
      '--tab-group-color-orange',
    )
    const tabItem = await sessionTree.tabItemByText(
      SESSION_FIXTURE_TITLES.alpha,
    )
    expect(await tabItem.getAttribute('title')).toContain(
      'Tab group: Unnamed tab group',
    )

    await updateNativeTabGroup(group.id, {
      title: 'Live updated group',
      color: 'red',
      collapsed: true,
    })
    await waitForTreeTabs(
      [SESSION_FIXTURE_TITLES.alpha],
      ([tab]) =>
        tab.tabGroup?.title === 'Live updated group' &&
        tab.tabGroup.color === 'red' &&
        tab.tabGroup.collapsed === true,
      'Expected the open popup to receive the native group metadata update.',
    )

    indicator = await sessionTree.tabGroupIndicatorByTabTitle(
      SESSION_FIXTURE_TITLES.alpha,
    )
    await expect(indicator).toHaveAttribute('aria-label', 'Live updated group')
    expect(await indicator.getAttribute('style')).toContain(
      '--tab-group-color-red',
    )
  })

  it('saves and recreates a native group in a private window when access is granted (TG-36)', async () => {
    const privateTitles = ['SF E2E Private Alpha', 'SF E2E Private Beta']
    await openSeededSessionTree()
    const privateAccessAllowed = await browser.executeAsync((done) => {
      window.browser.extension.isAllowedIncognitoAccess().then(done)
    })
    expect(privateAccessAllowed).toBe(true)

    const privateFixture = await createPrivateFixtureTabs(seed, privateTitles)
    const initialBrowserTitles = privateFixture.browserTitles
    await browser.switchToWindow(popup.popupHandle)
    await createNativeTabGroup(initialBrowserTitles, {
      title: SOURCE_GROUP_TITLE,
      color: 'pink',
      collapsed: false,
    })
    const stableGroupUid = await waitForTreeGroupUid(
      initialBrowserTitles[0],
      SOURCE_GROUP_TITLE,
    )
    const privateWindow = await treeWindowContainingTitle(
      initialBrowserTitles[0],
    )
    expect(privateWindow.incognito).toBe(true)

    await sessionTree.sendTreeCommand({
      action: 'saveWindow',
      windowId: privateWindow.id,
      windowUid: privateWindow.uid,
    })
    await sessionTree.waitForBackgroundTree((tree) => {
      const savedWindow = savedWindowsInTree(tree).find(
        (candidate) => candidate.uid === privateWindow.uid,
      )
      return (
        savedWindow?.incognito === true &&
        tabsInWindow(savedWindow).every(
          (tab) =>
            tab.state === TreeItemState.Saved &&
            tab.tabGroup?.uid === stableGroupUid &&
            tab.tabGroup.id === -1,
        )
      )
    }, 'Expected the private group snapshot to remain saved.')

    await sessionTree.sendTreeCommand({
      action: 'openWindow',
      windowUid: privateWindow.uid,
    })
    const restoredTitles = initialBrowserTitles
    const restoredWindowId = await waitForOpenTreeWindowId(privateWindow.uid)
    await waitForNativeGroup(
      restoredTitles,
      (snapshot) =>
        snapshot.tabs.length === restoredTitles.length &&
        snapshot.tabs[0].groupId !== -1 &&
        snapshot.tabs[0].groupId === snapshot.tabs[1].groupId &&
        snapshot.groups[0]?.title === SOURCE_GROUP_TITLE &&
        snapshot.groups[0]?.color === 'pink',
      'Expected Session Flow to recreate the private native group.',
      restoredWindowId,
    )
    await trackExtensionFixtureTabsInWindow(
      seed,
      restoredWindowId,
      restoredTitles,
    )
    await waitForTreeTabs(
      restoredTitles,
      (tabs) => tabs.every((tab) => tab.tabGroup?.uid === stableGroupUid),
      'Expected the reopened private group to retain stable identity.',
      20_000,
      privateWindow.uid,
    )
  })

  it('ungroups beginning, middle, end, and all native group members (TG-12/TG-13)', async () => {
    await openSeededSessionTree()
    const titles = [
      SESSION_FIXTURE_TITLES.alpha,
      SESSION_FIXTURE_TITLES.beta,
      SESSION_FIXTURE_TITLES.gamma,
    ]
    await addFixtureTabs(...titles)
    await createNativeTabGroup(titles, { title: SOURCE_GROUP_TITLE })
    await waitForTreeGroupUid(titles[0], SOURCE_GROUP_TITLE)

    for (const title of titles) {
      await ungroupBrowserTabsByTitle([title])
      await waitForNativeGroup(
        titles,
        (snapshot) => {
          const target = snapshot.tabs.find((tab) => tab.title === title)
          const remaining = snapshot.tabs.filter((tab) => tab.title !== title)
          return (
            target?.groupId === -1 &&
            remaining.every((tab) => tab.groupId !== -1) &&
            new Set(remaining.map((tab) => tab.groupId)).size === 1
          )
        },
        `Expected only ${title} to be ungrouped.`,
      )
      await waitForTreeTabs(
        titles,
        (tabs) => {
          const target = tabs.find((tab) => tab.title === title)
          const remaining = tabs.filter((tab) => tab.title !== title)
          return (
            target?.tabGroup === undefined &&
            remaining.every((tab) => tab.tabGroup) &&
            new Set(remaining.map((tab) => tab.tabGroup.uid)).size === 1
          )
        },
        `Expected Session Flow to ungroup only ${title}.`,
      )
      await createNativeTabGroup(titles, { title: SOURCE_GROUP_TITLE })
      await waitForTreeGroupUid(titles[0], SOURCE_GROUP_TITLE)
    }

    await ungroupBrowserTabsByTitle(titles)
    await waitForNativeGroup(
      titles,
      (snapshot) => snapshot.tabs.every((tab) => tab.groupId === -1),
      'Expected Firefox to ungroup every member.',
    )
    await waitForTreeTabs(
      titles,
      (tabs) => tabs.every((tab) => tab.tabGroup === undefined),
      'Expected Session Flow to clear every group member.',
    )
  })

  it('ungroups a subset moved away from a native group (TG-14)', async () => {
    await openSeededSessionTree()
    const groupedTitles = [
      SESSION_FIXTURE_TITLES.alpha,
      SESSION_FIXTURE_TITLES.beta,
      SESSION_FIXTURE_TITLES.gamma,
    ]
    await addFixtureTabs(...groupedTitles)
    await createNativeTabGroup(groupedTitles, { title: SOURCE_GROUP_TITLE })
    const stableGroupUid = await waitForTreeGroupUid(
      groupedTitles[0],
      SOURCE_GROUP_TITLE,
    )

    await sessionTree.dragTreeItem(
      SESSION_FIXTURE_TITLES.alpha,
      SESSION_FIXTURE_TITLES.initial,
      DropPosition.Below,
    )

    await waitForNativeGroup(
      groupedTitles,
      (snapshot) => {
        const [moved, ...remaining] = snapshot.tabs
        return (
          moved?.groupId === -1 &&
          remaining.every((tab) => tab.groupId !== -1) &&
          new Set(remaining.map((tab) => tab.groupId)).size === 1
        )
      },
      'Expected only the moved subset to leave the native group.',
    )
    await waitForTreeTabs(
      groupedTitles,
      (tabs) =>
        tabs.find((tab) => tab.title === SESSION_FIXTURE_TITLES.alpha)
          ?.tabGroup === undefined &&
        tabs
          .filter((tab) => tab.title !== SESSION_FIXTURE_TITLES.alpha)
          .every((tab) => tab.tabGroup?.uid === stableGroupUid),
      'Expected the remaining Session Flow group members to retain identity.',
    )
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

  it('preserves a singleton group moved to another window without destination grouping (TG-17)', async () => {
    await openSeededSessionTree()
    await addFixtureTabs(SESSION_FIXTURE_TITLES.alpha)
    await switchToPrimaryBrowserWindow()
    await openFixtureWindow(seed, SESSION_FIXTURE_TITLES.gamma)
    await browser.switchToWindow(popup.popupHandle)

    await createNativeTabGroup([SESSION_FIXTURE_TITLES.alpha], {
      title: SOURCE_GROUP_TITLE,
    })
    const stableGroupUid = await waitForTreeGroupUid(
      SESSION_FIXTURE_TITLES.alpha,
      SOURCE_GROUP_TITLE,
    )
    const targetWindowId = await browserWindowIdContainingTitle(
      SESSION_FIXTURE_TITLES.gamma,
    )

    await sessionTree.dragTreeItem(
      SESSION_FIXTURE_TITLES.alpha,
      SESSION_FIXTURE_TITLES.gamma,
      DropPosition.Below,
    )

    await waitForNativeGroup(
      [SESSION_FIXTURE_TITLES.alpha],
      (snapshot) =>
        snapshot.tabs[0]?.windowId === targetWindowId &&
        snapshot.tabs[0]?.groupId !== -1,
      'Expected the cross-window singleton to retain a native group.',
    )
    await waitForTreeTabs(
      [SESSION_FIXTURE_TITLES.alpha],
      ([tab]) => tab.tabGroup?.uid === stableGroupUid,
      'Expected the cross-window singleton to retain stable group identity.',
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

  it('moves multiple source members into an existing group in another window (TG-18)', async () => {
    const destinationSecondTitle = 'SF E2E Destination Second'
    await openSeededSessionTree()
    await addFixtureTabs(
      SESSION_FIXTURE_TITLES.alpha,
      SESSION_FIXTURE_TITLES.beta,
    )
    await switchToPrimaryBrowserWindow()
    await openFixtureWindow(seed, SESSION_FIXTURE_TITLES.gamma)
    await openFixtureTab(seed, destinationSecondTitle)
    await browser.switchToWindow(popup.popupHandle)

    await createNativeTabGroup(
      [SESSION_FIXTURE_TITLES.alpha, SESSION_FIXTURE_TITLES.beta],
      { title: SOURCE_GROUP_TITLE },
    )
    await createNativeTabGroup(
      [SESSION_FIXTURE_TITLES.gamma, destinationSecondTitle],
      { title: DESTINATION_GROUP_TITLE, color: 'purple' },
    )
    const destinationGroupUid = await waitForTreeGroupUid(
      SESSION_FIXTURE_TITLES.gamma,
      DESTINATION_GROUP_TITLE,
    )
    const targetWindowId = await browserWindowIdContainingTitle(
      SESSION_FIXTURE_TITLES.gamma,
    )

    await sessionTree.selectTreeItemRange(
      SESSION_FIXTURE_TITLES.alpha,
      SESSION_FIXTURE_TITLES.beta,
    )
    await sessionTree.dragTreeItem(
      SESSION_FIXTURE_TITLES.alpha,
      destinationSecondTitle,
      DropPosition.Above,
    )

    const allTitles = [
      SESSION_FIXTURE_TITLES.alpha,
      SESSION_FIXTURE_TITLES.beta,
      SESSION_FIXTURE_TITLES.gamma,
      destinationSecondTitle,
    ]
    await waitForNativeGroup(
      allTitles,
      (snapshot) =>
        snapshot.tabs.length === allTitles.length &&
        snapshot.tabs.every((tab) => tab.windowId === targetWindowId) &&
        snapshot.tabs[0].groupId !== -1 &&
        new Set(snapshot.tabs.map((tab) => tab.groupId)).size === 1,
      'Expected all moved members to join the destination native group.',
    )
    await waitForTreeTabs(
      allTitles,
      (tabs) => tabs.every((tab) => tab.tabGroup?.uid === destinationGroupUid),
      'Expected all moved members to adopt destination stable group identity.',
    )
  })

  it('moves selected tabs from two groups together with an ungrouped tab (TG-15/TG-16)', async () => {
    const deltaTitle = 'SF E2E Delta'
    const epsilonTitle = 'SF E2E Epsilon'
    const targetTitle = 'SF E2E Mixed Target'
    const movedTitles = [
      SESSION_FIXTURE_TITLES.alpha,
      SESSION_FIXTURE_TITLES.beta,
      SESSION_FIXTURE_TITLES.gamma,
      deltaTitle,
      epsilonTitle,
    ]
    await openSeededSessionTree()
    await addFixtureTabs(...movedTitles)
    await switchToPrimaryBrowserWindow()
    await openFixtureWindow(seed, targetTitle)
    await browser.switchToWindow(popup.popupHandle)

    await createNativeTabGroup(movedTitles.slice(0, 2), {
      title: SOURCE_GROUP_TITLE,
    })
    await createNativeTabGroup(movedTitles.slice(2, 4), {
      title: DESTINATION_GROUP_TITLE,
      color: 'green',
    })
    await waitForTreeGroupUid(movedTitles[0], SOURCE_GROUP_TITLE)
    await waitForTreeGroupUid(movedTitles[2], DESTINATION_GROUP_TITLE)
    const targetWindowId = await browserWindowIdContainingTitle(targetTitle)

    await sessionTree.selectTreeItemRange(movedTitles[0], movedTitles[4])
    await sessionTree.dragTreeItem(
      movedTitles[0],
      targetTitle,
      DropPosition.Below,
    )

    await waitForNativeGroup(
      movedTitles,
      (snapshot) =>
        snapshot.tabs.length === movedTitles.length &&
        snapshot.tabs.every(
          (tab) => tab.windowId === targetWindowId && tab.groupId === -1,
        ),
      'Expected the mixed multi-group selection to move and become ungrouped.',
    )
    await waitForTreeTabs(
      movedTitles,
      (tabs) => tabs.every((tab) => tab.tabGroup === undefined),
      'Expected the mixed Session Flow selection to clear source groups.',
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

  it('uses ordinary tab-close saving when the group deletion override is disabled (TG-27)', async () => {
    await openSeededSessionTree()
    await sessionTree.updateSettings({
      saveTabOnClose: true,
      saveTabsWhenTabGroupDeleted: false,
    })
    await addFixtureTabs(
      SESSION_FIXTURE_TITLES.alpha,
      SESSION_FIXTURE_TITLES.beta,
    )
    await createNativeTabGroup(
      [SESSION_FIXTURE_TITLES.alpha, SESSION_FIXTURE_TITLES.beta],
      { title: SOURCE_GROUP_TITLE },
    )
    const stableGroupUid = await waitForTreeGroupUid(
      SESSION_FIXTURE_TITLES.alpha,
      SOURCE_GROUP_TITLE,
    )

    await removeBrowserTabsByTitle([
      SESSION_FIXTURE_TITLES.alpha,
      SESSION_FIXTURE_TITLES.beta,
    ])

    await waitForTreeTabs(
      [SESSION_FIXTURE_TITLES.alpha, SESSION_FIXTURE_TITLES.beta],
      (tabs) =>
        tabs.every(
          (tab) =>
            tab.state === TreeItemState.Saved &&
            tab.tabGroup?.uid === stableGroupUid &&
            tab.tabGroup.id === -1,
        ),
      'Expected ordinary close-saving to retain the deleted group snapshot.',
    )
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
    const restoredBetaTitle = extensionFixtureTitle(SESSION_FIXTURE_TITLES.beta)
    await waitForNativeGroup(
      [restoredAlphaTitle, restoredBetaTitle],
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

  it('restores two saved groups with distinct native metadata (TG-33)', async () => {
    const deltaTitle = 'SF E2E Restore Delta'
    const secondGroupTitle = 'SessionFlow second restored group'
    await openSeededSessionTree()
    await switchToPrimaryBrowserWindow()
    await openFixtureWindow(seed, SESSION_FIXTURE_TITLES.alpha)
    await openFixtureTab(seed, SESSION_FIXTURE_TITLES.beta)
    await openFixtureTab(seed, SESSION_FIXTURE_TITLES.gamma)
    await openFixtureTab(seed, deltaTitle)
    await browser.switchToWindow(popup.popupHandle)

    await createNativeTabGroup(
      [SESSION_FIXTURE_TITLES.alpha, SESSION_FIXTURE_TITLES.beta],
      { title: SOURCE_GROUP_TITLE, color: 'orange', collapsed: true },
    )
    await createNativeTabGroup([SESSION_FIXTURE_TITLES.gamma, deltaTitle], {
      title: secondGroupTitle,
      color: 'purple',
      collapsed: false,
    })
    const firstStableUid = await waitForTreeGroupUid(
      SESSION_FIXTURE_TITLES.alpha,
      SOURCE_GROUP_TITLE,
    )
    const secondStableUid = await waitForTreeGroupUid(
      SESSION_FIXTURE_TITLES.gamma,
      secondGroupTitle,
    )
    const groupedWindow = await treeWindowContainingTitle(
      SESSION_FIXTURE_TITLES.alpha,
    )

    await sessionTree.sendTreeCommand({
      action: 'saveWindow',
      windowId: groupedWindow.id,
      windowUid: groupedWindow.uid,
    })
    await sessionTree.sendTreeCommand({
      action: 'openWindow',
      windowUid: groupedWindow.uid,
    })

    const restoredTitles = [
      SESSION_FIXTURE_TITLES.alpha,
      SESSION_FIXTURE_TITLES.beta,
      SESSION_FIXTURE_TITLES.gamma,
      deltaTitle,
    ].map(extensionFixtureTitle)
    const restoredWindowId = await waitForOpenTreeWindowId(groupedWindow.uid)
    await waitForNativeGroup(
      restoredTitles,
      (snapshot) => {
        const metadata = new Map(
          snapshot.groups.map((group) => [group.title, group]),
        )
        return (
          snapshot.tabs.length === 4 &&
          new Set(snapshot.tabs.map((tab) => tab.groupId)).size === 2 &&
          metadata.get(SOURCE_GROUP_TITLE)?.color === 'orange' &&
          metadata.get(SOURCE_GROUP_TITLE)?.collapsed === true &&
          metadata.get(secondGroupTitle)?.color === 'purple' &&
          metadata.get(secondGroupTitle)?.collapsed === false
        )
      },
      'Expected two distinct native groups after restoring the saved window.',
      restoredWindowId,
    )
    await trackExtensionFixtureTabsInWindow(
      seed,
      restoredWindowId,
      restoredTitles,
    )
    await waitForTreeTabs(
      restoredTitles,
      (tabs) => {
        const firstMembers = tabs.filter((tab) =>
          [restoredTitles[0], restoredTitles[1]].includes(tab.title),
        )
        const secondMembers = tabs.filter((tab) =>
          [restoredTitles[2], restoredTitles[3]].includes(tab.title),
        )
        return (
          firstMembers.every((tab) => tab.tabGroup?.uid === firstStableUid) &&
          secondMembers.every((tab) => tab.tabGroup?.uid === secondStableUid)
        )
      },
      'Expected both restored groups to retain their stable identities.',
      10_000,
      groupedWindow.uid,
    )
  })

  it('rejoins saved group members opened one at a time (TG-32)', async () => {
    await openSeededSessionTree()
    await addFixtureTabs(
      SESSION_FIXTURE_TITLES.alpha,
      SESSION_FIXTURE_TITLES.beta,
    )
    await createNativeTabGroup(
      [SESSION_FIXTURE_TITLES.alpha, SESSION_FIXTURE_TITLES.beta],
      { title: SOURCE_GROUP_TITLE, color: 'cyan', collapsed: false },
    )
    const stableGroupUid = await waitForTreeGroupUid(
      SESSION_FIXTURE_TITLES.alpha,
      SOURCE_GROUP_TITLE,
    )
    const containingWindow = await treeWindowContainingTitle(
      SESSION_FIXTURE_TITLES.alpha,
    )
    const originalTabs = tabsInWindow(containingWindow).filter((tab) =>
      [SESSION_FIXTURE_TITLES.alpha, SESSION_FIXTURE_TITLES.beta].includes(
        tab.title,
      ),
    )

    for (const tab of originalTabs) {
      await sessionTree.sendTreeCommand({
        action: 'saveTab',
        tabId: tab.id,
        tabUid: tab.uid,
      })
    }
    await waitForSavedGroupedTabs([
      SESSION_FIXTURE_TITLES.alpha,
      SESSION_FIXTURE_TITLES.beta,
    ])

    await sessionTree.sendTreeCommand({
      action: 'openTab',
      tabUid: originalTabs[0].uid,
      windowUid: containingWindow.uid,
    })
    const restoredAlphaTitle = extensionFixtureTitle(
      SESSION_FIXTURE_TITLES.alpha,
    )
    await waitForNativeGroup(
      [restoredAlphaTitle],
      (snapshot) =>
        snapshot.tabs[0]?.groupId !== -1 &&
        snapshot.groups[0]?.title === SOURCE_GROUP_TITLE,
      'Expected the first reopened member to recreate its saved group.',
      containingWindow.id,
    )
    await trackExtensionFixtureTabsInWindow(seed, containingWindow.id, [
      restoredAlphaTitle,
    ])

    await sessionTree.sendTreeCommand({
      action: 'openTab',
      tabUid: originalTabs[1].uid,
      windowUid: containingWindow.uid,
    })
    const restoredBetaTitle = extensionFixtureTitle(SESSION_FIXTURE_TITLES.beta)
    await waitForNativeGroup(
      [restoredAlphaTitle, restoredBetaTitle],
      (snapshot) =>
        snapshot.tabs.length === 2 &&
        snapshot.tabs[0].groupId !== -1 &&
        snapshot.tabs[0].groupId === snapshot.tabs[1].groupId &&
        snapshot.groups[0]?.title === SOURCE_GROUP_TITLE &&
        snapshot.groups[0]?.color === 'cyan',
      'Expected the later reopened member to join the recreated group.',
      containingWindow.id,
    )
    await trackExtensionFixtureTabsInWindow(seed, containingWindow.id, [
      restoredAlphaTitle,
      restoredBetaTitle,
    ])
    await waitForTreeTabs(
      [restoredAlphaTitle, restoredBetaTitle],
      (tabs) => tabs.every((tab) => tab.tabGroup?.uid === stableGroupUid),
      'Expected both reopened members to retain stable group identity.',
      20_000,
      containingWindow.uid,
    )
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

async function waitForTreeTabs(
  titles,
  predicate,
  timeoutMsg,
  timeout = 10_000,
  windowUid,
) {
  await sessionTree.waitForBackgroundTree(
    (tree) => {
      const tabs = windowsInTree(tree)
        .filter(
          (windowItem) =>
            windowUid === undefined || windowItem.uid === windowUid,
        )
        .flatMap((windowItem) => tabsInWindow(windowItem))
        .filter((tab) => titles.includes(tab.title))
      return tabs.length === titles.length && predicate(tabs)
    },
    timeoutMsg,
    timeout,
  )
}

async function waitForNativeGroup(titles, predicate, timeoutMsg, windowId) {
  let lastSnapshot
  let lastError
  try {
    await browser.waitUntil(
      async () => {
        try {
          await browser.switchToWindow(popup.popupHandle)
          lastSnapshot = await nativeTabGroupSnapshot(titles, windowId)
          lastError = undefined
          return predicate(lastSnapshot)
        } catch (error) {
          lastError = String(error)
          return false
        }
      },
      {
        timeout: 20_000,
        timeoutMsg,
      },
    )
  } catch (error) {
    throw new Error(
      `${timeoutMsg} Last snapshot: ${JSON.stringify(lastSnapshot)}. Last error: ${lastError}`,
      { cause: error },
    )
  }
}

async function waitForOpenTreeWindowId(windowUid) {
  let windowId
  await sessionTree.waitForBackgroundTree(
    (tree) => {
      const windowItem = openWindowsInTree(tree).find(
        (candidate) => candidate.uid === windowUid,
      )
      windowId = windowItem?.id
      return windowId !== undefined && windowId >= 0
    },
    `Expected tree window ${windowUid} to reopen with a browser ID.`,
    20_000,
  )
  return windowId
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
