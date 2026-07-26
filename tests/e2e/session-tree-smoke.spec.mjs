import { browser, expect } from '@wdio/globals'
import { SESSION_TREE_URL } from './support/firefox-extension.mjs'
import {
  closeSessionTreePopup,
  openSessionTreePopup,
} from './support/session-tree-popup.mjs'

describe('SessionFlow Firefox extension smoke', () => {
  it('opens the session tree when the extension action is clicked', async () => {
    const { originalHandle } = await openSessionTreePopup()
    await closeSessionTreePopup(originalHandle)
  })

  it('replaces a stale session tree popup before opening a clean one', async () => {
    const first = await openSessionTreePopup()
    const second = await openSessionTreePopup()
    const handles = await browser.getWindowHandles()

    expect(handles).not.toContain(first.popupHandle)
    expect(second.popupHandle).not.toBe(first.popupHandle)
    const popupUrl = await browser.getUrl()
    if (!popupUrl.startsWith(SESSION_TREE_URL)) {
      throw new Error(
        `Expected a Session Flow popup URL, received ${popupUrl}.`,
      )
    }

    await closeSessionTreePopup(second.originalHandle)
  })
})
