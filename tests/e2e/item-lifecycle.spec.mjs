import { browser } from '@wdio/globals'
import {
  cleanupSeededTabs,
  extensionFixtureTitle,
  navigateSeededHandle,
  openFixtureTab,
  openFixtureWindow,
  seedSessionTabs,
  seedSingleSessionTab,
  SESSION_FIXTURE_TITLES,
  trackFixtureHandleByTitle,
} from './support/session-fixtures.mjs'
import {
  notesInWindow,
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
  createNativeTabGroup,
  nativeTabGroupSnapshot,
} from './support/tab-groups.mjs'

const NOTE_TEXT = 'Lifecycle note'
const GROUP_TITLE = 'Lifecycle group'

let seed
let popup
let sessionTree

describe('Firefox item lifecycle workflows', () => {
  afterEach(async () => {
    if (popup?.popupHandle) {
      const handles = await browser.getWindowHandles()
      if (handles.includes(popup.popupHandle)) {
        await browser.switchToWindow(popup.popupHandle)
        if (sessionTree) {
          await sessionTree.removeAllNotes()
          await sessionTree.updateSettings({
            focusTabOnOpen: true,
            openWindowWithTabsDiscarded: false,
            openWindowsInSameLocation: false,
            openWindowsInSameLocationUpdateInterval: 1,
            openWindowsInSameLocationUpdateIntervalUnit: 'minutes',
            saveTabOnClose: false,
            saveWindowOnClose: false,
          })
          await removeSavedTreeItems()
        }
      }
    }

    if (seed) {
      await trackUnregisteredNormalHandles()
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

  it('opens a saved tab when no normal destination window exists', async () => {
    await openLifecycleSession()
    const original = await onlyTrackedTab(SESSION_FIXTURE_TITLES.initial)
    const originalWindowUid = original.window.uid
    const originalTabUid = original.tab.uid

    await sessionTree.sendTreeCommand({
      action: 'saveTab',
      tabId: original.tab.id,
      tabUid: original.tab.uid,
    })
    await sessionTree.waitForBackgroundTree((tree) => {
      const savedWindow = savedWindowsInTree(tree).find(
        (item) => item.uid === originalWindowUid,
      )
      return (
        savedWindow &&
        tabsInWindow(savedWindow).some(
          (tab) =>
            tab.uid === originalTabUid && tab.state === TreeItemState.Saved,
        )
      )
    }, 'Expected the final normal tab and window to remain saved.')

    await sessionTree.sendTreeCommand({
      action: 'openTab',
      tabUid: originalTabUid,
      windowUid: originalWindowUid,
    })
    await sessionTree.waitForBackgroundTree((tree) => {
      const reopenedWindow = openWindowsInTree(tree).find(
        (item) => item.uid === originalWindowUid,
      )
      if (!reopenedWindow) return false
      const reopenedTab = tabsInWindow(reopenedWindow).find(
        (tab) => tab.uid === originalTabUid,
      )
      return reopenedTab?.state === TreeItemState.Open && reopenedTab.id >= 0
    }, 'Expected one newly created normal window rebound to the saved UIDs.')

    await trackFixtureHandleByTitle(
      seed,
      extensionFixtureTitle(SESSION_FIXTURE_TITLES.initial),
    )
    await browser.switchToWindow(popup.popupHandle)
  })

  it('opens a note-only saved window and tracks Firefox automatic blank tab once', async () => {
    await openLifecycleSession()
    const original = await onlyTrackedTab(SESSION_FIXTURE_TITLES.initial)
    await sessionTree.sendTreeCommand({
      action: 'createNote',
      parentUid: original.window.uid,
      index: 1,
      text: NOTE_TEXT,
    })
    const withNote = await waitForWindowContainingNote(NOTE_TEXT)
    const noteUid = notesInWindow(withNote)[0].uid

    await sessionTree.sendTreeCommand({
      action: 'saveTab',
      tabId: original.tab.id,
      tabUid: original.tab.uid,
    })
    await sessionTree.sendTreeCommand({
      action: 'closeTab',
      tabId: -1,
      tabUid: original.tab.uid,
    })
    await sessionTree.waitForBackgroundTree((tree) => {
      const savedWindow = savedWindowsInTree(tree).find(
        (item) => item.uid === original.window.uid,
      )
      return (
        savedWindow &&
        tabsInWindow(savedWindow).length === 0 &&
        notesInWindow(savedWindow).some((note) => note.uid === noteUid)
      )
    }, 'Expected a saved note-only window before reopening.')

    await sessionTree.sendTreeCommand({
      action: 'openWindow',
      windowUid: original.window.uid,
    })
    await sessionTree.waitForBackgroundTree((tree) => {
      const reopened = openWindowsInTree(tree).find(
        (item) => item.uid === original.window.uid,
      )
      if (!reopened) return false
      const tabs = tabsInWindow(reopened)
      return (
        tabs.length === 1 &&
        tabs[0].state === TreeItemState.Open &&
        tabs[0].parentUid === undefined &&
        notesInWindow(reopened).some((note) => note.uid === noteUid)
      )
    }, 'Expected one automatic blank root tab and the original note UID.')
  })

  it('opens several selected saved tabs once in stable tree order', async () => {
    const titles = [
      SESSION_FIXTURE_TITLES.initial,
      SESSION_FIXTURE_TITLES.alpha,
      SESSION_FIXTURE_TITLES.beta,
    ]
    await openLifecycleSession(titles)
    const windowItem = await onlyOpenTreeWindow()
    const originalTabs = tabsInWindow(windowItem)
    const originalUids = originalTabs.map((tab) => tab.uid)

    for (const tab of originalTabs) {
      await sessionTree.sendTreeCommand({
        action: 'saveTab',
        tabId: tab.id,
        tabUid: tab.uid,
      })
    }
    await sessionTree.waitForBackgroundTree((tree) => {
      const saved = savedWindowsInTree(tree).find(
        (item) => item.uid === windowItem.uid,
      )
      return (
        saved &&
        tabsInWindow(saved).every((tab) => tab.state === TreeItemState.Saved)
      )
    }, 'Expected all selected lifecycle tabs to be saved.')

    await sessionTree.selectTreeItemRange(titles[0], titles[2])
    await sessionTree.captureContextMenuItems()
    await sessionTree.openTabContextMenu(titles[0])
    await sessionTree.clickCapturedContextMenuItem('Open')
    await sessionTree.waitForBackgroundTree((tree) => {
      const reopened = openWindowsInTree(tree).find(
        (item) => item.uid === windowItem.uid,
      )
      if (!reopened) return false
      const reopenedTabs = tabsInWindow(reopened)
      return (
        reopenedTabs.length === originalUids.length &&
        reopenedTabs.every(
          (tab, index) =>
            tab.uid === originalUids[index] && tab.state === TreeItemState.Open,
        )
      )
    }, 'Expected selected saved tabs to reopen once in stable tree order.')
  })

  it('restores a saved group whose members are separated by a note', async () => {
    await openLifecycleSession()
    await browser.switchToWindow(seed.originalHandle)
    await openFixtureWindow(seed, SESSION_FIXTURE_TITLES.alpha)
    await openFixtureTab(seed, SESSION_FIXTURE_TITLES.beta)
    await browser.switchToWindow(popup.popupHandle)
    await sessionTree.waitForBackgroundTree((tree) => {
      const groupedWindow = openWindowsInTree(tree).find((windowItem) => {
        const titles = tabsInWindow(windowItem).map((tab) => tab.title)
        return (
          titles.includes(SESSION_FIXTURE_TITLES.alpha) &&
          titles.includes(SESSION_FIXTURE_TITLES.beta)
        )
      })
      return Boolean(groupedWindow)
    }, 'Expected a secondary window for the grouped lifecycle fixtures.')
    await createNativeTabGroup(
      [SESSION_FIXTURE_TITLES.alpha, SESSION_FIXTURE_TITLES.beta],
      { title: GROUP_TITLE, color: 'orange', collapsed: false },
    )
    const groupedWindow = await waitForTreeGroup(GROUP_TITLE)
    const groupedTabs = tabsInWindow(groupedWindow).filter(
      (tab) => tab.tabGroup?.title === GROUP_TITLE,
    )
    const firstGroupIndex = groupedWindow.children.findIndex(
      (item) => item.uid === groupedTabs[0].uid,
    )
    await sessionTree.sendTreeCommand({
      action: 'createNote',
      parentUid: groupedWindow.uid,
      index: firstGroupIndex + 1,
      text: NOTE_TEXT,
    })
    const withNote = await waitForWindowContainingNote(NOTE_TEXT)
    const noteUid = notesInWindow(withNote)[0].uid
    const stableGroupUid = groupedTabs[0].tabGroup.uid

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
      extensionFixtureTitle(SESSION_FIXTURE_TITLES.alpha),
      extensionFixtureTitle(SESSION_FIXTURE_TITLES.beta),
    ]
    await waitForNativeGroup(
      restoredTitles,
      (snapshot) =>
        snapshot.tabs.length === 2 &&
        new Set(snapshot.tabs.map((tab) => tab.groupId)).size === 1 &&
        snapshot.groups[0]?.title === GROUP_TITLE,
    )
    await sessionTree.waitForBackgroundTree((tree) => {
      const restored = openWindowsInTree(tree).find(
        (item) => item.uid === groupedWindow.uid,
      )
      if (!restored) return false
      const members = tabsInWindow(restored).filter(
        (tab) => tab.tabGroup?.uid === stableGroupUid,
      )
      const noteIndex = restored.children.findIndex(
        (item) => item.uid === noteUid,
      )
      const memberIndexes = members.map((member) =>
        restored.children.findIndex((item) => item.uid === member.uid),
      )
      return (
        members.length === 2 &&
        noteIndex > memberIndexes[0] &&
        noteIndex < memberIndexes[1]
      )
    }, 'Expected group restoration without compacting the intervening note.')
  })

  it('opens a saved restricted URL through the redirect page', async () => {
    await openLifecycleSession()
    const original = await onlyTrackedTab(SESSION_FIXTURE_TITLES.initial)
    await sessionTree.sendTreeCommand({
      action: 'saveWindow',
      windowId: original.window.id,
      windowUid: original.window.uid,
    })
    const savedWindow = savedWindowsInTree(
      await sessionTree.backgroundTreeSnapshot(),
    )[0]
    await sessionTree.sendTreeCommand({
      action: 'importExternalUrls',
      items: [{ url: 'about:config', title: 'Firefox config' }],
      targetIndex: savedWindow.children.length,
      targetWindowUid: savedWindow.uid,
    })
    const imported = tabsInWindow(
      savedWindowsInTree(await sessionTree.backgroundTreeSnapshot())[0],
    ).find((tab) => tab.url === 'about:config')
    if (!imported) throw new Error('Expected saved about:config import.')

    await sessionTree.sendTreeCommand({
      action: 'openTab',
      tabUid: imported.uid,
      windowUid: savedWindow.uid,
    })
    await browser.waitUntil(
      async () => {
        const result = await browser.executeAsync((done) => {
          window.browser.tabs.query({}).then((tabs) =>
            done(
              tabs.some((tab) => {
                if (!tab.url?.includes('/redirect.html?')) return false
                return (
                  new URL(tab.url).searchParams.get('targetUrl') ===
                  'about:config'
                )
              }),
            ),
          )
        })
        return result === true
      },
      {
        timeout: 10_000,
        timeoutMsg: 'Expected about:config to open through redirect.html.',
      },
    )
  })

  it('reopens a saved window after capturing zero or negative coordinates', async () => {
    await openLifecycleSession()
    const original = await onlyTrackedTab(SESSION_FIXTURE_TITLES.initial)
    await sessionTree.updateSettings({
      openWindowsInSameLocation: true,
      openWindowsInSameLocationUpdateInterval: 1,
      openWindowsInSameLocationUpdateIntervalUnit: 'seconds',
    })
    await browser.executeAsync((windowId, done) => {
      window.browser.windows
        .update(windowId, {
          left: -1200,
          top: 0,
          width: 900,
          height: 700,
        })
        .then(() => done({ ok: true }))
        .catch((error) => done({ ok: false, error: String(error) }))
    }, original.window.id)
    await sessionTree.sendTreeCommand({
      action: 'openWindowsInSameLocationUpdated',
    })
    await sessionTree.waitForBackgroundTree((tree) => {
      const tracked = windowsInTree(tree).find(
        (item) => item.uid === original.window.uid,
      )
      return (
        Number.isFinite(tracked?.windowPosition?.left) &&
        Number.isFinite(tracked?.windowPosition?.top) &&
        tracked.windowPosition.width > 0 &&
        tracked.windowPosition.height > 0
      )
    }, 'Expected Firefox window bounds to be captured for restoration.')

    await sessionTree.sendTreeCommand({
      action: 'saveWindow',
      windowId: original.window.id,
      windowUid: original.window.uid,
    })
    await sessionTree.sendTreeCommand({
      action: 'openWindow',
      windowUid: original.window.uid,
    })
    await sessionTree.waitForBackgroundTree((tree) => {
      const reopened = openWindowsInTree(tree).find(
        (item) => item.uid === original.window.uid,
      )
      return Boolean(reopened && tabsInWindow(reopened).length === 1)
    }, 'Expected the positioned saved window to reopen once with stable identity.')
  })

  it('pins and unpins a native grouped tab according to Firefox events', async () => {
    const titles = [
      SESSION_FIXTURE_TITLES.initial,
      SESSION_FIXTURE_TITLES.alpha,
    ]
    await openLifecycleSession(titles)
    await createNativeTabGroup(titles, {
      title: GROUP_TITLE,
      color: 'purple',
    })
    await waitForTreeGroup(GROUP_TITLE)

    await sessionTree.captureContextMenuItems()
    await sessionTree.openTabContextMenu(SESSION_FIXTURE_TITLES.alpha)
    await sessionTree.clickCapturedContextMenuItem('Pin')
    await waitForPinnedState(SESSION_FIXTURE_TITLES.alpha, true)

    await sessionTree.captureContextMenuItems()
    await sessionTree.openTabContextMenu(SESSION_FIXTURE_TITLES.alpha)
    await sessionTree.clickCapturedContextMenuItem('Unpin')
    await waitForPinnedState(SESSION_FIXTURE_TITLES.alpha, false)
  })
})

async function openLifecycleSession(titles = [SESSION_FIXTURE_TITLES.initial]) {
  seed =
    titles.length === 1
      ? await seedSingleSessionTab(titles[0])
      : await seedSessionTabs(titles)
  popup = await openSessionTreePopup()
  sessionTree = new SessionTreePage()
  await sessionTree.expectLoaded()
  await sessionTree.updateSettings({
    focusTabOnOpen: true,
    openWindowWithTabsDiscarded: false,
    saveTabOnClose: false,
    saveWindowOnClose: false,
  })
  for (const title of titles) {
    await navigateSeededHandle(seed, title)
  }
  await browser.switchToWindow(popup.popupHandle)
  await sessionTree.waitForBackgroundTree(
    (tree) => {
      const trackedTitles = openWindowsInTree(tree).flatMap((windowItem) =>
        tabsInWindow(windowItem).map((tab) => tab.title),
      )
      return titles.every((title) => trackedTitles.includes(title))
    },
    `Expected lifecycle fixtures in tree: ${titles.join(', ')}.`,
  )
}

async function onlyTrackedTab(title) {
  const tree = await sessionTree.backgroundTreeSnapshot()
  for (const windowItem of windowsInTree(tree)) {
    const tab = tabsInWindow(windowItem).find((item) => item.title === title)
    if (tab) return { tab, window: windowItem }
  }
  throw new Error(`Expected tracked tab "${title}".`)
}

async function onlyOpenTreeWindow() {
  const tree = await sessionTree.backgroundTreeSnapshot()
  const windows = openWindowsInTree(tree)
  if (windows.length !== 1) {
    throw new Error(
      `Expected one open tree window, received ${windows.length}.`,
    )
  }
  return windows[0]
}

async function waitForWindowContainingNote(text) {
  let matchingWindow
  await sessionTree.waitForBackgroundTree((tree) => {
    matchingWindow = windowsInTree(tree).find((windowItem) =>
      notesInWindow(windowItem).some((note) => note.text === text),
    )
    return Boolean(matchingWindow)
  }, `Expected a window containing note "${text}".`)
  return matchingWindow
}

async function waitForTreeGroup(title) {
  let matchingWindow
  await sessionTree.waitForBackgroundTree((tree) => {
    matchingWindow = windowsInTree(tree).find((windowItem) =>
      tabsInWindow(windowItem).some((tab) => tab.tabGroup?.title === title),
    )
    return Boolean(matchingWindow)
  }, `Expected tree group "${title}".`)
  return matchingWindow
}

async function waitForNativeGroup(titles, predicate) {
  let lastSnapshot
  let lastError
  try {
    await browser.waitUntil(
      async () => {
        try {
          await browser.switchToWindow(popup.popupHandle)
          lastSnapshot = await nativeTabGroupSnapshot(titles)
          lastError = undefined
          return predicate(lastSnapshot)
        } catch (error) {
          lastError = String(error)
          return false
        }
      },
      {
        timeout: 10_000,
        timeoutMsg: 'Expected native lifecycle group.',
      },
    )
  } catch (error) {
    throw new Error(
      `Expected native lifecycle group. Last snapshot: ${JSON.stringify(lastSnapshot)}. Last error: ${lastError}`,
      { cause: error },
    )
  }
}

async function waitForPinnedState(title, expectedPinned) {
  await browser.waitUntil(
    async () => {
      const snapshot = await nativeTabGroupSnapshot([title])
      const browserTab = snapshot.tabs[0]
      const tree = await sessionTree.backgroundTreeSnapshot()
      const treeTab = windowsInTree(tree)
        .flatMap((windowItem) => tabsInWindow(windowItem))
        .find((tab) => tab.title === title)
      const browserGroupId = browserTab?.groupId ?? -1
      const treeGroupId = treeTab?.tabGroup?.id ?? -1
      return (
        browserTab?.pinned === expectedPinned &&
        treeTab?.pinned === expectedPinned &&
        treeGroupId === browserGroupId
      )
    },
    {
      timeout: 10_000,
      timeoutMsg: `Expected "${title}" pinned=${expectedPinned} in Firefox and tree.`,
    },
  )
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
  const remaining = await sessionTree.backgroundTreeSnapshot()
  for (const windowItem of openWindowsInTree(remaining)) {
    for (const tab of tabsInWindow(windowItem)) {
      if (tab.state !== TreeItemState.Saved) continue
      await sessionTree.sendTreeCommand({
        action: 'closeTab',
        tabId: tab.id,
        tabUid: tab.uid,
      })
    }
  }
}

async function trackUnregisteredNormalHandles() {
  if (!seed || !popup) return
  const handles = await browser.getWindowHandles()
  for (const handle of handles) {
    if (handle === popup.popupHandle || seed.handles.includes(handle)) continue
    seed.handles.push(handle)
    seed.titles.push(`lifecycle-${seed.titles.length}`)
  }
}
