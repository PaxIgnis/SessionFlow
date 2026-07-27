import { browser } from '@wdio/globals'
import {
  createBlankCleanupWindow,
  reloadExtensionBackgroundPage,
  removeTabsByTitles,
} from './support/extension-lifecycle.mjs'
import { fixtureDataUrl } from './support/session-fixtures.mjs'
import { SessionTreePage } from './support/session-tree-page.mjs'
import {
  closeSessionTreePopup,
  closeSessionTreePopupHandle,
  openAdditionalSessionTreePopup,
  openSessionTreePopup,
} from './support/session-tree-popup.mjs'

describe('runtime synchronization workflows', () => {
  it('reconnects an open popup after the background page reloads (RT-03)', async () => {
    const beforeTitle = 'SF Runtime Before Reload'
    const afterTitle = 'SF Runtime After Reload'
    const originalHandle = await browser.getWindowHandle()
    await browser.url(fixtureDataUrl(beforeTitle))
    const popup = await openSessionTreePopup()
    const sessionTree = new SessionTreePage()
    await sessionTree.waitForItemTextVisible(beforeTitle)

    await reloadExtensionBackgroundPage()
    await browser.pause(1_000)
    await browser.switchToWindow(originalHandle)
    await browser.newWindow(fixtureDataUrl(afterTitle), { type: 'tab' })
    await browser.switchToWindow(popup.popupHandle)

    await sessionTree.waitForItemTextVisible(afterTitle)
    await createBlankCleanupWindow()
    await removeTabsByTitles([beforeTitle, afterTitle])
    await closeSessionTreePopup(popup.originalHandle)
  })

  it('keeps two popups synchronized when either popup closes (RT-05/RT-06)', async () => {
    const firstTitle = 'SF Runtime Both Popups'
    const secondTitle = 'SF Runtime Surviving Popup'
    const firstPopup = await openSessionTreePopup()
    const secondPopupHandle = await openAdditionalSessionTreePopup()
    const sessionTree = new SessionTreePage()

    await browser.switchToWindow(firstPopup.originalHandle)
    await browser.newWindow(fixtureDataUrl(firstTitle), { type: 'tab' })
    await browser.switchToWindow(firstPopup.popupHandle)
    await sessionTree.waitForItemTextVisible(firstTitle)
    await browser.switchToWindow(secondPopupHandle)
    await sessionTree.waitForItemTextVisible(firstTitle)

    await closeSessionTreePopupHandle(firstPopup.popupHandle, secondPopupHandle)
    await browser.switchToWindow(firstPopup.originalHandle)
    await browser.newWindow(fixtureDataUrl(secondTitle), { type: 'tab' })
    await browser.switchToWindow(secondPopupHandle)
    await sessionTree.waitForItemTextVisible(secondTitle)

    await createBlankCleanupWindow()
    await removeTabsByTitles([firstTitle, secondTitle])
    await closeSessionTreePopup(firstPopup.originalHandle)
  })
})
