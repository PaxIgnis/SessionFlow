import { isPrivateWindowAccessAllowed } from '@/services/utils'
import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('@/services/utils', () => ({
  isPrivateWindowAccessAllowed: vi.fn(),
}))

type EventListener = () => void | Promise<void>

class FakeElement {
  textContent = ''
  readonly dataset: Record<string, string> = {}
  private readonly listeners = new Map<string, EventListener>()

  addEventListener(type: string, listener: EventListener): void {
    this.listeners.set(type, listener)
  }

  async click(): Promise<void> {
    await this.listeners.get('click')?.()
  }
}

class FakeDocument {
  private domContentLoadedListener: EventListener | undefined
  readonly elements = new Map<string, FakeElement>()

  addEventListener(type: string, listener: EventListener): void {
    if (type === 'DOMContentLoaded') {
      this.domContentLoadedListener = listener
    }
  }

  getElementById(id: string): FakeElement | null {
    return this.elements.get(id) ?? null
  }

  async fireDOMContentLoaded(): Promise<void> {
    await this.domContentLoadedListener?.()
  }
}

describe('private-window onboarding popup', () => {
  beforeEach(() => {
    vi.resetModules()
    vi.restoreAllMocks()
    vi.unstubAllGlobals()
    vi.mocked(isPrivateWindowAccessAllowed).mockResolvedValue(true)
  })

  it('shows access status and checks it again', async () => {
    const { document } = installPopupGlobals()
    vi.mocked(isPrivateWindowAccessAllowed)
      .mockResolvedValueOnce(false)
      .mockResolvedValueOnce(true)

    await import('@/entrypoints/private-window-onboarding/main')
    await document.fireDOMContentLoaded()

    const status = document.elements.get('private-access-status')!
    expect(status.textContent).toBe('Not allowed')
    expect(status.dataset.status).toBe('not-allowed')

    await document.elements.get('check-again')!.click()

    expect(status.textContent).toBe('Allowed')
    expect(status.dataset.status).toBe('allowed')
  })

  it('hides without completing onboarding', async () => {
    const { close, document, sendMessage } = installPopupGlobals()

    await import('@/entrypoints/private-window-onboarding/main')
    await document.fireDOMContentLoaded()
    await document.elements.get('hide')!.click()

    expect(sendMessage).not.toHaveBeenCalled()
    expect(close).toHaveBeenCalledTimes(1)
  })

  it.each([
    ['continue', 'continue'],
    ['dismiss', 'dismiss'],
  ] as const)(
    'sends the %s completion action before closing',
    async (elementId, command) => {
      const { close, document, sendMessage } = installPopupGlobals()

      await import('@/entrypoints/private-window-onboarding/main')
      await document.fireDOMContentLoaded()
      await document.elements.get(elementId)!.click()

      expect(sendMessage).toHaveBeenCalledWith({
        action: 'privateWindowOnboarding',
        command,
      })
      expect(close).toHaveBeenCalledTimes(1)
    },
  )

  it('ignores repeated completion clicks while one is in flight', async () => {
    const { close, document, sendMessage } = installPopupGlobals()

    await import('@/entrypoints/private-window-onboarding/main')
    await document.fireDOMContentLoaded()
    const firstClick = document.elements.get('continue')!.click()
    const secondClick = document.elements.get('continue')!.click()
    await Promise.all([firstClick, secondClick])

    expect(sendMessage).toHaveBeenCalledTimes(1)
    expect(close).toHaveBeenCalledTimes(1)
  })

  it('keeps the popup open when completion fails', async () => {
    const error = new Error('background unavailable')
    const { close, document, sendMessage } = installPopupGlobals()
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {})
    sendMessage.mockRejectedValue(error)

    await import('@/entrypoints/private-window-onboarding/main')
    await document.fireDOMContentLoaded()
    await document.elements.get('dismiss')!.click()

    expect(consoleError).toHaveBeenCalledWith(
      'Failed to complete private-window onboarding:',
      error,
    )
    expect(close).not.toHaveBeenCalled()
  })
})

function installPopupGlobals() {
  const document = new FakeDocument()
  for (const id of [
    'private-access-status',
    'check-again',
    'continue',
    'hide',
    'dismiss',
  ]) {
    document.elements.set(id, new FakeElement())
  }

  const close = vi.fn()
  const sendMessage = vi.fn().mockResolvedValue(undefined)
  vi.stubGlobal('document', document)
  vi.stubGlobal('window', { close })
  vi.stubGlobal('browser', {
    runtime: {
      sendMessage,
    },
  })

  return { close, document, sendMessage }
}
