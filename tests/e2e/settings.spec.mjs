import { $, $$, browser, expect } from '@wdio/globals'
import { closeOptionsPage, openOptionsPage } from './support/options-page.mjs'

describe('settings workflows', () => {
  const openOptionsHandles = new Set()
  let originalHandle

  beforeEach(async () => {
    originalHandle = await browser.getWindowHandle()
  })

  afterEach(async () => {
    const handles = await browser.getWindowHandles()
    const settingsHandle = [...openOptionsHandles].find((handle) =>
      handles.includes(handle),
    )
    if (settingsHandle) {
      await browser.switchToWindow(settingsHandle)
      await browser.executeAsync((done) => {
        window.browser.storage.local
          .get('settings')
          .then(({ settings }) =>
            window.browser.storage.local.set({
              settings: {
                ...(settings || {}),
                showTabTitleOnHover: true,
                showTabUrlOnHover: true,
                saveTabOnClose: false,
                saveTabOnCloseIfPreviouslySaved: true,
                contextMenuDeleteDescendants: 'collapsed',
              },
            }),
          )
          .then(() =>
            window.browser.runtime.sendMessage({ type: 'settingsUpdated' }),
          )
          .then(() => done({ ok: true }))
          .catch((error) => done({ ok: false, error: String(error) }))
      })
    }
    for (const handle of openOptionsHandles) {
      if (!handles.includes(handle)) continue
      await browser.switchToWindow(handle)
      await browser.closeWindow()
    }
    openOptionsHandles.clear()

    const remainingHandles = await browser.getWindowHandles()
    if (remainingHandles.includes(originalHandle)) {
      await browser.switchToWindow(originalHandle)
    }
  })

  it('merges edits from two options pages and synchronizes both pages', async () => {
    const first = await trackOptionsPage()
    const second = await trackOptionsPage()

    await browser.switchToWindow(first.optionsHandle)
    await first.page.setToggle('Tab title', 'Off')
    await first.page.expectStoredSetting('showTabTitleOnHover', false)

    await browser.switchToWindow(second.optionsHandle)
    await second.page.setToggle('Tab URL', 'Off')
    await second.page.expectStoredSetting('showTabUrlOnHover', false)

    await browser.switchToWindow(first.optionsHandle)
    await first.page.expectToggleActive('Tab URL', 'Off')
    await first.page.expectStoredSetting('showTabTitleOnHover', false)
    await first.page.expectStoredSetting('showTabUrlOnHover', false)

    await browser.switchToWindow(second.optionsHandle)
    await second.page.setToggle('Tab title', 'On')
    await second.page.setToggle('Tab URL', 'On')
    await second.page.expectStoredSetting('showTabTitleOnHover', true)
    await second.page.expectStoredSetting('showTabUrlOnHover', true)
  })

  it('keeps navigation highlighting aligned with clicks and scrolling', async () => {
    const options = await trackOptionsPage()

    await options.page.selectSection('settings_tabs')
    await options.page.scrollToSection('settings_favicons')

    await closeOptionsPage(options.optionsHandle, originalHandle)
    openOptionsHandles.delete(options.optionsHandle)
  })

  it('moves descendant scope choices with arrow keys and saves the row', async () => {
    const options = await trackOptionsPage()
    await options.page.selectSection('settings_context_menu')

    const radios = await $$(
      'input[name="descendant-scope-contextMenuDeleteDescendants"]',
    )
    expect(radios).toHaveLength(3)

    await radios[0].scrollIntoView({ block: 'center' })
    await radios[0].click()
    await expect(radios[0]).toBeSelected()
    // Arrow keys only move a native radio group when a radio actually holds
    // focus, so assert that separately — otherwise a focus failure is
    // indistinguishable from a broken binding.
    await expect(radios[0]).toBeFocused()

    await browser.keys(['ArrowRight'])

    await expect(radios[1]).toBeSelected()
    await options.page.expectStoredSetting(
      'contextMenuDeleteDescendants',
      'collapsed',
    )
  })

  it('disables dependent controls without changing their saved value', async () => {
    const options = await trackOptionsPage()
    const tabSection = await $('#settings_tabs')
    const previouslySavedOff = await tabSection.$(
      './/div[contains(concat(" ", normalize-space(@class), " "), " toggle-container ")][.//label[normalize-space()="Save it if it was previously saved"]]//button[normalize-space()="Off"]',
    )

    await previouslySavedOff.scrollIntoView({ block: 'center' })
    await previouslySavedOff.click()
    await options.page.expectStoredSetting(
      'saveTabOnCloseIfPreviouslySaved',
      false,
    )

    await options.page.setToggle('Save tabs when they close', 'On')
    await expect(previouslySavedOff).toBeDisabled()
    await options.page.expectStoredSetting(
      'saveTabOnCloseIfPreviouslySaved',
      false,
    )

    await options.page.setToggle('Save tabs when they close', 'Off')
    await expect(previouslySavedOff).toBeEnabled()
    expect(await previouslySavedOff.getAttribute('class')).toContain('active')
  })

  async function trackOptionsPage() {
    const options = await openOptionsPage()
    openOptionsHandles.add(options.optionsHandle)
    return options
  }
})
