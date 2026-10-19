import { $, $$, browser, expect } from '@wdio/globals'
import { closeOptionsPage, openOptionsPage } from './support/options-page.mjs'

describe('settings workflows', () => {
  const openOptionsHandles = new Set()
  let originalHandle
  let originalScopes = {}

  beforeEach(async () => {
    originalScopes = {}
    originalHandle = await browser.getWindowHandle()
  })

  afterEach(async () => {
    const handles = await browser.getWindowHandles()
    const settingsHandle = [...openOptionsHandles].find((handle) =>
      handles.includes(handle),
    )
    if (settingsHandle) {
      await browser.switchToWindow(settingsHandle)
      await browser.executeAsync((scopes, done) => {
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
                ...scopes,
              },
            }),
          )
          .then(() =>
            window.browser.runtime.sendMessage({ type: 'settingsUpdated' }),
          )
          .then(() => done({ ok: true }))
          .catch((error) => done({ ok: false, error: String(error) }))
      }, originalScopes)
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

  it('saves descendant scopes independently with arrow keys and preserves them after reload', async () => {
    const options = await trackOptionsPage()
    await options.page.selectSection('settings_context_menu')
    const keys = [
      'contextMenuDeleteDescendants',
      'duplicateTreeItemDescendants',
      'contextMenuOpenDescendants',
      'contextMenuReloadDescendants',
      'contextMenuSaveDescendants',
      'contextMenuPinDescendants',
      'includeChildrenOfSelectedItemsWhenIndenting',
    ]
    const selector = (key) => 'input[name="descendant-scope-' + key + '"]'
    for (const key of keys)
      originalScopes[key] = await $(selector(key) + ':checked').getValue()
    const expected = { ...originalScopes }

    for (const key of keys) {
      const radios = await $$(selector(key))
      const values = await radios.map((radio) => radio.getValue())
      expect(values).toHaveLength(3)
      expect(values).toEqual(
        expect.arrayContaining(
          key === 'duplicateTreeItemDescendants'
            ? ['complete-subtree', 'collapsed', 'selected-only']
            : ['always', 'collapsed', 'never'],
        ),
      )
      const firstChoice = await radios[0].parentElement()
      await firstChoice.scrollIntoView({ block: 'center' })
      await firstChoice.click()
      await expect(radios[0]).toBeFocused()
      await options.page.expectStoredSetting(key, values[0])

      for (let index = 1; index < radios.length; index++) {
        await browser.keys('ArrowRight')
        await expect(radios[index]).toBeSelected()
        await options.page.expectStoredSetting(key, values[index])
      }
      expected[key] = values.at(-1)
      for (const otherKey of keys)
        await expect($(selector(otherKey) + ':checked')).toHaveValue(
          expected[otherKey],
        )
    }

    await browser.refresh()
    await options.page.expectLoaded()
    await options.page.selectSection('settings_context_menu')
    for (const key of keys) {
      await expect($(selector(key) + ':checked')).toHaveValue(expected[key])
      await options.page.expectStoredSetting(key, expected[key])
    }
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

    await options.page.setToggleByKey('saveTabsWhenTheyClose', 'on')
    await expect(previouslySavedOff).toBeDisabled()
    await options.page.expectStoredSetting(
      'saveTabOnCloseIfPreviouslySaved',
      false,
    )

    await options.page.setToggleByKey('saveTabsWhenTheyClose', 'off')
    await expect(previouslySavedOff).toBeEnabled()
    expect(await previouslySavedOff.getAttribute('class')).toContain('active')
  })

  async function trackOptionsPage() {
    const options = await openOptionsPage()
    openOptionsHandles.add(options.optionsHandle)
    return options
  }
})
