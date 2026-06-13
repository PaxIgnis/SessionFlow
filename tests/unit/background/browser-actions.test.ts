import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { Browser } from '@/services/background-browser'
import {
  flushMicrotasks,
  installFakeBrowser,
  type FakeBrowser,
} from '../../helpers/fake-browser'

describe('browser wrapper actions', () => {
  let fakeBrowser: FakeBrowser

  beforeEach(() => {
    fakeBrowser = installFakeBrowser()
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('focuses a tab through the browser tabs API', () => {
    Browser.focusTab({ tabId: 12 })

    expect(fakeBrowser.tabs.update).toHaveBeenCalledWith(12, { active: true })
  })

  it('reloads a tab through the browser tabs API', () => {
    Browser.reloadTab({ tabId: 13 })

    expect(fakeBrowser.tabs.reload).toHaveBeenCalledWith(13)
  })

  it('pins a tab through the browser tabs API', () => {
    Browser.pinTab(14)

    expect(fakeBrowser.tabs.update).toHaveBeenCalledWith(14, { pinned: true })
  })

  it('unpins a tab through the browser tabs API', () => {
    Browser.unpinTab(15)

    expect(fakeBrowser.tabs.update).toHaveBeenCalledWith(15, { pinned: false })
  })

  it('focuses a window through the browser windows API', () => {
    Browser.focusWindow({ windowId: 21 })

    expect(fakeBrowser.windows.update).toHaveBeenCalledWith(21, {
      focused: true,
    })
  })

  it('focuses a tab and its window through browser wrapper actions', () => {
    Browser.focusTabAndWindow({ tabId: 31, windowId: 41 })

    expect(fakeBrowser.tabs.update).toHaveBeenCalledWith(31, { active: true })
    expect(fakeBrowser.windows.update).toHaveBeenCalledWith(41, {
      focused: true,
    })
  })

  it('logs tab wrapper rejections without throwing synchronously', async () => {
    const error = new Error('tab update failed')
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {})
    fakeBrowser.tabs.update.mockRejectedValueOnce(error)

    expect(() => Browser.focusTab({ tabId: 50 })).not.toThrow()
    await flushMicrotasks()

    expect(consoleError).toHaveBeenCalledWith('Error focusing tab:', error)
  })

  it('logs window wrapper rejections without throwing synchronously', async () => {
    const error = new Error('window update failed')
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {})
    fakeBrowser.windows.update.mockRejectedValueOnce(error)

    expect(() => Browser.focusWindow({ windowId: 60 })).not.toThrow()
    await flushMicrotasks()

    expect(consoleError).toHaveBeenCalledWith('Error focusing window:', error)
  })
})
