import { browser } from '@wdio/globals'
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
    await first.page.setToggle('Show Tab Title On Hover', 'Off')
    await first.page.expectStoredSetting('showTabTitleOnHover', false)

    await browser.switchToWindow(second.optionsHandle)
    await second.page.setToggle('Show Tab URL On Hover', 'Off')
    await second.page.expectStoredSetting('showTabUrlOnHover', false)

    await browser.switchToWindow(first.optionsHandle)
    await first.page.expectToggleActive('Show Tab URL On Hover', 'Off')
    await first.page.expectStoredSetting('showTabTitleOnHover', false)
    await first.page.expectStoredSetting('showTabUrlOnHover', false)

    await browser.switchToWindow(second.optionsHandle)
    await second.page.setToggle('Show Tab Title On Hover', 'On')
    await second.page.setToggle('Show Tab URL On Hover', 'On')
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

  it('disables dependent controls without changing their saved value', async () => {
    const options = await trackOptionsPage()

    await options.page.setToggle(
      'Save Tab When Closed If It Previously Was Saved',
      'Off',
    )
    await options.page.expectStoredSetting(
      'saveTabOnCloseIfPreviouslySaved',
      false,
    )

    await options.page.setToggle('Save Tab When Closed', 'On')
    await options.page.expectToggleDisabled(
      'Save Tab When Closed If It Previously Was Saved',
      'Off',
    )
    await options.page.expectStoredSetting(
      'saveTabOnCloseIfPreviouslySaved',
      false,
    )

    await options.page.setToggle('Save Tab When Closed', 'Off')
    await options.page.expectToggleDisabled(
      'Save Tab When Closed If It Previously Was Saved',
      'Off',
      false,
    )
    await options.page.expectToggleActive(
      'Save Tab When Closed If It Previously Was Saved',
      'Off',
    )
  })

  async function trackOptionsPage() {
    const options = await openOptionsPage()
    openOptionsHandles.add(options.optionsHandle)
    return options
  }
})
