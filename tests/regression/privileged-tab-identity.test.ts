import { beforeEach, describe, expect, it, vi } from 'vitest'
import { DEFAULT_SETTINGS } from '@/defaults/settings'
import { Tree } from '@/services/background-tree'
import { Settings } from '@/services/settings'
import * as Utils from '@/services/utils'
import { State } from '@/types/session-tree'
import { installFakeBrowser } from '../helpers/fake-browser'
import { createTab, createWindow, resetTree } from '../helpers/tree-fixtures'

/*
 * Firefox refuses to let an extension open a privileged URL, so restoring one
 * opens the redirect page in its place. That page then loads and reports its
 * own url and title, which used to be written straight back into the tree: a
 * saved about:config tab became "Redirect to about:config" pointing at
 * moz-extension://.../redirect.html?targetUrl=... and never recovered, because
 * saving it again just stored the stand-in.
 */
const REDIRECT_BASE = 'moz-extension://test-extension/redirect.html'

function redirectUrlFor(targetUrl: string, targetTitle: string): string {
  return (
    `${REDIRECT_BASE}?targetUrl=${encodeURIComponent(targetUrl)}` +
    `&targetTitle=${encodeURIComponent(targetTitle)}`
  )
}

describe('privileged tab identity', () => {
  beforeEach(() => {
    vi.restoreAllMocks()
    installFakeBrowser()
    resetTree()
    Object.assign(Settings.values, structuredClone(DEFAULT_SETTINGS))
    vi.mocked(browser.runtime.getURL).mockImplementation(
      (path: string) => `moz-extension://test-extension${path}`,
    )
  })

  it('unwraps a redirect URL back to the page it stands in for', () => {
    expect(
      Utils.storedTabIdentity(
        redirectUrlFor('about:config', 'Advanced Preferences'),
        'Redirect to Advanced Preferences',
      ),
    ).toEqual({ url: 'about:config', title: 'Advanced Preferences' })
  })

  it('leaves ordinary browser state untouched', () => {
    expect(
      Utils.storedTabIdentity('https://example.test/page', 'Example'),
    ).toEqual({ url: 'https://example.test/page', title: 'Example' })
  })

  it('keeps the live title when the redirect carries no target title', () => {
    const url = `${REDIRECT_BASE}?targetUrl=${encodeURIComponent('about:addons')}`
    expect(Utils.storedTabIdentity(url, 'Redirect')).toEqual({
      url: 'about:addons',
      title: 'Redirect',
    })
  })

  it('ignores a redirect URL that names no target', () => {
    expect(Utils.storedTabIdentity(REDIRECT_BASE, 'Redirect')).toEqual({
      url: REDIRECT_BASE,
      title: 'Redirect',
    })
    expect(Utils.readRedirectTarget(REDIRECT_BASE)).toBeUndefined()
  })

  it('round-trips a privileged tab through restore without losing identity', () => {
    // What the tree holds after the redirect page loaded and reported itself.
    const restored = redirectUrlFor('about:config', 'Advanced Preferences')
    const identity = Utils.storedTabIdentity(
      restored,
      'Redirect to Advanced Preferences',
    )

    // Re-preparing that identity yields the same redirect target, so saving and
    // reopening keeps pointing at the original page instead of nesting.
    const prepared = Utils.prepareRestorableUrl(identity.url!, identity.title!)
    expect(prepared).toEqual({
      kind: 'url',
      url: redirectUrlFor('about:config', 'Advanced Preferences'),
      redirected: true,
    })
    expect(
      Utils.storedTabIdentity(
        (prepared as { url: string }).url,
        'Redirect to Advanced Preferences',
      ),
    ).toEqual({ url: 'about:config', title: 'Advanced Preferences' })
  })

  it('recovers a tree entry that already stored the stand-in', async () => {
    // A tab corrupted by the old behaviour, as it would load from storage.
    const tab = createTab('tab-privileged' as UID, {
      id: 11,
      state: State.OPEN,
      title: 'Redirect to Advanced Preferences',
      url: redirectUrlFor('about:config', 'Advanced Preferences'),
    })
    const window = createWindow('window-1' as UID, [tab], {
      id: 20,
      state: State.OPEN,
    })
    vi.mocked(browser.windows.get).mockResolvedValue({
      id: 20,
      focused: true,
      incognito: false,
      alwaysOnTop: false,
      type: 'normal',
      tabs: [
        {
          id: 11,
          index: 0,
          windowId: 20,
          active: true,
          pinned: false,
          highlighted: true,
          incognito: false,
          discarded: false,
          title: 'Redirect to Advanced Preferences',
          url: redirectUrlFor('about:config', 'Advanced Preferences'),
        },
      ],
    } as browser.windows.Window)

    await Tree.updateWindowTabs(20)

    const [refreshed] = Tree.getTabs(
      Tree.windowsByUid.get(window.uid)!.children,
    )
    expect(refreshed).toMatchObject({
      url: 'about:config',
      title: 'Advanced Preferences',
    })
  })
})
