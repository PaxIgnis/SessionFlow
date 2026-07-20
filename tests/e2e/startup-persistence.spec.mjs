import { $, browser, expect } from '@wdio/globals'
import {
  createBlankCleanupWindow,
  readStoredSessionTree,
  reloadExtensionBackground,
  removeTabsByTitles,
  writeStoredSessionTree,
} from './support/extension-lifecycle.mjs'
import { SESSION_TREE_URL } from './support/firefox-extension.mjs'
import {
  fixtureDataUrl,
  openFixtureTab,
  openFixtureWindow,
} from './support/session-fixtures.mjs'
import { createNativeTabGroup } from './support/tab-groups.mjs'
import {
  SessionTreePage,
  TreeItemState,
  tabsInWindow,
  windowsInTree,
} from './support/session-tree-page.mjs'
import {
  closeSessionTreePopup,
  openSessionTreePopup,
} from './support/session-tree-popup.mjs'

const RESTART_MARKER_KEY = 'sessionFlowE2eRestartMarker'
const TITLES = {
  alpha: 'SF Restart Alpha',
  beta: 'SF Restart Beta',
  gamma: 'SF Restart Gamma',
}

describe('Firefox startup and persistent data', () => {
  it('preserves extension local storage across a Firefox process restart', async () => {
    const marker = `restart-${Date.now()}`
    await openSessionTreePage()
    const stored = await browser.executeAsync(
      (key, value, done) => {
        window.browser.storage.local
          .set({ [key]: value })
          .then(() => done({ ok: true }))
          .catch((error) => done({ ok: false, error: String(error) }))
      },
      RESTART_MARKER_KEY,
      marker,
    )
    expect(stored).toEqual({ ok: true })

    await browser.reloadSession()
    await openSessionTreePage()

    const storedMarker = await browser.executeAsync((key, done) => {
      window.browser.storage.local
        .get(key)
        .then((result) => done({ ok: true, value: result[key] }))
        .catch((error) => done({ ok: false, error: String(error) }))
    }, RESTART_MARKER_KEY)
    expect(storedMarker).toEqual({ ok: true, value: marker })
  })

  it('ST-01/ST-12/ST-13 reconciles a complete persisted tree after Firefox restarts', async () => {
    const extensionPageHandle = await browser.getWindowHandle()
    const seed = { handles: [], titles: [] }
    await openFixtureWindow(seed, TITLES.alpha)
    await openFixtureTab(seed, TITLES.beta)
    await openFixtureWindow(seed, TITLES.gamma)
    await browser.switchToWindow(extensionPageHandle)
    await browser.closeWindow()
    await browser.switchToWindow(seed.handles[0])

    let popup = await openSessionTreePopup()
    let sessionTree = new SessionTreePage()
    await sessionTree.expectLoaded()
    await sessionTree.waitForBackgroundTree(
      (tree) =>
        TITLES.alpha in tabsByTitle(tree) &&
        TITLES.beta in tabsByTitle(tree) &&
        TITLES.gamma in tabsByTitle(tree),
      'Expected every restart fixture to be tracked before persistence.',
    )

    const { group } = await createNativeTabGroup([TITLES.alpha, TITLES.beta], {
      title: 'Restart group',
      color: 'blue',
      collapsed: false,
    })
    const groupId = group.id
    await sessionTree.waitForBackgroundTree((tree) => {
      const tabs = tabsByTitle(tree)
      return (
        tabs[TITLES.alpha]?.tabGroup?.id === groupId &&
        tabs[TITLES.beta]?.tabGroup?.id === groupId
      )
    }, 'Expected the native group to be synchronized before restart.')

    const beforeRestart = await sessionTree.backgroundTreeSnapshot()
    const groupedTabs = tabsByTitle(beforeRestart)
    const groupedAlpha = groupedTabs[TITLES.alpha]
    const groupedBeta = groupedTabs[TITLES.beta]
    const groupedGamma = groupedTabs[TITLES.gamma]
    const alphaWindow = windowsInTree(beforeRestart).find((windowItem) =>
      tabsInWindow(windowItem).some((tab) => tab.uid === groupedAlpha.uid),
    )
    groupedBeta.parentUid = groupedAlpha.uid
    groupedBeta.indentLevel = 2
    groupedBeta.customLabel = 'Restart child custom label'
    alphaWindow.children.push(
      {
        type: 2,
        uid: 'restart-note',
        text: 'Restart note',
        selected: false,
        windowUid: alphaWindow.uid,
        indentLevel: 1,
      },
      {
        type: 3,
        uid: 'restart-separator',
        selected: false,
        windowUid: alphaWindow.uid,
        indentLevel: 1,
        isParent: false,
        collapsed: false,
      },
      {
        type: 1,
        uid: 'restart-saved-tab',
        active: false,
        id: 0,
        selected: false,
        state: TreeItemState.Saved,
        title: 'Restart saved tab',
        url: 'https://example.test/restart-saved',
        windowUid: alphaWindow.uid,
        indentLevel: 1,
        pinned: false,
      },
    )
    beforeRestart.push({
      type: 0,
      uid: 'restart-saved-window',
      id: 0,
      incognito: false,
      selected: false,
      state: TreeItemState.Saved,
      children: [],
      indentLevel: 0,
      title: 'Restart saved window',
    })
    await writeStoredSessionTree(beforeRestart)
    const expectedUids = allTreeUids(beforeRestart)
    const beforeNativeIds = new Map(
      [groupedAlpha, groupedBeta, groupedGamma].map((tab) => [tab.uid, tab.id]),
    )
    const stableGroupUid = groupedAlpha.tabGroup.uid

    await closeSessionTreePopup(popup.originalHandle)
    await browser.reloadSession()

    popup = await openSessionTreePopup()
    sessionTree = new SessionTreePage()
    await sessionTree.expectLoaded()
    await sessionTree.waitForBackgroundTree((tree) => {
      const tabs = tabsByTitle(tree)
      return (
        tabs[TITLES.alpha]?.uid === groupedAlpha.uid &&
        tabs[TITLES.beta]?.uid === groupedBeta.uid &&
        tabs[TITLES.gamma]?.uid === groupedGamma.uid
      )
    }, 'Expected Firefox-restored tabs to reconcile to their persisted UIDs.')

    const afterRestart = await sessionTree.backgroundTreeSnapshot()
    const afterTabs = tabsByTitle(afterRestart)
    expect(allTreeUids(afterRestart)).toEqual(expectedUids)
    expect(afterTabs[TITLES.beta]).toMatchObject({
      uid: groupedBeta.uid,
      parentUid: groupedAlpha.uid,
      indentLevel: 2,
      customLabel: 'Restart child custom label',
    })
    expect(afterTabs[TITLES.alpha].tabGroup).toMatchObject({
      uid: stableGroupUid,
      title: 'Restart group',
      color: 'blue',
    })
    expect(afterTabs[TITLES.beta].tabGroup?.uid).toBe(stableGroupUid)
    expect(afterTabs['Restart saved tab']).toMatchObject({
      uid: 'restart-saved-tab',
      state: TreeItemState.Saved,
    })
    expect(
      windowsInTree(afterRestart).find(
        (windowItem) => windowItem.uid === 'restart-saved-window',
      ),
    ).toMatchObject({ state: TreeItemState.Saved })
    expect(findItemByUid(afterRestart, 'restart-note')).toMatchObject({
      text: 'Restart note',
    })
    expect(findItemByUid(afterRestart, 'restart-separator')).toBeDefined()
    expect(
      [groupedAlpha.uid, groupedBeta.uid, groupedGamma.uid].some(
        (uid) =>
          beforeNativeIds.get(uid) !== findItemByUid(afterRestart, uid)?.id,
      ),
    ).toBe(true)

    await createBlankCleanupWindow()
    await removeTabsByTitles(Object.values(TITLES))
    await closeSessionTreePopup(popup.originalHandle)
  })

  it('ST-23 persists a tree mutation after the popup closes', async () => {
    const popup = await openSessionTreePopup()
    const sessionTree = new SessionTreePage()
    await sessionTree.expectLoaded()
    const before = await sessionTree.backgroundTreeSnapshot()
    const targetWindow = windowsInTree(before).find(
      (windowItem) => windowItem.state === TreeItemState.Open,
    )
    if (!targetWindow) throw new Error('Expected an open window for ST-23.')

    await sessionTree.sendTreeCommand({
      action: 'createNote',
      parentUid: targetWindow.uid,
      text: 'Periodic popup-close note',
    })
    await sessionTree.waitForBackgroundTree(
      (tree) =>
        Boolean(
          windowsInTree(tree)
            .flatMap((windowItem) => windowItem.children)
            .find((item) => item.text === 'Periodic popup-close note'),
        ),
      'Expected the note mutation before closing the popup.',
    )

    await closeSessionTreePopup(popup.originalHandle)
    await browser.pause(61_000)

    const reopenedPopup = await openSessionTreePopup()
    const reopenedSessionTree = new SessionTreePage()
    await reopenedSessionTree.expectLoaded()
    const storedTree = await readStoredSessionTree()
    const storedNote = windowsInTree(storedTree)
      .flatMap((windowItem) => windowItem.children)
      .find((item) => item.text === 'Periodic popup-close note')
    expect(storedNote).toBeDefined()

    await reopenedSessionTree.sendTreeCommand({
      action: 'removeNote',
      noteUid: storedNote.uid,
    })
    await closeSessionTreePopup(reopenedPopup.originalHandle)
  })

  it('ST-24 reconciles the same tree after the extension background reloads', async () => {
    const originalHandle = await browser.getWindowHandle()
    await browser.url(fixtureDataUrl('SF Background Reload'))
    const popup = await openSessionTreePopup()
    let sessionTree = new SessionTreePage()
    await sessionTree.expectLoaded()
    await sessionTree.waitForBackgroundTree(
      (tree) => Boolean(tabsByTitle(tree)['SF Background Reload']),
      'Expected the background-reload fixture before reloading the extension.',
    )
    const beforeReload = await sessionTree.backgroundTreeSnapshot()
    const beforeTab = tabsByTitle(beforeReload)['SF Background Reload']
    await writeStoredSessionTree(beforeReload)

    await reloadExtensionBackground()
    await browser.pause(2_000)

    const handles = await browser.getWindowHandles()
    let activePopup = popup
    if (handles.includes(popup.popupHandle)) {
      await browser.switchToWindow(popup.popupHandle)
      await browser.refresh()
    } else {
      await browser.switchToWindow(originalHandle)
      activePopup = await openSessionTreePopup()
    }
    sessionTree = new SessionTreePage()
    await sessionTree.expectLoaded()
    await sessionTree.waitForBackgroundTree(
      (tree) =>
        tabsByTitle(tree)['SF Background Reload']?.uid === beforeTab.uid,
      'Expected the live tab to reconcile to the same UID after background reload.',
    )

    await browser.switchToWindow(originalHandle)
    await browser.newWindow(fixtureDataUrl('SF After Background Reload'), {
      type: 'tab',
    })
    await browser.switchToWindow(activePopup.popupHandle)
    await sessionTree.waitForBackgroundTree(
      (tree) => Boolean(tabsByTitle(tree)['SF After Background Reload']),
      'Expected the reinitialized background to process a new browser tab.',
    )

    await createBlankCleanupWindow()
    await removeTabsByTitles([
      'SF Background Reload',
      'SF After Background Reload',
    ])
    await closeSessionTreePopup(activePopup.originalHandle)
  })
})

async function openSessionTreePage() {
  await browser.url(SESSION_TREE_URL)
  await browser.waitUntil(
    async () => (await browser.getUrl()).startsWith(SESSION_TREE_URL),
    {
      timeout: 10_000,
      timeoutMsg:
        'Expected the persistent Firefox profile to retain SessionFlow after restart.',
    },
  )
  await expect(await $('#sessiontree')).toBeExisting()
}

function tabsByTitle(tree) {
  return Object.fromEntries(
    windowsInTree(tree)
      .flatMap((windowItem) => tabsInWindow(windowItem))
      .map((tab) => [tab.title, tab]),
  )
}

function allTreeUids(tree) {
  const uids = []
  for (const item of tree) {
    uids.push(item.uid)
    if (item.type === 0) {
      for (const child of item.children) uids.push(child.uid)
    }
  }
  return new Set(uids)
}

function findItemByUid(tree, uid) {
  for (const item of tree) {
    if (item.uid === uid) return item
    if (item.type === 0) {
      const child = item.children.find((candidate) => candidate.uid === uid)
      if (child) return child
    }
  }
  return undefined
}
