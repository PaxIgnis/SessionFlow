import { beforeEach, describe, expect, it, vi } from 'vitest'
import { DEFAULT_SETTINGS } from '@/defaults/settings'
import { Settings } from '@/services/settings'
import { loadBackgroundHandlers } from '../../helpers/background-handler-harness'

describe('background focus and window-type policy', () => {
  beforeEach(() => {
    Object.assign(Settings.values, structuredClone(DEFAULT_SETTINGS))
    vi.restoreAllMocks()
    vi.unstubAllGlobals()
    vi.doUnmock('@/services/background-actions')
    vi.doUnmock('@/services/background-on-created-queue')
    vi.doUnmock('@/services/background-session-restore')
    vi.doUnmock('@/services/background-tree')
    vi.doUnmock('@/services/runtime-port-service')
    vi.doUnmock('@/services/selection')
  })

  it.each(['popup', 'panel', 'devtools'] as const)(
    'does not track a Firefox %s window (EV-28)',
    async (type) => {
      const { fakeBrowser, initializeListeners, mocks } =
        await loadBackgroundHandlers()
      initializeListeners()

      await fakeBrowser.windows.onCreated.emitAsync({
        id: 30,
        type,
        incognito: false,
        tabs: [],
      } as browser.windows.Window)

      expect(mocks.beginWindowClassification).toHaveBeenCalledWith(30)
      expect(mocks.isNewWindowExtensionGenerated).toHaveBeenCalledWith(30)
      expect(mocks.handleCreatedWindow).not.toHaveBeenCalled()
      expect(mocks.addWindow).not.toHaveBeenCalled()
      expect(mocks.finishWindowClassification).toHaveBeenCalledWith(
        30,
        'ignored-window',
      )
    },
  )

  it.each([
    { label: 'ordinary', incognito: false },
    { label: 'private', incognito: true },
  ])(
    'tracks an accessible $label normal window (EV-28)',
    async ({ incognito }) => {
      const { fakeBrowser, initializeListeners, mocks } =
        await loadBackgroundHandlers()
      initializeListeners()

      await fakeBrowser.windows.onCreated.emitAsync({
        id: 30,
        type: 'normal',
        incognito,
        tabs: [],
      } as browser.windows.Window)

      expect(mocks.beginWindowClassification).toHaveBeenCalledWith(30)
      expect(mocks.handleCreatedWindow).toHaveBeenCalledOnce()
      expect(mocks.addWindow).toHaveBeenCalledWith(30)
      expect(mocks.finishWindowClassification).toHaveBeenCalledWith(
        30,
        'new-window',
      )
    },
  )

  it('routes WINDOW_ID_NONE without inventing a new tracked window (EV-26)', async () => {
    const { fakeBrowser, initializeListeners, mocks } =
      await loadBackgroundHandlers()
    initializeListeners()

    fakeBrowser.windows.onFocusChanged.emit(browser.windows.WINDOW_ID_NONE)

    expect(mocks.setActiveWindow).toHaveBeenCalledWith(
      browser.windows.WINDOW_ID_NONE,
      5,
    )
    expect(mocks.addWindow).not.toHaveBeenCalled()
  })
})
