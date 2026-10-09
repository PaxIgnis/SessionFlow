import { $, browser, expect } from '@wdio/globals'
import fs from 'node:fs/promises'
import {
  FIREFOX_EXTENSION_ID,
  FIREFOX_EXTENSION_UUID,
  SESSION_TREE_URL,
} from './support/firefox-extension.mjs'
import {
  closeSessionTreePopup,
  openSessionTreePopup,
} from './support/session-tree-popup.mjs'
import { setFirefoxExtensionPrivateBrowsingAllowed } from './support/firefox-chrome-context.mjs'

const introductionUrl = `moz-extension://${FIREFOX_EXTENSION_UUID}/onboarding.html`
const optionsUrl = `moz-extension://${FIREFOX_EXTENSION_UUID}/options.html`

const feature = (id) => $(`.tip-tabs button[data-feature-id="${id}"]`).click()
const sampleItem = (id) => $(`.tree-demo [data-example-id="${id}"]`)

async function expectHeadingFocus(selector) {
  await browser.waitUntil(
    async () =>
      browser.execute(
        (target) => document.activeElement === document.querySelector(target),
        selector,
      ),
    { timeoutMsg: `Expected keyboard focus on ${selector}` },
  )
}

async function tabIds() {
  return browser.executeAsync((done) =>
    window.browser.tabs
      .query({})
      .then((tabs) => done(tabs.map((tab) => tab.id))),
  )
}

async function openFeatures() {
  await $('button=Next').click()
  await $('button=Next').click()
  await $('button=Next').click()
  await expect($('h1')).toHaveText('Features')
}

async function storedState() {
  return browser.executeAsync((done) => {
    window.browser.storage.local
      .get(['settings', 'privateWindowOnboarding', 'sessionTreeIntroduction'])
      .then(done)
  })
}

async function switchToNewHandle(previous, expectedUrl) {
  await browser.waitUntil(
    async () =>
      (await browser.getWindowHandles()).some(
        (handle) => !previous.includes(handle),
      ),
    { timeout: 20_000, timeoutMsg: `Expected ${expectedUrl} to open` },
  )
  const handle = (await browser.getWindowHandles()).find(
    (value) => !previous.includes(value),
  )
  await browser.switchToWindow(handle)
  await browser.waitUntil(async () =>
    (await browser.getUrl()).startsWith(expectedUrl),
  )
  return handle
}

describe('Session Flow introduction', () => {
  let originalHandle
  let introductionHandle

  beforeEach(async () => {
    originalHandle = await browser.getWindowHandle()
    await browser.newWindow(introductionUrl, { type: 'tab' })
    introductionHandle = await browser.getWindowHandle()
    await browser.executeAsync((done) =>
      window.browser.storage.local
        .set({
          privateWindowOnboarding: {
            status: 'pending',
            version: 1,
            welcomeStep: 0,
          },
        })
        .then(done),
    )
    await browser.refresh()
    await expect($('h1')).toHaveText('Welcome to Session Flow')
  })

  afterEach(async () => {
    const handles = await browser.getWindowHandles()
    for (const handle of handles) {
      if (handle === originalHandle) continue
      await browser.switchToWindow(handle)
      const url = await browser.getUrl()
      if (
        handle === introductionHandle ||
        url.startsWith(introductionUrl) ||
        url.startsWith(SESSION_TREE_URL) ||
        url.startsWith(optionsUrl)
      ) {
        await browser.closeWindow()
      }
    }
    await browser.switchToWindow(originalHandle)
  })

  it('loads the icon and leaves the toolbar usable when the welcome tab is closed', async () => {
    await browser.waitUntil(async () =>
      browser.execute(() => {
        const icon = document.querySelector('.welcome-brand img')
        return icon.complete && icon.naturalWidth > 0
      }),
    )
    await fs.mkdir('.output/onboarding-preview', { recursive: true })
    await expect($('.fine-print')).toHaveText('This is a sample tree.')
    await expect($('.example-tree [data-example-id="docs"]')).not.toBeExisting()
    await $(
      '.example-tree [data-example-id="related"] .tree-item-action-button',
    ).click()
    await expect($('.example-tree [data-example-id="docs"]')).toBeDisplayed()
    await $(
      '.example-tree [data-example-id="related"] .tree-item-action-button',
    ).click()
    await expect($('.example-tree .tree-item-note')).toBeExisting()
    await expect($('.example-tree .tree-item-separator')).toBeExisting()
    await expect($('.example-tree .tree-item-indent-lines')).toBeExisting()
    await browser.waitUntil(async () =>
      browser.execute(() => {
        const arrow = document.querySelector(
          '.example-tree .collapse-arrow use',
        )
        return arrow.getBBox().width > 0
      }),
    )
    await browser.saveScreenshot('.output/onboarding-preview/welcome.png')
    await $(
      '.example-tree [data-example-id="projects"] .tree-item-action-button',
    ).click()
    await expect(
      $('.example-tree [data-example-id="research"]'),
    ).not.toBeExisting()
    await expect(
      $('.example-tree .tree-item-action-button'),
    ).toHaveElementClass('tree-item-action-button-hiding-focus')
    await $(
      '.example-tree [data-example-id="projects"] .tree-item-action-button',
    ).click()
    await expect(
      $('.example-tree [data-example-id="research"]'),
    ).toBeDisplayed()
    await browser.closeWindow()
    introductionHandle = undefined
    await browser.switchToWindow(originalHandle)
    const popup = await openSessionTreePopup()
    await closeSessionTreePopup(popup.originalHandle)
  })

  it('teaches with sample rows entirely in the welcome tab, resumes, finishes, and replays', async () => {
    await $('button=Next').click()
    await expect($('h1')).toHaveText('Choose how to start')
    await expect($('.start-choices')).toHaveText(
      expect.stringContaining('Use my current session'),
    )
    await expect($('.start-choices')).toHaveText(
      expect.stringContaining('Start with your current windows and tabs.'),
    )
    await $('button=Next').click()
    await expect($('h1')).toHaveText('Include Private Windows')
    await browser.refresh()
    await expect($('h1')).toHaveText('Include Private Windows')
    await expect($('.retention input')).not.toBeChecked()
    await $('button=Next').click()
    await expect($('h1')).toHaveText('Features')
    await expect($('.tab-guide')).toHaveText(
      expect.stringContaining('This is a sample tree.'),
    )
    const legend = await $('.tab-state-legend').getText()
    for (const label of ['Active', 'Live', 'Unloaded', 'Saved'])
      expect(legend).toContain(label)
    const before = await storedState()
    expect(before.privateWindowOnboarding.status).toBe('pending')
    const tabsBefore = await tabIds()
    await fs.mkdir('.output/onboarding-preview', { recursive: true })
    await browser.saveScreenshot('.output/onboarding-preview/tab-states.png')

    await feature('focus')
    await expect($('.tab-guide h2')).toHaveText('3. Focus a tab')
    await expectHeadingFocus('.tab-guide h2')
    await browser.refresh()
    await expect($('.tab-guide h2')).toHaveText('3. Focus a tab')
    await $('button=Watch example').click()
    await expect($('.tree-demo')).toHaveAttribute('data-phase', 'after')
    await expect(sampleItem('research')).toHaveAttribute('data-state', 'active')
    const activeStyle = await browser.execute(() => {
      const row = document.querySelector(
        '.tree-demo .tree-item-active-latest-tab',
      )
      const outline = getComputedStyle(
        row.querySelector('.tree-item-overlay'),
        '::before',
      )
      return {
        border: outline.borderImageSource,
        background: getComputedStyle(row).backgroundImage,
      }
    })
    expect(activeStyle.border).toContain('linear-gradient')
    expect(activeStyle.background).toBe('none')
    await browser.saveScreenshot('.output/onboarding-preview/focus-after.png')
    await feature('organize')
    await expect($('.tab-guide h2')).toHaveText('6. Organize a branch')
    const sourceTop = await browser.execute(
      () =>
        document.querySelector('.tree-demo [data-example-id="reference"]')
          .offsetTop,
    )
    await $('button=Watch example').click()
    await expect($('.demo-drag-preview')).toBeDisplayed()
    const initialDrag = await browser.execute(() => ({
      sourceTop: document.querySelector(
        '.tree-demo [data-example-id="reference"]',
      ).offsetTop,
      highlighted: !!document.querySelector(
        '.tree-demo .drag-over-mid, .tree-demo .drag-over-above, .tree-demo .drag-over-below',
      ),
    }))
    expect(initialDrag.sourceTop).toBe(sourceTop)
    expect(initialDrag.highlighted).toBe(false)
    await expect(sampleItem('reference')).toHaveElementClass('indentLevel-1')
    await expect(sampleItem('research')).toHaveElementClass('drag-over-mid')
    await browser.saveScreenshot('.output/onboarding-preview/organize-drag.png')
    await expect($('.tree-demo')).toHaveAttribute('data-phase', 'after')
    await expect(sampleItem('reference')).toHaveElementClass('indentLevel-2')
    await sampleItem('research').$('.tree-item-action-button').click()
    await expect(sampleItem('reference')).not.toBeExisting()
    await sampleItem('research').$('.tree-item-action-button').click()
    await expect(sampleItem('reference')).toBeDisplayed()
    await $('button=Drop above').click()
    await $('button=Watch example').click()
    await expect(sampleItem('research')).toHaveElementClass('drag-over-above')
    await expect($('.tree-demo')).toHaveAttribute('data-phase', 'after')
    await expect(sampleItem('reference')).toHaveElementClass('indentLevel-1')
    const aboveOrder = await browser.execute(() =>
      [...document.querySelectorAll('.tree-demo [data-example-id]')].map(
        (row) => row.dataset.exampleId,
      ),
    )
    expect(aboveOrder).toEqual([
      'window',
      'reference',
      'research',
      'ideas',
      'separator',
      'other-tab',
    ])
    await $('button=Drop below').click()
    await $('button=Watch example').click()
    await expect(sampleItem('research')).toHaveElementClass('drag-over-below')
    await expect($('.tree-demo')).toHaveAttribute('data-phase', 'after')
    await expect(sampleItem('reference')).toHaveElementClass('indentLevel-1')
    const belowOrder = await browser.execute(() =>
      [...document.querySelectorAll('.tree-demo [data-example-id]')].map(
        (row) => row.dataset.exampleId,
      ),
    )
    expect(belowOrder).toEqual([
      'window',
      'research',
      'reference',
      'ideas',
      'separator',
      'other-tab',
    ])
    await feature('save')
    await expect($('.tab-guide h2')).toHaveText('5. Save a tab or window')
    await expectHeadingFocus('.tab-guide h2')
    await expect($('.guide-warning')).toHaveText(
      expect.stringContaining('Save closes a tab and keeps its entry'),
    )
    await browser.saveScreenshot('.output/onboarding-preview/save-before.png')
    await $('button=Watch example').click()
    await expect($('.tree-demo')).toHaveAttribute('data-phase', 'after')
    await expect(sampleItem('reference')).toHaveAttribute('data-state', 'saved')
    await expect(
      sampleItem('reference').$('button[aria-label="Save"]'),
    ).not.toBeExisting()
    await browser.saveScreenshot('.output/onboarding-preview/save-after.png')
    await $('button=Replay example').click()
    await expect($('.tree-demo')).toHaveAttribute('data-phase', 'after')
    await feature('close')
    await expect($('.tab-guide h2')).toHaveText('4. Close a tab or window')
    await $('button=Watch example').click()
    await expect($('.tree-demo')).toHaveAttribute('data-phase', 'after')
    await expect(sampleItem('reference')).not.toBeExisting()
    const tabsAfter = await tabIds()
    expect(tabsAfter).toEqual(tabsBefore)
    await expect(browser).toHaveUrl(introductionUrl)
    await feature('containers')
    await $('button=Next').click()
    await expect($('h1')).toHaveText('Make yourself at home')
    await expect($('.startup-choice input')).not.toBeChecked()
    for (const enabled of [true, false, true]) {
      await $('.startup-choice input').click()
      await browser.waitUntil(async () => {
        const state = await storedState()
        return state.settings.openSessionTreeOnStartup === enabled
      })
      await expect($('.startup-choice input')).toBeEnabled()
      expect((await storedState()).privateWindowOnboarding.status).toBe(
        'pending',
      )
      await browser.refresh()
      await expect($('.startup-choice input')).toBeEnabled()
      if (enabled) await expect($('.startup-choice input')).toBeChecked()
      else await expect($('.startup-choice input')).not.toBeChecked()
    }
    await $('button=Back').click()
    await $('button=Next').click()
    await browser.refresh()
    await expect($('.startup-choice input')).toBeChecked()
    await expect($('.settings-access')).toHaveText(
      expect.stringContaining(
        'gear button at the bottom right of the session tree',
      ),
    )
    const settingsHandles = await browser.getWindowHandles()
    await $('button=Open Settings').click()
    await switchToNewHandle(settingsHandles, optionsUrl)
    await expect($('#settings_general')).toBeDisplayed()
    await browser.closeWindow()
    await browser.switchToWindow(introductionHandle)
    await expect($('h1')).toHaveText('Make yourself at home')
    await expect($('.startup-choice input')).toBeChecked()
    expect((await storedState()).privateWindowOnboarding.status).toBe('pending')
    const previous = await browser.getWindowHandles()
    await $('button=Open Session Flow').click()
    await switchToNewHandle(previous, SESSION_TREE_URL)
    await expect($('.tree-introduction')).not.toBeExisting()
    const finished = await storedState()
    expect(finished.sessionTreeIntroduction.step).toBe(-1)
    expect(finished.settings.openSessionTreeOnStartup).toBe(true)
    expect(finished.settings.retainPrivateWindows).toBe(false)
    expect(finished.settings.includePrivateWindowsInSessionSnapshots).toBe(
      false,
    )
    expect(finished.settings.cachePrivateTabFavicons).toBe(false)

    // Replay does not reset preferences until the user changes them.
    await browser.url(optionsUrl)
    await expect(
      $('#settings_general .section-head .introduction-button'),
    ).toHaveText('Show Intro')
    const fitsNarrowWindow = await browser.execute(
      () =>
        document
          .querySelector('#settings_general .introduction-button')
          .getBoundingClientRect().right <= window.innerWidth,
    )
    expect(fitsNarrowWindow).toBe(true)
    await browser.setWindowSize(1280, 900)
    const introPlacement = await browser.execute(() => {
      const heading = document
        .querySelector('#settings_general .section-title')
        .getBoundingClientRect()
      const button = document
        .querySelector('#settings_general .introduction-button')
        .getBoundingClientRect()
      return (
        button.left > heading.right && Math.abs(button.top - heading.top) < 15
      )
    })
    expect(introPlacement).toBe(true)
    await browser.saveScreenshot(
      '.output/onboarding-preview/settings-show-intro.png',
    )
    const replayHandles = await browser.getWindowHandles()
    await $('button=Show Intro').click()
    await switchToNewHandle(replayHandles, introductionUrl)
    await expect($('h1')).toHaveText('Welcome to Session Flow')
    await $('button=Skip introduction').click()
    await expect($('h1')).toHaveText('You are ready to explore')
  })

  it('activates sample Save and Delete buttons with Tab and Enter without changing real tabs', async () => {
    await openFeatures()
    const tabsBefore = await tabIds()
    for (const [lesson, action] of [
      ['save', 'Save'],
      ['close', 'Delete'],
    ]) {
      await feature(lesson)
      await sampleItem('reference').moveTo()
      await browser.execute(() => {
        document
          .querySelector(
            '.tree-demo [data-example-id="window"] .tree-item-action-button',
          )
          .focus()
      })
      await browser.keys('Tab')
      if (action === 'Delete') await browser.keys('Tab')
      await expectHeadingFocus(
        `.tree-demo [data-example-id="reference"] button[aria-label="${action}"]`,
      )
      await browser.keys('Enter')
      if (action === 'Save')
        await expect(sampleItem('reference')).toHaveAttribute(
          'data-state',
          'saved',
        )
      else await expect(sampleItem('reference')).not.toBeExisting()
    }
    await expect(await tabIds()).toEqual(tabsBefore)
  })

  it('routes import to Storage and applies an explicit private-retention opt-in', async () => {
    await $('button=Next').click()
    await $('input[value="import"]').click()
    await $('button=Next').click()
    await $('.retention input').click()
    await browser.waitUntil(async () => {
      const { settings } = await storedState()
      return (
        settings.retainPrivateWindows === true &&
        settings.includePrivateWindowsInSessionSnapshots === true &&
        settings.cachePrivateTabFavicons === true
      )
    })
    expect((await storedState()).privateWindowOnboarding.status).toBe('pending')
    await browser.refresh()
    await expect($('.retention input')).toBeChecked()
    await $('button=Next').click()
    await feature('save')
    // The replica Save control is also safe to try with the mouse.
    await sampleItem('reference').moveTo()
    await sampleItem('reference').$('button[aria-label="Save"]').click()
    await expect(sampleItem('reference')).toHaveAttribute('data-state', 'saved')
    // Reduced-motion users get the same result without a moving cursor.
    await browser.execute(() => {
      const matchMedia = window.matchMedia.bind(window)
      window.matchMedia = (query) =>
        query === '(prefers-reduced-motion: reduce)'
          ? { matches: true }
          : matchMedia(query)
    })
    await $('button=Replay example').click()
    await expect($('.tree-demo')).toHaveAttribute('data-phase', 'after')
    await expect($('.demo-cursor')).not.toBeExisting()
    const tabsBeforeSkip = await tabIds()
    await $('button=Skip tips').click()
    await expect($('h1')).toHaveText('Make yourself at home')
    await expectHeadingFocus('h1')
    const skipped = await storedState()
    expect(skipped.privateWindowOnboarding.status).toBe('pending')
    expect(skipped.privateWindowOnboarding.welcomeStep).toBe(4)
    expect(skipped.privateWindowOnboarding.destination).toBe('import')
    expect(skipped.settings.retainPrivateWindows).toBe(true)
    expect(await tabIds()).toEqual(tabsBeforeSkip)
    await $('button=Back').click()
    await expect($('.tab-guide h2')).toHaveText('5. Save a tab or window')
    await expectHeadingFocus('.tab-guide h2')
    await $('button=Skip tips').click()
    await browser.refresh()
    await expect($('h1')).toHaveText('Make yourself at home')
    const previous = await browser.getWindowHandles()
    await $('button=Import a session').click()
    await switchToNewHandle(previous, `${optionsUrl}#settings_storage`)
    await expect($('#settings_storage')).toBeDisplayed()
    await expect($('#nav-item-settings_storage')).toHaveAttribute(
      'aria-current',
      'true',
    )
    const state = await storedState()
    expect(state.settings.retainPrivateWindows).toBe(true)
    expect(state.settings.includePrivateWindowsInSessionSnapshots).toBe(true)
    expect(state.settings.cachePrivateTabFavicons).toBe(true)
    expect(state.sessionTreeIntroduction.step).toBe(-1)
  })

  it('adds and edits a local note with the real controls, then groups windows beneath it', async () => {
    await openFeatures()
    const tabsBefore = await tabIds()
    await $('.tip-tabs').$('button=9. Add a note').click()
    await expect(sampleItem('note')).not.toBeExisting()
    await $('.tree-demo .toolbar-button[aria-label="Add note"]').click()
    await expect(sampleItem('note')).toHaveText('New note')
    await expect(sampleItem('note')).toHaveElementClass('indentLevel-0')
    await $('button=Replay example').click()
    await expect($('.tree-demo')).toHaveAttribute('data-motion', 'click')
    const cursorAboveToolbar = await browser.execute(() => {
      const cursor = document.querySelector('.demo-pointer')
      const toolbar = document.querySelector('.tree-demo .session-tree-toolbar')
      const point = cursor.getBoundingClientRect()
      return (
        Number(getComputedStyle(cursor).zIndex) >
          Number(getComputedStyle(toolbar).zIndex) &&
        point.y + 2 >= toolbar.getBoundingClientRect().top
      )
    })
    expect(cursorAboveToolbar).toBe(true)
    await browser.saveScreenshot(
      '.output/onboarding-preview/note-add-click.png',
    )
    await expect($('.tree-demo')).toHaveAttribute('data-phase', 'after')
    await expect(sampleItem('note')).toBeDisplayed()
    await $('button=Next tip').click()
    await expect($('.tab-guide h2')).toHaveText('10. Edit note text')
    await sampleItem('note').doubleClick()
    await expect($('.modal-container')).toBeDisplayed()
    await $('.modal-textarea').setValue('Travel plans')
    await $('button=OK').click()
    await expect(sampleItem('note')).toHaveText('Travel plans')
    await expect($('.modal-container')).not.toBeExisting()
    await $('button=Replay example').click()
    await expect($('.tree-demo')).toHaveAttribute('data-motion', 'approach')
    await expect($('.modal-container')).not.toBeExisting()
    await expect($('.modal-container')).toBeDisplayed()
    await expect($('.tree-demo')).toHaveAttribute('data-motion', 'confirm')
    await expect($('.modal-textarea')).toHaveValue('Projects')
    await browser.saveScreenshot(
      '.output/onboarding-preview/note-edit-confirm.png',
    )
    await expect($('.tree-demo')).toHaveAttribute('data-phase', 'after')
    await expect(sampleItem('note')).toHaveText('Projects')
    await $('button=Next tip').click()
    await expect($('.tab-guide h2')).toHaveText(
      '11. Group windows under a note',
    )
    await browser.refresh()
    await expect($('.tab-guide h2')).toHaveText(
      '11. Group windows under a note',
    )
    await $('button=Watch example').click()
    await expect($('.demo-drag-preview')).toBeDisplayed()
    await expect(sampleItem('window')).toHaveElementClass('indentLevel-0')
    await expect(sampleItem('note')).toHaveElementClass('drag-over-mid')
    await expect($('.tree-demo')).toHaveAttribute('data-phase', 'after')
    for (const id of ['window', 'second-window'])
      await expect(sampleItem(id)).toHaveElementClass('indentLevel-1')
    for (const id of ['research', 'reference'])
      await expect(sampleItem(id)).toHaveElementClass('indentLevel-2')
    await browser.saveScreenshot('.output/onboarding-preview/note-group.png')
    await sampleItem('note').$('.tree-item-action-button').click()
    await expect(sampleItem('window')).not.toBeExisting()
    await expect(sampleItem('second-window')).not.toBeExisting()
    await sampleItem('note').$('.tree-item-action-button').click()
    await expect(sampleItem('window')).toBeDisplayed()
    await expect(sampleItem('second-window')).toBeDisplayed()
    expect(await tabIds()).toEqual(tabsBefore)
  })
  it('opens a saved sample tab and demonstrates saving and closing whole windows', async () => {
    await openFeatures()
    const tabsBefore = await tabIds()
    const featureIds = await browser.execute(() =>
      [...document.querySelectorAll('.tip-tabs button')].map(
        (button) => button.dataset.featureId,
      ),
    )
    expect(featureIds.slice(0, 8)).toEqual([
      'states',
      'open',
      'focus',
      'close',
      'save',
      'organize',
      'multi-select',
      'labels',
    ])
    await feature('note-edit')
    await $('button=Watch example').click()
    await feature('open')
    await expect($('.modal-container')).not.toBeExisting()
    await expect($('.demo-pointer')).not.toBeExisting()
    await expect(sampleItem('reference')).toHaveAttribute('data-state', 'saved')
    await $('button=Watch example').click()
    await expect($('.tree-demo')).toHaveAttribute('data-phase', 'after')
    await expect(sampleItem('reference')).toHaveAttribute(
      'data-state',
      'active',
    )
    await feature('save')
    await $('.example-choices').$('button=Window').click()
    await $('button=Watch example').click()
    await expect($('.tree-demo')).toHaveAttribute('data-phase', 'after')
    for (const id of ['window', 'research', 'reference'])
      await expect(sampleItem(id)).toHaveAttribute('data-state', 'saved')
    await expect(sampleItem('second-window')).toHaveAttribute(
      'data-state',
      'live',
    )
    await browser.saveScreenshot('.output/onboarding-preview/save-window.png')
    await feature('close')
    await $('.example-choices').$('button=Window').click()
    await $('button=Watch example').click()
    await expect($('.tree-demo')).toHaveAttribute('data-phase', 'after')
    for (const id of ['window', 'research', 'reference'])
      await expect(sampleItem(id)).not.toBeExisting()
    await expect(sampleItem('second-window')).toBeDisplayed()
    expect(await tabIds()).toEqual(tabsBefore)
  })

  it('shows the window composition bar, tab-group marks, and Firefox container icons', async () => {
    await openFeatures()
    await feature('window-bar')
    await expect($('.tree-item-composition')).toHaveAttribute(
      'aria-label',
      '3 live, 2 unloaded, 1 saved tabs',
    )
    await expect($('.tree-item-window-count')).toHaveText('6')
    await expect(sampleItem('unloaded-2')).not.toBeExisting()
    await browser.saveScreenshot('.output/onboarding-preview/window-bar.png')
    await feature('tab-groups')
    await expect(sampleItem('research')).toHaveAttribute(
      'title',
      expect.stringContaining('Projects'),
    )
    await expect(sampleItem('other-tab')).toHaveAttribute(
      'title',
      expect.stringContaining('Reading'),
    )
    await expect(
      sampleItem('research').$('.tree-item-tab-group-indicator'),
    ).toBeDisplayed()
    await browser.saveScreenshot('.output/onboarding-preview/tab-groups.png')
    await feature('containers')
    await expect(sampleItem('research')).toHaveAttribute(
      'title',
      expect.stringContaining('Work'),
    )
    await expect(sampleItem('reference')).toHaveAttribute(
      'title',
      expect.stringContaining('Personal'),
    )
    await browser.waitUntil(async () =>
      browser.execute(() =>
        [...document.querySelectorAll('.tree-item-container-icon use')].every(
          (icon) => icon.getBBox().width > 0,
        ),
      ),
    )
    await expect(
      sampleItem('other-tab').$('.tree-item-container-icon'),
    ).not.toBeExisting()
    await browser.saveScreenshot('.output/onboarding-preview/containers.png')
  })

  it('explains hidden indicators and opens their settings without losing the current tip', async () => {
    const originalSettings = (await storedState()).settings
    try {
      await browser.executeAsync((done) => {
        window.browser.storage.local
          .get('settings')
          .then(({ settings }) =>
            window.browser.storage.local.set({
              settings: {
                ...settings,
                tabGroupColorIndicator: 'hidden',
                containerColorIndicator: 'off',
                containerIconPosition: 'off',
              },
            }),
          )
          .then(done)
      })
      await browser.refresh()
      await openFeatures()
      await expectHeadingFocus('.tab-guide h2')
      await feature('tab-groups')
      await expect($('.indicator-settings')).toHaveText(
        expect.stringContaining('hide tab-group color indicators'),
      )
      await expect(
        sampleItem('research').$('.tree-item-tab-group-indicator'),
      ).not.toBeExisting()
      await expect($('.tab-guide')).toHaveText(
        expect.stringContaining('Settings → Tab Groups'),
      )
      const groupHandles = await browser.getWindowHandles()
      await $('.indicator-settings a').click()
      await switchToNewHandle(groupHandles, `${optionsUrl}#settings_tab_groups`)
      await expect($('#nav-item-settings_tab_groups')).toHaveAttribute(
        'aria-current',
        'true',
      )
      await $('#settings_tab_groups').$('button=Right Edge').click()
      await browser.switchToWindow(introductionHandle)
      await expect($('.tab-guide h2')).toHaveText('13. Tab groups')
      await expect(
        sampleItem('research').$('.tree-item-tab-group-indicator'),
      ).toBeDisplayed()
      await expect($('.indicator-settings span')).not.toBeExisting()

      await feature('containers')
      await expect($('.indicator-settings')).toHaveText(
        expect.stringContaining('hide container colors or icons'),
      )
      await expect(
        sampleItem('research').$('.tree-item-container-icon'),
      ).not.toBeExisting()
      await expect($('.tab-guide')).toHaveText(
        expect.stringContaining('Settings → Containers'),
      )
      const containerHandles = await browser.getWindowHandles()
      await $('.indicator-settings a').click()
      await switchToNewHandle(
        containerHandles,
        `${optionsUrl}#settings_containers`,
      )
      await expect($('#nav-item-settings_containers')).toHaveAttribute(
        'aria-current',
        'true',
      )
      await $('#settings_containers').$('button=Soft Fade').click()
      await browser.switchToWindow(introductionHandle)
      // The notice stays while the independent icon preference remains off.
      await expect($('.indicator-settings span')).toBeExisting()
      await expect(
        sampleItem('research').$(
          '[class*="tree-item-container-indicator-soft-fade-"]',
        ),
      ).toBeExisting()
      await browser.switchToWindow(
        (await browser.getWindowHandles()).find(
          (handle) => !containerHandles.includes(handle),
        ),
      )
      const iconRow = await $(
        '//section[@id="settings_containers"]//div[contains(@class,"toggle-container")][.//label[normalize-space()="Container icon"]]',
      )
      await iconRow.$('button=Right').click()
      await browser.switchToWindow(introductionHandle)
      await expect(
        sampleItem('research').$('.tree-item-container-icon'),
      ).toBeDisplayed()
      await expect($('.indicator-settings span')).not.toBeExisting()
    } finally {
      await browser.switchToWindow(introductionHandle)
      await browser.executeAsync((settings, done) => {
        window.browser.storage.local
          .set({ settings })
          .then(() =>
            window.browser.runtime.sendMessage({ type: 'settingsUpdated' }),
          )
          .then(done)
      }, originalSettings)
    }
  })

  it('shows Ctrl and Shift selections, bulk dragging, menus, and collapsed descendants safely', async () => {
    await openFeatures()
    await feature('multi-select')
    const tabsBefore = await tabIds()
    await $('button=Watch example').click()
    await expect($('.tree-demo')).toHaveAttribute('data-phase', 'after')
    await expect(sampleItem('research')).toHaveElementClass(
      'tree-item-selected',
    )
    await expect(sampleItem('other-tab')).toHaveElementClass(
      'tree-item-selected',
    )
    await expect(sampleItem('reference')).not.toHaveElementClass(
      'tree-item-selected',
    )
    await $('.example-choices').$('button=Shift-click').click()
    await $('button=Watch example').click()
    await expect($('.tree-demo')).toHaveAttribute('data-phase', 'after')
    for (const id of ['research', 'reference', 'other-tab'])
      await expect(sampleItem(id)).toHaveElementClass('tree-item-selected')
    await $('.example-choices').$('button=Drag selection').click()
    const beforeTop = await browser.execute(
      () =>
        document.querySelector('.tree-demo [data-example-id="research"]')
          .offsetTop,
    )
    await $('button=Watch example').click()
    await expect($('.demo-drag-preview')).toHaveText(
      expect.stringContaining('2 tabs'),
    )
    expect(
      await browser.execute(
        () =>
          document.querySelector('.tree-demo [data-example-id="research"]')
            .offsetTop,
      ),
    ).toBe(beforeTop)
    await expect(sampleItem('other-tab')).toHaveElementClass('drag-over-mid')
    await expect(sampleItem('last-tab')).not.toHaveElementClass('drag-over-mid')
    expect(
      await browser.execute(
        () => document.querySelectorAll('.tree-demo .drag-over-mid').length,
      ),
    ).toBe(1)
    await expect($('.tree-demo')).toHaveAttribute('data-phase', 'after')
    for (const id of ['research', 'reference'])
      await expect(sampleItem(id)).toHaveElementClass('indentLevel-2')
    await $('.example-choices').$('button=Context menu').click()
    await $('button=Watch example').click()
    await expect($('.demo-context-menu')).toBeDisplayed()
    await expect($('.demo-context-menu button')).toHaveText('Save')
    await expect($('.tree-demo')).toHaveAttribute('data-phase', 'after')
    for (const id of ['research', 'reference'])
      await expect(sampleItem(id)).toHaveAttribute('data-state', 'saved')
    await $('.example-choices').$('button=Windows and collapsed items').click()
    await $('button=Watch example').click()
    await expect(sampleItem('branch')).toHaveElementClass(
      'example-actions-visible',
    )
    await expect(sampleItem('branch').$('.collapse-arrow')).toBeDisplayed()
    await expect($('.tree-demo')).toHaveAttribute('data-phase', 'after')
    for (const id of ['window', 'branch'])
      await expect(sampleItem(id)).toHaveElementClass('tree-item-selected')
    await expect($('.selection-count')).toHaveText('Selected items: 9')
    for (const id of ['branch-child-1', 'branch-child-2'])
      await expect(sampleItem(id)).toHaveElementClass('tree-item-selected')
    // Collapse it again to check a manual range through hidden children.
    await sampleItem('branch').$('.tree-item-action-button').click()
    await $('.demo-play').moveTo()
    await expect(sampleItem('branch').$('.child-count')).toHaveText('2')
    await expect(sampleItem('branch-child-1')).not.toBeExisting()
    await sampleItem('branch').click()
    await browser.execute(() =>
      document
        .querySelector('.tree-demo [data-example-id="last-tab"]')
        .dispatchEvent(
          new MouseEvent('click', { bubbles: true, shiftKey: true }),
        ),
    )
    await expect($('.selection-count')).toHaveText('Selected items: 4')
    await sampleItem('branch').$('.tree-item-action-button').click()
    for (const id of ['branch-child-1', 'branch-child-2'])
      await expect(sampleItem(id)).toHaveElementClass('tree-item-selected')
    await sampleItem('last-tab').click({ button: 'right' })
    await expect($('.demo-context-menu')).toBeDisplayed()
    await expect($('.selection-count')).toHaveText('Selected items: 4')
    await $('.demo-context-menu button').click()
    for (const id of ['branch', 'branch-child-1', 'branch-child-2', 'last-tab'])
      await expect(sampleItem(id)).toHaveAttribute('data-state', 'saved')

    await $('.example-choices').$('button=Ctrl-click').click()
    await $('button=Watch example').click()
    await expect($('.demo-pointer')).toBeExisting()
    await sampleItem('research').click()
    await expect($('.tree-demo')).toHaveAttribute('data-phase', 'before')
    await expect($('button=Watch example')).toBeEnabled()
    await expect($('.demo-pointer')).not.toBeExisting()
    await browser.execute(() => {
      const original = window.matchMedia.bind(window)
      window.matchMedia = (query) =>
        query === '(prefers-reduced-motion: reduce)'
          ? { matches: true }
          : original(query)
    })
    await $('.example-choices').$('button=Shift-click').click()
    await $('button=Watch example').click()
    await expect($('.selection-count')).toHaveText('Selected items: 3')
    await expect($('.demo-pointer')).not.toBeExisting()
    expect(await tabIds()).toEqual(tabsBefore)
  })

  it('adds tab labels and window titles with their menu and text editor', async () => {
    await openFeatures()
    await feature('labels')
    const tabsBefore = await tabIds()
    await $('button=Watch example').click()
    await expect($('.demo-context-menu button')).toHaveText('Edit Label')
    await expect($('.modal-container')).toBeDisplayed()
    await expect($('.tree-demo')).toHaveAttribute('data-phase', 'after')
    await expect(
      sampleItem('research').$('.tree-item-custom-label'),
    ).toHaveText('Projects')
    await expect(sampleItem('research')).toHaveText(
      expect.stringContaining('Research'),
    )
    await sampleItem('research').click({ button: 'right' })
    await $('.demo-context-menu button').click()
    await expect($('.modal-input')).toHaveValue('Projects')
    await $('.modal-input').click()
    await browser.keys(['Control', 'a'])
    await browser.keys('Backspace')
    await expect($('.modal-input')).toHaveValue('')
    await $('button=OK').click()
    await expect(
      sampleItem('research').$('.tree-item-custom-label'),
    ).not.toBeExisting()
    await expect(sampleItem('research')).toHaveText('Research')
    await $('.example-choices').$('button=Window').click()
    await $('button=Watch example').click()
    await expect($('.demo-context-menu button')).toHaveText('Edit Title')
    await expect($('.tree-demo')).toHaveAttribute('data-phase', 'after')
    await expect(sampleItem('window').$('.tree-item-title')).toHaveText(
      'Projects',
    )
    await sampleItem('window').click({ button: 'right' })
    await $('.demo-context-menu button').click()
    await $('.modal-input').setValue('Travel')
    await $('button=OK').click()
    await expect(sampleItem('window').$('.tree-item-title')).toHaveText(
      'Travel',
    )
    await sampleItem('window').click({ button: 'right' })
    await $('.demo-context-menu button').click()
    await $('.modal-input').setValue('Cancelled change')
    await $('button=Cancel').click()
    await expect(sampleItem('window').$('.tree-item-title')).toHaveText(
      'Travel',
    )

    await sampleItem('research').click({ button: 'right' })
    await $('.demo-context-menu button').click()
    await expect($('.modal-input')).toHaveValue('')
    await $('.modal-input').setValue('Work')
    await $('button=OK').click()
    await expect(
      sampleItem('research').$('.tree-item-custom-label'),
    ).toHaveText('Work')
    await expect(sampleItem('window').$('.tree-item-title')).toHaveText(
      'Travel',
    )
    await fs.mkdir('.output/onboarding-preview', { recursive: true })
    await browser.saveScreenshot('.output/onboarding-preview/item-labels.png')
    expect(await tabIds()).toEqual(tabsBefore)
  })

  it('keeps the guide usable when the private-access check fails', async () => {
    await browser.execute(() => {
      window.browser.extension.isAllowedIncognitoAccess = () =>
        Promise.reject(new Error('private access unavailable'))
    })
    await $('button=Next').click()
    await $('button=Next').click()
    await expect($('h1')).toHaveText('Include Private Windows')
    await expect($('.access-status strong')).toHaveText('Not allowed')
    await expect($('button=Next')).toBeEnabled()
    await expect($('button=Skip introduction')).toBeEnabled()
    await $('button=Check again').click()
    await expect($('button=Next')).toBeEnabled()
    await $('button=Next').click()
    await expect($('h1')).toHaveText('Features')
    await $('button=Skip tips').click()
    await expect($('.settings-access button')).toBeEnabled()
  })

  it('resumes the private-access step after a real Firefox permission reload', async () => {
    // Keep a normal tab alive while Firefox closes all extension pages.
    await browser.executeAsync((done) => {
      window.browser.storage.local
        .get('settings')
        .then(({ settings }) =>
          window.browser.storage.local.set({
            settings: {
              ...settings,
              openSessionTreeOnStartup: false,
              retainPrivateWindows: false,
              includePrivateWindowsInSessionSnapshots: false,
              cachePrivateTabFavicons: false,
            },
          }),
        )
        .then(done)
    })
    await browser.newWindow('about:blank', { type: 'tab' })
    originalHandle = await browser.getWindowHandle()
    try {
      await setFirefoxExtensionPrivateBrowsingAllowed(
        FIREFOX_EXTENSION_ID,
        false,
        true,
      )
      await browser.newWindow(`${introductionUrl}?replay`, { type: 'tab' })
      introductionHandle = await browser.getWindowHandle()
      await expect($('h1')).toHaveText('Welcome to Session Flow')
      await $('button=Next').click()
      await $('input[value="import"]').click()
      await $('button=Next').click()
      await expect($('.access-status strong')).toHaveText('Not allowed')

      // Both checkbox values persist immediately, without completing the tour.
      for (const retain of [true, false]) {
        await expect($('.retention input')).toBeEnabled()
        if ((await $('.retention input').isSelected()) !== retain)
          await $('.retention input').click()
        await browser
          .waitUntil(
            async () => {
              const { settings } = await storedState()
              return (
                settings.retainPrivateWindows === retain &&
                settings.includePrivateWindowsInSessionSnapshots === retain &&
                settings.cachePrivateTabFavicons === retain
              )
            },
            {
              timeoutMsg: `Expected private retention settings to become ${retain}`,
            },
          )
          .catch(async (error) => {
            const { settings } = await storedState()
            const ui = await browser.execute(() => ({
              checked: document.querySelector('.retention input')?.checked,
              disabled: document.querySelector('.retention input')?.disabled,
              error: document.querySelector('.error')?.textContent,
            }))
            throw new Error(
              `${error.message}; retention=${JSON.stringify({ tree: settings.retainPrivateWindows, snapshots: settings.includePrivateWindowsInSessionSnapshots, favicons: settings.cachePrivateTabFavicons })}; ui=${JSON.stringify(ui)}`,
            )
          })
        await expect($('.retention input')).toBeEnabled()
        if (retain) await expect($('.retention input')).toBeChecked()
        else await expect($('.retention input')).not.toBeChecked()
      }
      await browser.refresh()
      await expect($('h1')).toHaveText('Include Private Windows')
      await expect($('.retention input')).not.toBeChecked()
      const pending = await storedState()
      expect(pending.privateWindowOnboarding.destination).toBe('import')
      expect(pending.privateWindowOnboarding.privateAccessResume.allowed).toBe(
        false,
      )

      const handles = await browser.getWindowHandles()
      await browser.switchToWindow(originalHandle)
      await setFirefoxExtensionPrivateBrowsingAllowed(
        FIREFOX_EXTENSION_ID,
        true,
        true,
      )
      introductionHandle = await switchToNewHandle(handles, introductionUrl)
      await expect($('h1')).toHaveText('Include Private Windows')
      await expect($('.access-status strong')).toHaveText('Allowed')
      await expect($('.retention input')).not.toBeChecked()
      const resumed = await storedState()
      expect(resumed.privateWindowOnboarding.destination).toBe('import')
      expect(
        resumed.privateWindowOnboarding.privateAccessResume,
      ).toBeUndefined()
      expect(resumed.settings.retainPrivateWindows).toBe(false)
      await $('button=Next').click()
      await expect($('h1')).toHaveText('Features')
      await $('button=Skip tips').click()
      const beforeImport = await browser.getWindowHandles()
      await $('button=Import a session').click()
      await switchToNewHandle(beforeImport, `${optionsUrl}#settings_storage`)
      expect((await storedState()).privateWindowOnboarding.status).toBe(
        'completed',
      )
    } finally {
      await browser.switchToWindow(originalHandle)
      await setFirefoxExtensionPrivateBrowsingAllowed(
        FIREFOX_EXTENSION_ID,
        true,
      )
    }
  })

  it('uses distinct tab and window names in every sample, including hidden children', async () => {
    async function checkNames() {
      const names = await browser.execute(() => {
        // Expand local branches so hidden rows are checked too.
        let collapsed
        while (
          (collapsed = document.querySelector(
            '.example-tree [aria-expanded="false"], .tree-demo [aria-expanded="false"]',
          ))
        ) {
          collapsed.click()
          // Vue applies the next render asynchronously; expand in a follow-up turn.
          return null
        }
        return [
          ...document.querySelectorAll(
            '.example-tree .tree-item[data-state], .tree-demo .tree-item[data-state]',
          ),
        ].map((row) => row.querySelector('.tree-item-title').textContent.trim())
      })
      if (names === null) {
        await browser.pause(50)
        return checkNames()
      }
      expect(new Set(names).size).toBe(names.length)
    }
    await checkNames()
    await openFeatures()
    const ids = await browser.execute(() =>
      [...document.querySelectorAll('.tip-tabs button')].map(
        (button) => button.dataset.featureId,
      ),
    )
    for (const id of ids) {
      await feature(id)
      await expect(
        $(`.tip-tabs button[data-feature-id="${id}"]`),
      ).toHaveAttribute('aria-current', 'step')
      await checkNames()
    }
  })
})
