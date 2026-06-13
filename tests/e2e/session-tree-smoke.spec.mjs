import { browser } from '@wdio/globals'
import {
  closeSessionTreePopup,
  openSessionTreePopup,
} from './support/session-tree-popup.mjs'

describe('SessionFlow Firefox extension smoke', () => {
  it('opens the session tree when the extension action is clicked', async () => {
    const { originalHandle } = await openSessionTreePopup()
    await closeSessionTreePopup(originalHandle)
  })
})
