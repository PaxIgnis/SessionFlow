import { $, browser, expect } from '@wdio/globals'
import {
  cleanupSeededTabs,
  createPrivateFixtureTabs,
  extensionFixtureTitle,
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
import { FIREFOX_EXTENSION_ID } from './support/firefox-extension.mjs'
import { setFirefoxExtensionPrivateBrowsingAllowed } from './support/firefox-chrome-context.mjs'

describe('Firefox private-window permission transitions', () => {
  let seed
  let popup
  let sessionTree

  beforeEach(async () => {
    seed = await seedSingleSessionTab('PD Private Normal')
    popup = await openSessionTreePopup()
    sessionTree = new SessionTreePage()
    await sessionTree.expectLoaded()
  })

  afterEach(async () => {
    await setFirefoxExtensionPrivateBrowsingAllowed(
      FIREFOX_EXTENSION_ID,
      true,
    ).catch(() => false)
    if (seed) await cleanupSeededTabs(seed)
    if (popup?.popupHandle) {
      const handles = await browser.getWindowHandles()
      if (handles.includes(popup.popupHandle)) {
        await browser.switchToWindow(popup.popupHandle)
        await closeSessionTreePopup(popup.originalHandle)
      }
    }
  })

  it('keeps saved private items intact and blocks opening after access is revoked (PD-PW-02)', async () => {
    const privateFixture = await createPrivateFixtureTabs(seed, [
      'PD Private Saved',
    ])
    const privateTitle = extensionFixtureTitle('PD Private Saved')
    let privateWindow
    await sessionTree.waitForBackgroundTree((tree) => {
      privateWindow = windowsInTree(tree).find(
        (candidate) =>
          candidate.incognito &&
          tabsInWindow(candidate).some((tab) => tab.title === privateTitle),
      )
      return Boolean(privateWindow)
    }, 'Expected the private fixture window in the tree.')
    await sessionTree.sendTreeCommand({
      action: 'updateWindowTitle',
      windowUid: privateWindow.uid,
      newTitle: 'PD Saved Private Window',
    })
    await sessionTree.sendTreeCommand({
      action: 'saveWindow',
      windowId: privateWindow.id,
      windowUid: privateWindow.uid,
    })
    await sessionTree.waitForBackgroundTree(
      (tree) =>
        windowsInTree(tree).some(
          (candidate) =>
            candidate.uid === privateWindow.uid &&
            candidate.state === TreeItemState.Saved,
        ),
      'Expected the private window to remain saved before revocation.',
    )

    expect(
      await setFirefoxExtensionPrivateBrowsingAllowed(
        FIREFOX_EXTENSION_ID,
        false,
      ),
    ).toBe(true)
    await browser.switchToWindow(popup.popupHandle)
    const item = await sessionTree.windowItemByText('PD Saved Private Window')
    await expect(item).toBeDisplayed()
    await item.doubleClick()

    const notification = await $('.sessiontree-notification')
    await expect(notification).toBeDisplayed()
    expect(await notification.getText()).toContain(
      'private-window access isn’t enabled in Firefox',
    )
    const after = await sessionTree.backgroundTreeSnapshot()
    const saved = windowsInTree(after).find(
      (candidate) => candidate.uid === privateWindow.uid,
    )
    expect(saved).toMatchObject({
      incognito: true,
      state: TreeItemState.Saved,
    })
    expect(tabsInWindow(saved)).toHaveLength(1)
    expect(privateFixture.windowId).toBeGreaterThan(0)
  })
})
