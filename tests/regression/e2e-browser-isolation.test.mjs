import { beforeEach, describe, expect, it, vi } from 'vitest'
import { browser } from '@wdio/globals'
import {
  browserWindowSnapshot,
  resetBrowserWindows,
} from '../e2e/support/browser-isolation.mjs'

vi.mock('@wdio/globals', () => ({
  browser: {
    getWindowHandle: vi.fn(),
    getWindowHandles: vi.fn(),
    switchToWindow: vi.fn(),
    newWindow: vi.fn(),
    closeWindow: vi.fn(),
    getUrl: vi.fn(),
    getTitle: vi.fn(),
    url: vi.fn(),
    waitUntil: vi.fn(),
  },
}))
vi.mock('../e2e/support/e2e-coverage.mjs', () => ({
  collectCoverageFromOpenWindows: vi.fn(),
}))

let tabs
let currentHandle

beforeEach(() => {
  vi.resetAllMocks()
  tabs = new Map([
    ['fixture', { url: 'about:blank', title: 'New Tab' }],
    [
      'popup',
      { url: 'moz-extension://test/sessiontree.html', title: 'Session Flow' },
    ],
    [
      'options',
      {
        url: 'moz-extension://test/options.html',
        title: 'Session Flow Settings',
      },
    ],
  ])
  currentHandle = 'options'
  browser.getWindowHandle.mockImplementation(async () => currentHandle)
  browser.getWindowHandles.mockImplementation(async () => [...tabs.keys()])
  browser.switchToWindow.mockImplementation(async (handle) => {
    if (!tabs.has(handle)) throw new Error('No such window')
    currentHandle = handle
  })
  browser.newWindow.mockImplementation(async () => {
    tabs.set('clean', { url: 'about:blank', title: '' })
    currentHandle = 'clean'
  })
  browser.closeWindow.mockImplementation(async () => tabs.delete(currentHandle))
  browser.getUrl.mockImplementation(async () => tabs.get(currentHandle).url)
  browser.getTitle.mockImplementation(async () => tabs.get(currentHandle).title)
  browser.url.mockImplementation(async (url) => {
    tabs.get(currentHandle).url = url
  })
  browser.waitUntil.mockImplementation(async (predicate, options) => {
    for (let attempt = 0; attempt < 3; attempt += 1) {
      if (await predicate()) return
    }
    throw new Error(options.timeoutMsg)
  })
})

describe('workflow browser isolation', () => {
  it('recovers from a failed test with untracked options and popup tabs', async () => {
    await resetBrowserWindows()

    expect([...tabs.keys()]).toEqual(['clean'])
    expect(currentHandle).toBe('clean')
    expect(browser.newWindow).toHaveBeenCalledWith('about:blank', {
      type: 'window',
    })
  })

  it('also closes new tabs Firefox creates while closing a popup', async () => {
    browser.closeWindow.mockImplementation(async () => {
      tabs.delete(currentHandle)
      if (currentHandle === 'options') {
        tabs.set('replacement', { url: 'about:newtab', title: 'New Tab' })
      }
    })

    await resetBrowserWindows()

    expect([...tabs.keys()]).toEqual(['clean'])
    expect(currentHandle).toBe('clean')
  })

  it('preserves a known normal fixture window while removing untracked tabs', async () => {
    await resetBrowserWindows('fixture')

    expect([...tabs.keys()]).toEqual(['fixture'])
    expect(currentHandle).toBe('fixture')
    expect(browser.newWindow).not.toHaveBeenCalled()
  })

  it('creates a normal window if the original fixture tab has closed', async () => {
    tabs.delete('fixture')

    await resetBrowserWindows('fixture')

    expect([...tabs.keys()]).toEqual(['clean'])
    expect(currentHandle).toBe('clean')
  })

  it('tolerates another popup handle disappearing during cleanup', async () => {
    browser.closeWindow.mockImplementation(async () => {
      tabs.delete(currentHandle)
      if (currentHandle === 'popup') tabs.delete('options')
    })

    await resetBrowserWindows()

    expect([...tabs.keys()]).toEqual(['clean'])
  })

  it('reports remaining contexts when a browser tab cannot be closed', async () => {
    browser.closeWindow.mockImplementation(async () => {
      if (currentHandle === 'options') throw new Error('Close failed')
      tabs.delete(currentHandle)
    })

    await expect(resetBrowserWindows()).rejects.toThrow(/options.html/)
  })

  it('preserves the current tab when collecting diagnostics', async () => {
    const snapshot = await browserWindowSnapshot()

    expect(snapshot).toContainEqual({
      handle: 'options',
      url: 'moz-extension://test/options.html',
      title: 'Session Flow Settings',
    })
    expect(currentHandle).toBe('options')
  })
})
