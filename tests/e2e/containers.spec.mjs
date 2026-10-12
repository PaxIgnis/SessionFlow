import { browser, expect } from '@wdio/globals'
import {
  containerIdentities,
  createContainer,
  createContainerTab,
  createContainerWindow,
  removeContainer,
  removeTab,
  removeWindow,
  tabCookieStore,
  updateContainer,
  waitForTabTitle,
} from './support/containers.mjs'
import {
  cleanupSeededTabs,
  extensionFixtureTitle,
  seedSingleSessionTab,
} from './support/session-fixtures.mjs'
import {
  SessionTreePage,
  tabsInWindow,
  TreeItemState,
} from './support/session-tree-page.mjs'
import {
  closeSessionTreePopup,
  openSessionTreePopup,
} from './support/session-tree-popup.mjs'
import { createNativeTabGroup } from './support/tab-groups.mjs'
import {
  readFirefoxContextSubmenu,
  dismissFirefoxContextMenu,
} from './support/firefox-chrome-context.mjs'
import { closeOptionsPage, openOptionsPage } from './support/options-page.mjs'

const TITLES = {
  work: 'SF E2E Container Work',
  workSecond: 'SF E2E Container Work Second',
  normal: 'SF E2E Container Normal',
  banking: 'SF E2E Container Banking',
}

describe('Firefox container workflows', () => {
  let seed
  let popup
  let sessionTree
  let identities
  let tabIds
  let windowIds

  beforeEach(async () => {
    identities = []
    tabIds = []
    windowIds = []
    seed = await seedSingleSessionTab()
    popup = await openSessionTreePopup()
    sessionTree = new SessionTreePage()
    await sessionTree.expectLoaded()
    await sessionTree.updateSettings({
      containerColorIndicator: 'soft-fade',
      containerFadeSide: 'right',
      containerIconPosition: 'left',
      saveTabOnClose: false,
      saveWindowOnClose: false,
      tabGroupColorIndicator: 'right',
    })
  })

  afterEach(async () => {
    if (await switchToPopupIfOpen(popup)) {
      await cleanupContainerTreeItems()
      for (const windowId of [...windowIds].reverse()) {
        await removeWindow(windowId)
      }
      for (const tabId of [...tabIds].reverse()) await removeTab(tabId)
      for (const identity of [...identities].reverse()) {
        await removeContainer(identity.cookieStoreId)
      }
    }
    if (seed) await cleanupSeededTabs(seed)
    if (await switchToPopupIfOpen(popup)) {
      await closeSessionTreePopup(popup.originalHandle)
    }
  })

  it('captures, saves, and restores a tab in the same Firefox container', async () => {
    const identity = await trackedContainer({
      name: 'Work',
      color: 'blue',
      icon: 'briefcase',
    })
    const createdTab = await trackedContainerTab(
      identity.cookieStoreId,
      TITLES.work,
    )
    const browserTitle = extensionFixtureTitle(TITLES.work)
    const treeTab = await waitForTreeTab(browserTitle, (tab) =>
      Boolean(tab.container),
    )

    expect(treeTab.container).toMatchObject({
      cookieStoreId: identity.cookieStoreId,
      name: 'Work',
      color: 'blue',
      icon: 'briefcase',
    })

    await saveTreeTab(treeTab)
    const savedTab = await waitForTreeTab(
      browserTitle,
      (tab) => tab.state === TreeItemState.Saved,
    )
    await sessionTree.sendTreeCommand({
      action: 'openTab',
      tabUid: savedTab.uid,
      windowUid: savedTab.windowUid,
      url: savedTab.url,
    })
    const restoredTab = await waitForTreeTab(
      browserTitle,
      (tab) => tab.state === TreeItemState.Open && tab.id > 0,
    )
    tabIds.push(restoredTab.id)

    expect(await tabCookieStore(restoredTab.id)).toBe(identity.cookieStoreId)
    expect(createdTab.id).not.toBe(restoredTab.id)
  })

  it('sets and clears containers through the tab context menu while preserving tree identity', async () => {
    const work = await trackedContainer({
      name: 'Context menu Work',
      color: 'blue',
      icon: 'briefcase',
    })
    const personal = await trackedContainer({
      name: 'Context menu Personal',
      color: 'purple',
      icon: 'fingerprint',
    })
    const created = await trackedContainerTab(work.cookieStoreId, TITLES.work)
    const neighbour = await trackedContainerTab(
      work.cookieStoreId,
      TITLES.workSecond,
    )
    const title = extensionFixtureTitle(TITLES.work)
    await createNativeTabGroup(
      [title, extensionFixtureTitle(TITLES.workSecond)],
      {
        title: 'Container assignment group',
        color: 'blue',
      },
    )
    const initial = await waitForTreeTabById(
      created.id,
      (tab) =>
        Boolean(tab.container) &&
        tab.tabGroup?.title === 'Container assignment group',
    )
    await sessionTree.waitForItemTextVisible(title)

    await sessionTree.captureContextMenuItems()
    await sessionTree.openTabContextMenu(title)
    let nativeChoices
    await browser.waitUntil(
      async () => {
        nativeChoices = await readFirefoxContextSubmenu('Set Container')
        return nativeChoices.some((item) => item.label === personal.name)
      },
      {
        timeout: 10_000,
        timeoutMsg:
          'Expected the native Set Container submenu with current Firefox containers.',
      },
    )
    expect(nativeChoices[0].label).toBe('No Container')
    expect(nativeChoices[1].type).toBe('separator')
    expect(nativeChoices.at(-2).type).toBe('separator')
    expect(nativeChoices.at(-1).label).toBe('New Container')
    expect(
      nativeChoices.find((item) => item.label === personal.name).image,
    ).toContain('data:image/svg+xml,')
    await dismissFirefoxContextMenu()
    await sessionTree.clickCapturedContextMenuItem(personal.name)
    const menuItems = await browser.execute(() =>
      window.__sessionFlowE2eContextMenuItems.map(
        ({ id, parentId, title, icons }) => ({ id, parentId, title, icons }),
      ),
    )
    const parentMenu = menuItems.find((item) => item.title === 'Set Container')
    const choices = menuItems.filter((item) => item.parentId === parentMenu.id)
    expect(choices[0].title).toBe('No Container')
    expect(
      choices.find((item) => item.title === personal.name).icons['16'],
    ).toContain('data:image/svg+xml,')
    const coloredIcon = decodeURIComponent(
      choices
        .find((item) => item.title === personal.name)
        .icons['16'].split(',')[1],
    )
    expect(coloredIcon).toContain(personal.colorCode)
    expect(coloredIcon).toContain('id="fingerprint"')
    expect(menuItems.some((item) => item.title === 'Clear container')).toBe(
      false,
    )
    const changed = await waitForTreeTabByUid(
      initial.uid,
      (tab) =>
        tab.id !== created.id &&
        tab.container?.cookieStoreId === personal.cookieStoreId,
    )
    tabIds.push(changed.id)
    expect(changed.uid).toBe(initial.uid)
    expect(changed.windowUid).toBe(initial.windowUid)
    expect(changed.tabGroup?.uid).toBe(initial.tabGroup.uid)
    expect(changed.tabGroup?.id).toBe(initial.tabGroup.id)
    const groupOrder = await browser.executeAsync((groupId, done) => {
      window.browser.tabs
        .query({ groupId })
        .then((tabs) => done(tabs.map((tab) => tab.id)))
    }, initial.tabGroup.id)
    expect(groupOrder).toEqual([changed.id, neighbour.id])
    expect(await tabCookieStore(changed.id)).toBe(personal.cookieStoreId)
    expect(await tabCookieStore(created.id)).toBeNull()

    await sessionTree.captureContextMenuItems()
    await sessionTree.openTabContextMenu(title)
    await sessionTree.clickCapturedContextMenuItem('No Container')
    const cleared = await waitForTreeTabByUid(
      initial.uid,
      (tab) => !tab.container && tab.id !== changed.id,
    )
    tabIds.push(cleared.id)
    expect(await tabCookieStore(cleared.id)).toBe('firefox-default')
    expect(await tabCookieStore(changed.id)).toBeNull()
    expect(cleared.tabGroup?.uid).toBe(initial.tabGroup.uid)
    expect(cleared.tabGroup?.id).toBe(initial.tabGroup.id)

    await saveTreeTab(cleared)
    await waitForTreeTabByUid(
      initial.uid,
      (tab) => tab.state === TreeItemState.Saved,
    )
    await sessionTree.captureContextMenuItems()
    await sessionTree.openTabContextMenu(title)
    await sessionTree.clickCapturedContextMenuItem(work.name)
    const saved = await waitForTreeTabByUid(
      initial.uid,
      (tab) => tab.container?.cookieStoreId === work.cookieStoreId,
    )
    expect(saved.state).toBe(TreeItemState.Saved)
    expect(saved.id).toBeLessThan(1)
    await sessionTree.sendTreeCommand({
      action: 'openTab',
      tabUid: saved.uid,
      windowUid: saved.windowUid,
    })
    const restored = await waitForTreeTabByUid(
      initial.uid,
      (tab) => tab.state === TreeItemState.Open && tab.id > 0,
    )
    tabIds.push(restored.id)
    expect(await tabCookieStore(restored.id)).toBe(work.cookieStoreId)
  })

  it('creates a container and applies it to selected open and saved tabs', async () => {
    const originalContainer = await trackedContainer({
      name: 'Original',
      color: 'blue',
      icon: 'briefcase',
    })
    const created = await trackedContainerTab(
      originalContainer.cookieStoreId,
      TITLES.work,
    )
    const title = extensionFixtureTitle(TITLES.work)
    const initial = await waitForTreeTabById(created.id, (tab) =>
      Boolean(tab.container),
    )
    const savedBrowserTab = await trackedContainerTab(
      originalContainer.cookieStoreId,
      TITLES.workSecond,
    )
    const savedTitle = extensionFixtureTitle(TITLES.workSecond)
    const savedInitial = await waitForTreeTabById(savedBrowserTab.id, (tab) =>
      Boolean(tab.container),
    )
    await saveTreeTab(savedInitial)
    await waitForTreeTabByUid(
      savedInitial.uid,
      (tab) => tab.state === TreeItemState.Saved,
    )
    await waitForSavedTreeItem(savedInitial.uid, savedTitle)
    const before = await containerIdentities()

    await sessionTree.captureContextMenuItems()
    await sessionTree.openTabContextMenu(title)
    await sessionTree.clickCapturedContextMenuItem('New Container')
    const modal = await browser.$('.create-container-modal')
    await expect(modal).toBeDisplayed()
    await expect(modal.$('button[type="submit"]')).toBeDisabled()
    await browser.keys('Escape')
    await expect(modal).not.toExist()
    expect((await containerIdentities()).length).toBe(before.length)

    await sessionTree.selectTreeItemRange(title, savedTitle)
    await sessionTree.captureContextMenuItems()
    await sessionTree.openTabContextMenu(title)
    await sessionTree.clickCapturedContextMenuItem('New Container')
    const input = await browser.$('#container-name')
    await input.setValue('   ')
    await expect(
      browser.$('.create-container-modal button[type="submit"]'),
    ).toBeDisabled()
    const name = `SF E2E New Container ${Date.now()}`
    await input.setValue(name)
    await browser
      .$('.container-choice:has(input[name="container-color"][value="orange"])')
      .click()
    await browser
      .$('.container-choice:has(input[name="container-icon"][value="fruit"])')
      .click()
    await browser.$('.create-container-modal button[type="submit"]').click()
    await expect(browser.$('.create-container-modal')).not.toExist()
    let identity
    await browser.waitUntil(
      async () => {
        identity = (await containerIdentities()).find(
          (item) => item.name === name,
        )
        return Boolean(identity)
      },
      {
        timeout: 10_000,
        timeoutMsg: 'Expected the container created from the modal.',
      },
    )
    identities.push(identity)
    expect(identity).toMatchObject({ name, color: 'orange', icon: 'fruit' })
    const assigned = await waitForTreeTabByUid(
      initial.uid,
      (tab) =>
        tab.container?.cookieStoreId === identity.cookieStoreId &&
        tab.id !== created.id,
    )
    tabIds.push(assigned.id)
    expect(await tabCookieStore(assigned.id)).toBe(identity.cookieStoreId)
    expect(await tabCookieStore(created.id)).toBeNull()
    const savedAssigned = await waitForTreeTabByUid(
      savedInitial.uid,
      (tab) => tab.container?.cookieStoreId === identity.cookieStoreId,
    )
    expect(savedAssigned.state).toBe(TreeItemState.Saved)
    expect(savedAssigned.id).toBeLessThan(1)
    expect(await tabCookieStore(savedBrowserTab.id)).toBeNull()
  })

  it('refreshes saved container metadata when Firefox updates an identity', async () => {
    const identity = await trackedContainer({
      name: 'Work',
      color: 'blue',
      icon: 'briefcase',
    })
    await trackedContainerTab(identity.cookieStoreId, TITLES.work)
    const browserTitle = extensionFixtureTitle(TITLES.work)
    await waitForTreeTab(browserTitle, (tab) => tab.container?.name === 'Work')

    const updated = await updateContainer(identity.cookieStoreId, {
      name: 'Focused Work',
      color: 'purple',
      icon: 'fingerprint',
    })
    identities[identities.indexOf(identity)] = updated
    const treeTab = await waitForTreeTab(
      browserTitle,
      (tab) =>
        tab.container?.name === 'Focused Work' &&
        tab.container?.color === 'purple' &&
        tab.container?.icon === 'fingerprint',
    )

    expect(treeTab.container.cookieStoreId).toBe(identity.cookieStoreId)
    expect(treeTab.container.colorCode).toBe(updated.colorCode)
  })

  it('restores normal and distinct-container tabs in one saved window', async () => {
    const work = await trackedContainer({
      name: 'Work',
      color: 'blue',
      icon: 'briefcase',
    })
    const banking = await trackedContainer({
      name: 'Banking',
      color: 'green',
      icon: 'dollar',
    })
    const created = await createContainerWindow([
      { title: TITLES.normal },
      { title: TITLES.work, cookieStoreId: work.cookieStoreId },
      { title: TITLES.banking, cookieStoreId: banking.cookieStoreId },
    ])
    windowIds.push(created.windowId)
    tabIds.push(...created.tabs.map((tab) => tab.id))
    const normalTitle = extensionFixtureTitle(TITLES.normal)
    const workTitle = extensionFixtureTitle(TITLES.work)
    const bankingTitle = extensionFixtureTitle(TITLES.banking)
    const treeWindow = await waitForTreeWindow(
      (window) =>
        [normalTitle, workTitle, bankingTitle].every((title) =>
          tabsInWindow(window).some((tab) => tab.title === title),
        ),
      'Expected the mixed-container browser window in the tree.',
    )

    await sessionTree.sendTreeCommand({
      action: 'saveWindow',
      windowId: treeWindow.id,
      windowUid: treeWindow.uid,
    })
    const savedWindow = await waitForTreeWindow(
      (window) =>
        window.uid === treeWindow.uid && window.state === TreeItemState.Saved,
      'Expected the mixed-container window to be saved.',
    )
    await sessionTree.sendTreeCommand({
      action: 'openWindow',
      windowUid: savedWindow.uid,
    })
    const restoredWindow = await waitForTreeWindow(
      (window) =>
        window.uid === treeWindow.uid &&
        window.state === TreeItemState.Open &&
        tabsInWindow(window).every((tab) => tab.id > 0),
      'Expected the mixed-container window to reopen.',
    )
    windowIds.push(restoredWindow.id)
    const tabs = tabsInWindow(restoredWindow)
    const expectedTitles = [normalTitle, workTitle, bankingTitle]
    expect(tabs.map((tab) => tab.title)).toEqual(expectedTitles)
    const storeByTitle = Object.fromEntries(
      await Promise.all(
        tabs.map(async (tab) => [tab.title, await tabCookieStore(tab.id)]),
      ),
    )

    expect(storeByTitle[normalTitle]).toBe('firefox-default')
    expect(storeByTitle[workTitle]).toBe(work.cookieStoreId)
    expect(storeByTitle[bankingTitle]).toBe(banking.cookieStoreId)
  })

  it('opens only the requested saved tab without its missing container', async () => {
    const identity = await trackedContainer({
      name: 'Work',
      color: 'blue',
      icon: 'briefcase',
    })
    const firstBrowserTab = await trackedContainerTab(
      identity.cookieStoreId,
      TITLES.work,
    )
    const secondBrowserTab = await trackedContainerTab(
      identity.cookieStoreId,
      TITLES.workSecond,
    )
    const firstTitle = extensionFixtureTitle(TITLES.work)
    const secondTitle = extensionFixtureTitle(TITLES.workSecond)
    const first = await waitForTreeTabById(firstBrowserTab.id, (tab) =>
      Boolean(tab.container),
    )
    const second = await waitForTreeTabById(secondBrowserTab.id, (tab) =>
      Boolean(tab.container),
    )
    await saveTreeTab(first)
    await saveTreeTab(second)
    await waitForSavedTreeItem(first.uid, firstTitle)
    await waitForSavedTreeItem(second.uid, secondTitle)
    await removeContainer(identity.cookieStoreId)

    await openSavedTabFromTree(first.uid)
    await expect(await sessionTree.containerRecoveryModal()).toBeDisplayed()
    await sessionTree.cancelContainerRecovery()
    await expect(await sessionTree.containerRecoveryModal()).not.toExist()
    await waitForTreeTabByUid(
      first.uid,
      (tab) =>
        tab.state === TreeItemState.Saved &&
        tab.container?.cookieStoreId === identity.cookieStoreId,
    )

    await openSavedTabFromTree(first.uid)
    await expect(await sessionTree.containerRecoveryModal()).toBeDisplayed()
    await sessionTree.openWithoutMissingContainers()
    const reopened = await waitForTreeTabByUid(
      first.uid,
      (tab) => tab.state === TreeItemState.Open && tab.id > 0 && !tab.container,
    )
    tabIds.push(reopened.id)
    const untouched = await waitForTreeTabByUid(
      second.uid,
      (tab) =>
        tab.state === TreeItemState.Saved &&
        tab.container?.cookieStoreId === identity.cookieStoreId,
    )

    expect(await tabCookieStore(reopened.id)).toBe('firefox-default')
    expect(untouched.container.name).toBe('Work')
  })

  it('blocks a missing container, recreates it, and remaps matching saved tabs', async () => {
    const identity = await trackedContainer({
      name: 'Work',
      color: 'blue',
      icon: 'briefcase',
    })
    const firstBrowserTab = await trackedContainerTab(
      identity.cookieStoreId,
      TITLES.work,
    )
    const secondBrowserTab = await trackedContainerTab(
      identity.cookieStoreId,
      TITLES.workSecond,
    )
    const firstTitle = extensionFixtureTitle(TITLES.work)
    const secondTitle = extensionFixtureTitle(TITLES.workSecond)
    const first = await waitForTreeTabById(firstBrowserTab.id, (tab) =>
      Boolean(tab.container),
    )
    const second = await waitForTreeTabById(secondBrowserTab.id, (tab) =>
      Boolean(tab.container),
    )
    await saveTreeTab(first)
    await saveTreeTab(second)
    await waitForSavedTreeItem(first.uid, firstTitle)
    await waitForSavedTreeItem(second.uid, secondTitle)
    await removeContainer(identity.cookieStoreId)

    await openSavedTabFromTree(first.uid)
    await expect(await sessionTree.containerRecoveryModal()).toBeDisplayed()
    await sessionTree.recreateMissingContainersAndOpen()
    const reopened = await waitForTreeTabByUid(
      first.uid,
      (tab) => tab.state === TreeItemState.Open && tab.id > 0,
    )
    tabIds.push(reopened.id)
    const remappedSecond = await waitForTreeTabByUid(
      second.uid,
      (tab) =>
        tab.state === TreeItemState.Saved &&
        tab.container?.cookieStoreId !== identity.cookieStoreId,
    )
    const newStoreId = remappedSecond.container.cookieStoreId
    const recreated = (await containerIdentities()).find(
      (candidate) => candidate.cookieStoreId === newStoreId,
    )
    expect(recreated).toBeDefined()
    identities.push(recreated)

    expect(recreated).toMatchObject({
      name: 'Work',
      color: 'blue',
      icon: 'briefcase',
    })
    expect(await tabCookieStore(reopened.id)).toBe(newStoreId)
  })

  it('applies container settings without obscuring a tab-group marker', async () => {
    const identity = await trackedContainer({
      name: 'Work',
      color: 'blue',
      icon: 'briefcase',
    })
    const browserTab = await trackedContainerTab(
      identity.cookieStoreId,
      TITLES.work,
    )
    const browserTitle = extensionFixtureTitle(TITLES.work)
    const treeTab = await waitForTreeTabById(browserTab.id, (tab) =>
      Boolean(tab.container),
    )
    await waitForTabTitle(browserTab.id, browserTitle)
    await createNativeTabGroup([browserTitle], {
      title: 'Container Group',
      color: 'purple',
    })
    await waitForTreeTab(
      browserTitle,
      (tab) => tab.tabGroup?.title === 'Container Group',
    )
    const treeItem = await sessionTree.treeItemByUid(treeTab.uid)

    await expect(
      await treeItem.$(
        '.tree-item-container-indicator-soft-fade-right.tree-item-container-fade-end-inset',
      ),
    ).toBeExisting()
    await expect(
      await treeItem.$('.tree-item-container-icon-left'),
    ).toBeExisting()
    expect(
      await treeItem
        .$('.tree-item-container-icon-left use')
        .getAttribute('href'),
    ).toBe('/icons/usercontext.svg#briefcase')
    await expect(
      await treeItem.$('.tree-item-tab-group-indicator-right'),
    ).toBeExisting()

    const fadeOptions = await openOptionsPage()
    await fadeOptions.page.setToggle('Color indicator', 'Strong Fade')
    await fadeOptions.page.setToggle('Fade side', 'Left')
    await fadeOptions.page.setToggle('Container icon', 'Right')
    await fadeOptions.page.expectStoredSetting(
      'containerColorIndicator',
      'strong-fade',
    )
    await fadeOptions.page.expectStoredSetting('containerFadeSide', 'left')
    await fadeOptions.page.expectStoredSetting('containerIconPosition', 'right')
    await closeOptionsPage(fadeOptions.optionsHandle, popup.popupHandle)
    await browser.waitUntil(
      async () =>
        (await treeItem
          .$('.tree-item-container-indicator-strong-fade-left')
          .isExisting()) &&
        (await treeItem.$('.tree-item-container-icon-right').isExisting()),
      {
        timeout: 10_000,
        timeoutMsg: 'Expected a strong left fade and right container icon.',
      },
    )

    const hiddenOptions = await openOptionsPage()
    await hiddenOptions.page.setToggle('Color indicator', 'Off')
    await hiddenOptions.page.setToggle('Container icon', 'Off')
    await hiddenOptions.page.expectStoredSetting(
      'containerColorIndicator',
      'off',
    )
    await hiddenOptions.page.expectStoredSetting('containerFadeSide', 'left')
    await hiddenOptions.page.expectStoredSetting('containerIconPosition', 'off')
    await closeOptionsPage(hiddenOptions.optionsHandle, popup.popupHandle)
    await browser.waitUntil(
      async () =>
        !(await treeItem.$('.tree-item-container-indicator').isExisting()) &&
        !(await treeItem.$('.tree-item-container-icon').isExisting()) &&
        (await treeItem.$('.tree-item-tab-group-indicator-right').isExisting()),
      {
        timeout: 10_000,
        timeoutMsg: 'Expected the group marker without container presentation.',
      },
    )
  })

  async function trackedContainer(details) {
    const identity = await createContainer(details)
    identities.push(identity)
    return identity
  }

  async function trackedContainerTab(cookieStoreId, title) {
    const tab = await createContainerTab(cookieStoreId, title)
    tabIds.push(tab.id)
    await waitForTabTitle(tab.id, extensionFixtureTitle(title))
    return tab
  }

  async function saveTreeTab(tab) {
    await sessionTree.sendTreeCommand({
      action: 'saveTab',
      tabId: tab.id,
      tabUid: tab.uid,
    })
  }

  async function waitForTreeTab(title, predicate) {
    let found
    await sessionTree.waitForBackgroundTree((tree) => {
      found = allTreeTabs(tree).find((tab) => tab.title === title)
      return Boolean(found && predicate(found))
    }, `Expected tree tab "${title}" to satisfy the condition.`)
    return found
  }

  async function waitForTreeTabById(tabId, predicate) {
    let found
    await sessionTree.waitForBackgroundTree((tree) => {
      found = allTreeTabs(tree).find((tab) => tab.id === tabId)
      return Boolean(found && predicate(found))
    }, `Expected browser tab ${tabId} in the background tree.`)
    return found
  }

  async function waitForTreeTabByUid(tabUid, predicate) {
    let found
    await sessionTree.waitForBackgroundTree((tree) => {
      found = allTreeTabs(tree).find((tab) => tab.uid === tabUid)
      return Boolean(found && predicate(found))
    }, `Expected tree tab ${tabUid} to satisfy the condition.`)
    return found
  }

  async function waitForTreeWindow(predicate, message) {
    let found
    await sessionTree.waitForBackgroundTree((tree) => {
      found = tree.find(
        (item) => Array.isArray(item.children) && predicate(item),
      )
      return Boolean(found)
    }, message)
    return found
  }

  async function openSavedTabFromTree(tabUid) {
    const item = await sessionTree.treeItemByUid(tabUid)
    await expect(item).toBeDisplayed()
    await item.doubleClick()
  }

  async function waitForSavedTreeItem(tabUid, title) {
    const item = await sessionTree.treeItemByUid(tabUid)
    await browser.waitUntil(
      async () => await item.$('.tree-item-text-saved').isExisting(),
      {
        timeout: 10_000,
        timeoutMsg: `Expected foreground tree tab "${title}" to be saved.`,
      },
    )
  }

  async function cleanupContainerTreeItems() {
    if (!sessionTree) return
    const tree = await sessionTree.backgroundTreeSnapshot()
    for (const windowItem of tree) {
      if (!Array.isArray(windowItem.children)) continue
      const tabs = tabsInWindow(windowItem)
      const fixtureTabs = tabs.filter(isContainerFixtureTab)
      if (fixtureTabs.length === 0) continue
      if (fixtureTabs.length === tabs.length) {
        await sessionTree.sendTreeCommand({
          action: 'closeWindow',
          windowId: windowItem.id,
          windowUid: windowItem.uid,
        })
        continue
      }
      for (const tab of fixtureTabs) {
        await sessionTree.sendTreeCommand({
          action: 'closeTab',
          tabId: tab.id,
          tabUid: tab.uid,
        })
      }
    }
  }
})

function allTreeTabs(tree) {
  return tree.flatMap((item) =>
    Array.isArray(item.children) ? tabsInWindow(item) : [],
  )
}

function isContainerFixtureTab(tab) {
  return tab.title.startsWith('Redirect to SF E2E Container ')
}

async function switchToPopupIfOpen(popup) {
  if (!popup?.popupHandle) return false
  const handles = await browser.getWindowHandles()
  if (!handles.includes(popup.popupHandle)) return false
  await browser.switchToWindow(popup.popupHandle)
  return true
}
