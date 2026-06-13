import { beforeEach, describe, expect, it, vi } from 'vitest'

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
    installRedirectGlobals({
      document,
      search:
        '?targetUrl=about%3Aconfig&targetTitle=Advanced%20Preferences',
      writeText,
    })

    await import('@/entrypoints/redirect/main')
    document.fireDOMContentLoaded()

    const targetUrlElement = document.elements.get('target-url')!
    const copiedMessageElement = document.elements.get('copied-message')!

    expect(document.title).toBe('Redirect to Advanced Preferences')
    expect(targetUrlElement.textContent).toBe('about:config')
    expect(targetUrlElement.href).toBe('about:config')
    expect(document.elements.get('message')!.innerHTML).toContain(
      'privileged URL',
    )

    const clickEvent = targetUrlElement.click()
    await Promise.resolve()

    expect(clickEvent.preventDefault).toHaveBeenCalledTimes(1)
    expect(writeText).toHaveBeenCalledWith('about:config')
    expect(copiedMessageElement.classList.contains('visible')).toBe(true)

    vi.advanceTimersByTime(2_000)

    expect(copiedMessageElement.classList.contains('visible')).toBe(false)
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
      await Promise.resolve()
      await Promise.resolve()

      expect(consoleError).toHaveBeenCalledWith(
        'Error copying URL to clipboard:',
        error,
      )
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
  })
})

function createRedirectDocument() {
  const document = new FakeDocument()
  document.elements.set('message', new FakeElement())
  document.elements.set('target-url', new FakeElement())
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
  writeText: (text: string) => Promise<void>
}) {
  vi.stubGlobal('document', document)
  vi.stubGlobal('window', {
    location: {
      search,
    },
  })
  vi.stubGlobal('navigator', {
    clipboard: {
      writeText,
    },
  })
}
