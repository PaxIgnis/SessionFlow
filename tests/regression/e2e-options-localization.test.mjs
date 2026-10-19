import { afterEach, describe, expect, it, vi } from 'vitest'
import { $, browser } from '@wdio/globals'
import { OptionsPage } from '../e2e/support/options-page.mjs'

vi.mock('@wdio/globals', () => ({
  $: vi.fn(),
  browser: { execute: vi.fn() },
  expect: vi.fn(),
}))

afterEach(() => {
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
})

describe('localized options selectors', () => {
  it('uses the installed messages after wording changes without changing test keys', async () => {
    const messages = {
      saveTabsWhenTheyClose: 'Keep closed tabs',
      on: 'Enabled',
    }
    vi.stubGlobal('window', {
      browser: { i18n: { getMessage: (key) => messages[key] ?? '' } },
    })
    browser.execute.mockImplementation(async (callback, keys) => callback(keys))
    const page = new OptionsPage()
    const setToggle = vi.spyOn(page, 'setToggle').mockResolvedValue(undefined)

    await page.setToggleByKey('saveTabsWhenTheyClose', 'on')
    expect(setToggle).toHaveBeenLastCalledWith('Keep closed tabs', 'Enabled')

    messages.saveTabsWhenTheyClose = 'Retain tabs after closing'
    await page.setToggleByKey('saveTabsWhenTheyClose', 'on')
    expect(setToggle).toHaveBeenLastCalledWith(
      'Retain tabs after closing',
      'Enabled',
    )
  })

  it('reports a missing message key instead of selecting an empty label', async () => {
    vi.stubGlobal('window', {
      browser: { i18n: { getMessage: () => '' } },
    })
    browser.execute.mockImplementation(async (callback, keys) => callback(keys))

    await expect(
      new OptionsPage().setToggleByKey('missingKey', 'on'),
    ).rejects.toThrow('Missing localized message: missingKey')
  })

  it('quotes labels containing both kinds of quotation marks as XPath literals', () => {
    new OptionsPage().toggleButton(`Save "closed" tabs, don't delete`, 'On')

    expect($).toHaveBeenLastCalledWith(
      `//div[contains(concat(" ", normalize-space(@class), " "), " toggle-container ")][.//label[normalize-space()=concat("Save ", '"', "closed", '"', " tabs, don't delete")]]//button[normalize-space()="On"]`,
    )
  })
})
