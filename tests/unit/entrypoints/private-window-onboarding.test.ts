import { afterEach, describe, expect, it } from 'vitest'
import { createSSRApp } from 'vue'
import { renderToString } from 'vue/server-renderer'
import Introduction from '@/entrypoints/onboarding/Introduction.vue'
import TabStateLegend from '@/components/TabStateLegend.vue'
import OnboardingTreeDemo from '@/components/OnboardingTreeDemo.vue'
import {
  completeIntroduction,
  openIntroduction,
  saveOnboardingRetention,
  saveOnboardingStartup,
} from '@/services/onboarding-client'
import { installFakeBrowser } from '../../helpers/fake-browser'
import { setTestLocale } from '../../helpers/i18n'

afterEach(() => setTestLocale('en'))

describe('introduction presentation and commands', () => {
  it.each([
    ['en', 'Welcome to Session Flow', 'Skip introduction'],
    ['de', 'Willkommen bei Session Flow', 'Einführung überspringen'],
    ['fr', 'Bienvenue dans Session Flow', 'Passer l’introduction'],
  ])(
    'renders a localized, skippable welcome in %s',
    async (locale, title, skip) => {
      setTestLocale(locale)
      const html = await renderToString(createSSRApp(Introduction))
      expect(html).toContain(title)
      expect(html).toContain(skip)
      expect(html).toContain('src="/icon/session-flow.svg"')
      expect(html).toContain('tabindex="-1"')
    },
  )

  it('labels each state independently of color and distinguishes focus from lifecycle state', async () => {
    const html = await renderToString(createSSRApp(TabStateLegend))
    for (const label of ['Active', 'Live', 'Unloaded', 'Saved'])
      expect(html).toContain(label)
    expect(html).toContain('Hollow blue dot')
    expect(html).toContain('currently closed in Firefox')
    expect(html).toContain('Active describes focus')
    expect(html.match(/<dt /g)).toHaveLength(4)
  })

  it.each([
    'open',
    'focus',
    'organize',
    'multi-select',
    'labels',
    'save',
    'close',
    'note-add',
    'note-edit',
    'note-group',
  ] as const)(
    'renders a replayable %s example without autoplay or browser commands',
    async (action) => {
      const fake = installFakeBrowser()
      const html = await renderToString(
        createSSRApp(OnboardingTreeDemo, { action }),
      )
      expect(html).toContain('data-phase="before"')
      expect(html).toContain('Watch example')
      expect(html).toContain('data-state="live"')
      if (action === 'save') expect(html).toContain('aria-label="Save"')
      expect(fake.runtime.sendMessage).not.toHaveBeenCalled()
      expect(fake.tabs.remove).not.toHaveBeenCalled()
    },
  )

  it.each(['window-bar', 'tab-groups', 'containers'] as const)(
    'renders the static %s lesson without autoplay or browser commands',
    async (action) => {
      const fake = installFakeBrowser()
      const html = await renderToString(
        createSSRApp(OnboardingTreeDemo, { action }),
      )
      expect(html).not.toContain('Watch example')
      if (action === 'window-bar')
        expect(html).toContain('3 live, 2 unloaded, 1 saved tabs')
      if (action === 'tab-groups')
        expect(html).toContain('tree-item-tab-group-indicator')
      if (action === 'containers')
        expect(html).toContain('/icons/usercontext.svg#briefcase')
      expect(fake.runtime.sendMessage).not.toHaveBeenCalled()
    },
  )

  it('shows windows, notes, separators, real outline classes and nested indent guides on the welcome page', async () => {
    const html = await renderToString(createSSRApp(Introduction))
    expect(html).toContain('Organize your windows and tabs in a vertical tree')
    for (const className of [
      'tree-item-window-label',
      'tree-item-note-text',
      'tree-item-separator-line',
      'tree-item-indent-lines',
      'tree-item-active-latest-tab',
    ])
      expect(html).toContain(className)
    expect(html).toContain('data-example-id="second-window"')
    expect(html).not.toContain('data-example-id="planning"')
    expect(html).toContain('This is a sample tree.')
    expect(html).toContain('data-example-id="related"')
    expect(html).not.toContain('data-example-id="docs"')
  })

  it('reopens the welcome tab without modifying completion or browser tabs', async () => {
    const fake = installFakeBrowser()
    await openIntroduction()
    expect(fake.tabs.create).toHaveBeenCalledWith({
      url: 'moz-extension://test-id/onboarding.html',
    })
    expect(fake.storage.local.set).not.toHaveBeenCalled()
    expect(fake.tabs.remove).not.toHaveBeenCalled()
  })

  it('finishes without sending preferences again', async () => {
    const fake = installFakeBrowser()
    await completeIntroduction('import')
    expect(fake.runtime.sendMessage).toHaveBeenCalledExactlyOnceWith({
      action: 'onboarding',
      command: 'import',
    })
    expect(fake.storage.local.set).not.toHaveBeenCalled()
  })

  it('sends preference changes as separate onboarding commands', async () => {
    const fake = installFakeBrowser()
    await saveOnboardingRetention(false)
    await saveOnboardingStartup(true)
    expect(fake.runtime.sendMessage).toHaveBeenNthCalledWith(1, {
      action: 'onboarding',
      command: 'set-retention',
      retainPrivateWindows: false,
    })
    expect(fake.runtime.sendMessage).toHaveBeenNthCalledWith(2, {
      action: 'onboarding',
      command: 'set-startup',
      openSessionTreeOnStartup: true,
    })
    expect(fake.storage.local.set).not.toHaveBeenCalled()
  })
})
