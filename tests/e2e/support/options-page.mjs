import { $, browser, expect } from '@wdio/globals'
import { FIREFOX_EXTENSION_UUID } from './firefox-extension.mjs'
import { collectCoverageFromCurrentWindow } from './e2e-coverage.mjs'

export const OPTIONS_URL = `moz-extension://${FIREFOX_EXTENSION_UUID}/options.html`

export class OptionsPage {
  root() {
    return $('#options-root')
  }

  async expectLoaded() {
    await expect(await this.root()).toBeExisting()
    await browser.waitUntil(
      async () => {
        const root = await this.root()
        return (await root.isExisting()) && (await root.isDisplayed())
      },
      {
        timeout: 10_000,
        timeoutMsg: 'Expected the options page root to be visible.',
      },
    )
  }

  async setToggle(label, optionLabel) {
    const button = await this.toggleButton(label, optionLabel)

    await expect(button).toBeDisplayed()
    await button.scrollIntoView({ block: 'center', inline: 'nearest' })
    await button.click()
    await browser.waitUntil(
      async () => (await button.getAttribute('class')).includes('active'),
      {
        timeout: 10_000,
        timeoutMsg: `Expected "${label}" option "${optionLabel}" to be active.`,
      },
    )
  }

  async expectToggleActive(label, optionLabel) {
    const button = await this.toggleButton(label, optionLabel)

    await browser.waitUntil(
      async () => (await button.getAttribute('class')).includes('active'),
      {
        timeout: 10_000,
        timeoutMsg: `Expected "${label}" option "${optionLabel}" to be active.`,
      },
    )
  }

  async selectSection(sectionId) {
    const navItem = await $(`#nav-item-${sectionId}`)

    await expect(navItem).toBeDisplayed()
    await navItem.click()
    await this.expectSectionActive(sectionId)
  }

  async scrollToSection(sectionId) {
    // Click navigation uses a one-second smooth-scroll guard. Wait for it to
    // finish before simulating an independent manual scroll.
    await browser.pause(1_100)
    await browser.execute((targetSectionId) => {
      const panel = document.querySelector('.content-panel')
      const section = document.getElementById(targetSectionId)
      if (!(panel instanceof HTMLElement) || !section) return

      panel.scrollTop = section.offsetTop
      panel.dispatchEvent(new Event('scroll'))
    }, sectionId)
    await this.expectSectionActive(sectionId)
  }

  async expectSectionActive(sectionId) {
    const navItem = await $(`#nav-item-${sectionId}`)

    try {
      await browser.waitUntil(
        async () =>
          (await navItem.getAttribute('class')).includes('nav-item-active'),
        {
          timeout: 10_000,
          timeoutMsg: `Expected settings section "${sectionId}" to be active.`,
        },
      )
    } catch (error) {
      const scrollState = await browser.execute((targetSectionId) => {
        const panel = document.querySelector('.content-panel')
        const section = document.getElementById(targetSectionId)
        return {
          panelScrollTop:
            panel instanceof HTMLElement ? panel.scrollTop : undefined,
          panelScrollHeight:
            panel instanceof HTMLElement ? panel.scrollHeight : undefined,
          panelClientHeight:
            panel instanceof HTMLElement ? panel.clientHeight : undefined,
          sectionOffsetTop:
            section instanceof HTMLElement ? section.offsetTop : undefined,
          activeSection: document.querySelector('.nav-item-active')?.id,
        }
      }, sectionId)
      throw new Error(
        `Expected settings section "${sectionId}" to be active. Scroll state: ${JSON.stringify(scrollState)}`,
        { cause: error },
      )
    }
  }

  async expectStoredSetting(key, value) {
    await browser.waitUntil(
      async () => (await this.storedSetting(key)) === value,
      {
        timeout: 10_000,
        timeoutMsg: `Expected stored setting "${key}" to be ${String(value)}.`,
      },
    )
  }

  toggleButton(label, optionLabel) {
    return $(
      `//div[contains(concat(" ", normalize-space(@class), " "), " toggle-container ")][.//label[normalize-space()="${label}"]]//button[normalize-space()="${optionLabel}"]`,
    )
  }

  async expectToggleDisabled(label, optionLabel, disabled = true) {
    const button = await this.toggleButton(label, optionLabel)

    await browser.waitUntil(
      async () => (await button.isEnabled()) !== disabled,
      {
        timeout: 10_000,
        timeoutMsg: `Expected "${label}" option "${optionLabel}" to be ${disabled ? 'disabled' : 'enabled'}.`,
      },
    )
  }

  storedSetting(key) {
    return browser.executeAsync((settingKey, done) => {
      window.browser.storage.local
        .get('settings')
        .then(({ settings }) => done(settings?.[settingKey]))
        .catch((error) => done({ error: String(error) }))
    }, key)
  }
}

export async function openOptionsPage() {
  const originalHandle = await browser.getWindowHandle()
  await browser.newWindow(OPTIONS_URL)
  const optionsHandle = await browser.getWindowHandle()
  const page = new OptionsPage()

  await page.expectLoaded()

  return {
    originalHandle,
    optionsHandle,
    page,
  }
}

export async function closeOptionsPage(optionsHandle, nextHandle) {
  await browser.switchToWindow(optionsHandle)
  await collectCoverageFromCurrentWindow('options-page-close')
  await browser.closeWindow()

  const handles = await browser.getWindowHandles()
  const targetHandle = handles.includes(nextHandle) ? nextHandle : handles[0]
  if (targetHandle) {
    await browser.switchToWindow(targetHandle)
  }
}
