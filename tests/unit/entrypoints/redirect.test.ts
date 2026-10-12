import { beforeEach, describe, expect, it, vi } from 'vitest'

import { flushMicrotasks, installFakeBrowser } from '../../helpers/fake-browser'

class FakeClassList {
  private readonly classes = new Set<string>()

  add(className: string) {
    this.classes.add(className)
  }

  remove(className: string) {
    this.classes.delete(className)
  }

  contains(className: string) {
    return this.classes.has(className)
  }
}

class FakeElement {
  disabled = true
  hidden = false
  textContent = ''
  href = ''
  innerHTML = ''
  readonly classList = new FakeClassList()
  private readonly listeners = new Map<string, (event: Event) => void>()

  addEventListener(type: string, listener: (event: Event) => void) {
    this.listeners.set(type, listener)
  }

  click() {
    const event = {
      preventDefault: vi.fn(),
    } as unknown as Event

    this.listeners.get('click')?.(event)
    return event
  }
}

class FakeDocument {
  documentElement = { lang: 'en' }
  querySelectorAll() {
    return []
  }

  title = ''
  private domContentLoadedListener: (() => void) | undefined
  readonly elements = new Map<string, FakeElement | null>()

  addEventListener(type: string, listener: () => void) {
    if (type === 'DOMContentLoaded') {
      this.domContentLoadedListener = listener
    }
  }

  getElementById(id: string) {
    return this.elements.get(id) ?? null
  }

  fireDOMContentLoaded() {
    this.domContentLoadedListener?.()
  }
}

describe('redirect entrypoint', () => {
  beforeEach(() => {
    vi.resetModules()
    vi.unstubAllGlobals()
    vi.useRealTimers()
  })

  it('renders the privileged target URL and copies it on click', async () => {
    vi.useFakeTimers()
    const document = createRedirectDocument()
    const writeText = vi.fn().mockResolvedValue(undefined)
    const fakeBrowser = installRedirectGlobals({
      document,
      search: '?targetUrl=about%3Aconfig&targetTitle=Advanced%20Preferences',
      writeText,
    })

    await import('@/entrypoints/redirect/main')
    expect(document.elements.get('redirect-page')!.hidden).toBe(true)
    document.fireDOMContentLoaded()
    expect(document.elements.get('redirect-page')!.hidden).toBe(false)

    const targetUrlElement = document.elements.get('target-url')!
    const copiedMessageElement = document.elements.get('copied-message')!

    expect(document.title).toBe('Redirect to Advanced Preferences')
    expect(document.elements.get('target-title')!.textContent).toBe(
      'Advanced Preferences',
    )
    expect(document.elements.get('target-title-section')!.hidden).toBe(false)
    expect(targetUrlElement.textContent).toBe('about:config')
    expect(targetUrlElement.href).toBe('about:config')
    expect(document.elements.get('message')!.textContent).toContain(
      'URL is privileged',
    )

    expect(fakeBrowser.permissions.request).not.toHaveBeenCalled()
    const clickEvent = targetUrlElement.click()
    expect(writeText).toHaveBeenCalledWith('about:config')
    expect(fakeBrowser.permissions.request).not.toHaveBeenCalled()
    await flushMicrotasks()

    expect(clickEvent.preventDefault).toHaveBeenCalledTimes(1)
    expect(writeText).toHaveBeenCalledWith('about:config')
    expect(copiedMessageElement.classList.contains('visible')).toBe(true)

    vi.advanceTimersByTime(2_000)

    expect(copiedMessageElement.classList.contains('visible')).toBe(false)
  })

  it('copies through the explicit button without requesting permission', async () => {
    const document = createRedirectDocument()
    const writeText = vi.fn().mockResolvedValue(undefined)
    const fakeBrowser = installRedirectGlobals({
      document,
      search: '?targetUrl=about%3Aconfig',
      writeText,
    })
    await import('@/entrypoints/redirect/main')
    document.fireDOMContentLoaded()
    expect(document.title).toBe('Open this page manually')
    expect(document.elements.get('target-title-section')!.hidden).toBe(true)
    const copyButton = document.elements.get('copy-url')!
    expect(copyButton.disabled).toBe(false)
    copyButton.click()
    expect(writeText).toHaveBeenCalledWith('about:config')
    expect(fakeBrowser.permissions.request).not.toHaveBeenCalled()
    await flushMicrotasks()
    expect(document.elements.get('copied-message')!.textContent).toBe('Copied!')
  })

  it('logs copy failures without throwing from the click handler', async () => {
    const document = createRedirectDocument()
    const error = new Error('clipboard denied')
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {})
    installRedirectGlobals({
      document,
      search: '?targetUrl=about%3Aprofiles',
      writeText: vi.fn().mockRejectedValue(error),
    })

    try {
      await import('@/entrypoints/redirect/main')
      document.fireDOMContentLoaded()

      document.elements.get('target-url')!.click()
      await flushMicrotasks()

      expect(consoleError).toHaveBeenCalledWith(
        'Error copying URL to clipboard:',
        error,
      )
      const status = document.elements.get('copied-message')!
      expect(status.textContent).toBe(
        'Copy unavailable. Select the URL and copy it manually.',
      )
      expect(status.classList.contains('visible')).toBe(true)
    } finally {
      consoleError.mockRestore()
    }
  })

  it('does not render copy UI when the target URL is missing', async () => {
    const document = createRedirectDocument()
    const writeText = vi.fn()
    installRedirectGlobals({
      document,
      search: '?targetTitle=Missing%20URL',
      writeText,
    })

    await import('@/entrypoints/redirect/main')
    document.fireDOMContentLoaded()

    expect(document.title).toBe('Redirect to Missing URL')
    expect(document.elements.get('target-url')!.textContent).toBe('')
    expect(document.elements.get('message')!.innerHTML).toBe('')
    expect(writeText).not.toHaveBeenCalled()
    expect(document.elements.get('copy-url')!.disabled).toBe(true)
    expect(document.elements.get('redirect-page')!.hidden).toBe(false)
  })

  it('renders HTML-looking, Unicode, fragmented, and long targets only as text', async () => {
    const targetUrl = `about:reader?url=${encodeURIComponent(
      'https://example.test/<img src=x onerror=alert(1)>/Î»',
    )}#fragment-${'x'.repeat(2_000)}`
    const targetTitle = '<script>alert(1)</script> â€” Î»'
    const document = createRedirectDocument()
    installRedirectGlobals({
      document,
      search: `?targetUrl=${encodeURIComponent(targetUrl)}&targetTitle=${encodeURIComponent(targetTitle)}`,
      writeText: vi.fn().mockResolvedValue(undefined),
    })

    await import('@/entrypoints/redirect/main')
    document.fireDOMContentLoaded()

    const target = document.elements.get('target-url')!
    expect(document.title).toBe(`Redirect to ${targetTitle}`)
    expect(document.elements.get('target-title')!.textContent).toBe(targetTitle)
    expect(document.elements.get('target-title')!.innerHTML).toBe('')
    expect(target.textContent).toBe(targetUrl)
    expect(target.href).toBe(targetUrl)
    expect(target.innerHTML).toBe('')
  })

  it('shows manual-copy guidance when the clipboard API is unavailable', async () => {
    const document = createRedirectDocument()
    installRedirectGlobals({
      document,
      search: '?targetUrl=about%3Aconfig',
    })

    await import('@/entrypoints/redirect/main')
    document.fireDOMContentLoaded()

    expect(() => document.elements.get('target-url')!.click()).not.toThrow()
    await Promise.resolve()
    const status = document.elements.get('copied-message')!
    expect(status.textContent).toBe(
      'Copy unavailable. Select the URL and copy it manually.',
    )
    expect(status.classList.contains('visible')).toBe(true)
  })
  it('handles synchronous clipboard failures without requesting permission', async () => {
    const document = createRedirectDocument()
    const writeText = vi.fn()
    const fakeBrowser = installRedirectGlobals({
      document,
      search: '?targetUrl=about%3Aconfig',
      writeText,
    })
    const error = new Error('Clipboard unavailable')
    writeText.mockImplementation(() => {
      throw error
    })
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {})
    try {
      await import('@/entrypoints/redirect/main')
      document.fireDOMContentLoaded()
      document.elements.get('target-url')!.click()
      await flushMicrotasks()
      expect(fakeBrowser.permissions.request).not.toHaveBeenCalled()
      expect(consoleError).toHaveBeenCalledWith(
        'Error copying URL to clipboard:',
        error,
      )
      expect(
        document.elements.get('copied-message')!.classList.contains('visible'),
      ).toBe(true)
    } finally {
      consoleError.mockRestore()
    }
  })
})

function createRedirectDocument() {
  const document = new FakeDocument()
  const page = new FakeElement()
  page.hidden = true
  document.elements.set('redirect-page', page)
  document.elements.set('message', new FakeElement())
  const title = new FakeElement()
  document.elements.set('target-title', title)
  const titleSection = new FakeElement()
  titleSection.hidden = true
  document.elements.set('target-title-section', titleSection)
  document.elements.set('target-url', new FakeElement())
  document.elements.set('copy-url', new FakeElement())
  document.elements.set('copied-message', new FakeElement())
  return document
}

function installRedirectGlobals({
  document,
  search,
  writeText,
}: {
  document: FakeDocument
  search: string
  writeText?: (text: string) => Promise<void>
}) {
  const fakeBrowser = installFakeBrowser()
  vi.stubGlobal('document', document)
  vi.stubGlobal('window', {
    location: {
      search,
    },
  })
  vi.stubGlobal(
    'navigator',
    writeText
      ? {
          clipboard: {
            writeText,
          },
        }
      : {},
  )
  return fakeBrowser
}
