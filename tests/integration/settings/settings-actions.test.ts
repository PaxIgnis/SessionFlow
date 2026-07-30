import { beforeEach, describe, expect, it, vi } from 'vitest'
import { DEFAULT_SETTINGS } from '@/defaults/settings'
import { Settings } from '@/services/settings'
import { FakeBrowser, installFakeBrowser } from '../../helpers/fake-browser'

describe('settings actions', () => {
  let fakeBrowser: FakeBrowser

  beforeEach(() => {
    fakeBrowser = installFakeBrowser()
    Object.assign(Settings.values, structuredClone(DEFAULT_SETTINGS))
  })

  it('loads valid settings and ignores invalid keys or values', async () => {
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {})
    vi.mocked(browser.storage.local.get).mockResolvedValue({
      settings: {
        openSessionTreeOnStartup: true,
        doubleClickOnOpenTab: 'duplicate',
        notASetting: true,
        openWindowWithTabsDiscarded: 'yes',
        doubleClickOnSavedTab: 'bad-option',
      },
    })
    const { loadSettingsFromStorage } =
      await import('@/services/settings-actions')

    await loadSettingsFromStorage()

    expect(Settings.values.openSessionTreeOnStartup).toBe(true)
    expect(Settings.values.doubleClickOnOpenTab).toBe('duplicate')
    expect(Settings.values.openWindowWithTabsDiscarded).toBe(
      DEFAULT_SETTINGS.openWindowWithTabsDiscarded,
    )
    expect(Settings.values.doubleClickOnSavedTab).toBe(
      DEFAULT_SETTINGS.doubleClickOnSavedTab,
    )
    expect(consoleError).toHaveBeenCalledWith(
      'Invalid settings key: notASetting',
    )
    expect(consoleError).toHaveBeenCalledWith(
      'Error validating settings openWindowWithTabsDiscarded:',
      expect.any(Error),
    )
    expect(consoleError).toHaveBeenCalledWith(
      'Error validating settings doubleClickOnSavedTab:',
      expect.any(Error),
    )
  })

  it('does nothing when storage has no settings object', async () => {
    Settings.values.openSessionTreeOnStartup = true
    Settings.values.refreshFaviconsAfterPeriodOfTimeValue = 42
    vi.mocked(browser.storage.local.get).mockResolvedValue({})
    const { loadSettingsFromStorage } =
      await import('@/services/settings-actions')

    await loadSettingsFromStorage()

    expect(Settings.values).toEqual(DEFAULT_SETTINGS)
    expect(Object.keys(Settings.values).sort()).toEqual(
      Object.keys(DEFAULT_SETTINGS).sort(),
    )
    expect(Settings.values.cachePrivateTabFavicons).toBe(true)
  })

  it('fills every missing legacy setting from current defaults', async () => {
    Settings.values.enableDragAndDrop = false
    Settings.values.containerFadeSide = 'left'
    vi.mocked(browser.storage.local.get).mockResolvedValue({
      settings: {
        openSessionTreeOnStartup: true,
      },
    })
    const { loadSettingsFromStorage } =
      await import('@/services/settings-actions')

    await loadSettingsFromStorage()

    expect(Settings.values).toEqual({
      ...DEFAULT_SETTINGS,
      openSessionTreeOnStartup: true,
    })
  })

  it.each([
    ['openWindowsInSameLocationUpdateInterval', -1, 1],
    ['openWindowsInSameLocationUpdateInterval', 0, 1],
    ['openWindowsInSameLocationUpdateInterval', 9_999_999, 3600],
    ['refreshFaviconsAfterPeriodOfTimeValue', -5, 1],
    ['refreshFaviconsAfterPeriodOfTimeValue', 0, 1],
    ['refreshFaviconsAfterPeriodOfTimeValue', 1_000_000, 999],
  ] as const)('clamps %s value %s to %s', async (key, value, expected) => {
    vi.mocked(browser.storage.local.get).mockResolvedValue({
      settings: { [key]: value },
    })
    const { loadSettingsFromStorage } =
      await import('@/services/settings-actions')

    await loadSettingsFromStorage()

    expect(Settings.values[key]).toBe(expected)
  })

  it.each([NaN, Number.POSITIVE_INFINITY, Number.NEGATIVE_INFINITY])(
    'rejects non-finite numeric setting %s',
    async (value) => {
      const consoleError = vi
        .spyOn(console, 'error')
        .mockImplementation(() => {})
      vi.mocked(browser.storage.local.get).mockResolvedValue({
        settings: { refreshFaviconsAfterPeriodOfTimeValue: value },
      })
      const { loadSettingsFromStorage } =
        await import('@/services/settings-actions')

      await loadSettingsFromStorage()

      expect(Settings.values.refreshFaviconsAfterPeriodOfTimeValue).toBe(
        DEFAULT_SETTINGS.refreshFaviconsAfterPeriodOfTimeValue,
      )
      expect(consoleError).toHaveBeenCalledWith(
        'Error validating settings refreshFaviconsAfterPeriodOfTimeValue:',
        expect.any(Error),
      )
    },
  )

  it('normalizes a settings object without retaining unknown keys', async () => {
    const { normalizeSettings } = await import('@/services/settings-actions')

    expect(
      normalizeSettings({
        openSessionTreeOnStartup: true,
        unknownSetting: 'ignored',
      }),
    ).toEqual({
      ...DEFAULT_SETTINGS,
      openSessionTreeOnStartup: true,
    })
  })

  it('keeps default settings immutable when runtime settings change', () => {
    Settings.values.refreshFaviconsAfterPeriodOfTime = true

    expect(DEFAULT_SETTINGS.refreshFaviconsAfterPeriodOfTime).toBe(false)
  })

  it('saves settings and broadcasts the update message', async () => {
    const { saveSettingsToStorage } =
      await import('@/services/settings-actions')
    const { loadSettingsFromStorage } =
      await import('@/services/settings-actions')
    vi.mocked(browser.storage.local.get).mockResolvedValue({
      settings: structuredClone(DEFAULT_SETTINGS),
    })
    await loadSettingsFromStorage()
    Settings.values.openSessionTreeOnStartup = true

    await saveSettingsToStorage()

    expect(browser.runtime.sendMessage).toHaveBeenCalledWith({
      type: 'settingsUpdated',
    })
    expect(browser.storage.local.set).toHaveBeenCalledWith({
      settings: expect.objectContaining({
        openSessionTreeOnStartup: true,
      }),
    })
    expect(
      vi.mocked(browser.storage.local.set).mock.invocationCallOrder[0],
    ).toBeLessThan(
      vi.mocked(browser.runtime.sendMessage).mock.invocationCallOrder[0],
    )
  })

  it('preserves current values and reports context when storage reading fails', async () => {
    const currentValues = {
      ...DEFAULT_SETTINGS,
      openSessionTreeOnStartup: true,
    }
    Object.assign(Settings.values, currentValues)
    vi.mocked(browser.storage.local.get).mockRejectedValue(
      new Error('storage unavailable'),
    )
    const { loadSettingsFromStorage } =
      await import('@/services/settings-actions')

    await expect(loadSettingsFromStorage()).rejects.toThrow(
      'Failed to read settings from storage',
    )
    expect(Settings.values).toEqual(currentValues)
  })

  it('rolls back local edits and does not broadcast when storage writing fails', async () => {
    const { loadSettingsFromStorage, saveSettingsToStorage } =
      await import('@/services/settings-actions')
    vi.mocked(browser.storage.local.get).mockResolvedValue({
      settings: structuredClone(DEFAULT_SETTINGS),
    })
    await loadSettingsFromStorage()
    Settings.values.openSessionTreeOnStartup = true
    vi.mocked(browser.storage.local.set).mockRejectedValue(
      new Error('write failed'),
    )

    await expect(saveSettingsToStorage()).rejects.toThrow(
      'Failed to write settings to storage',
    )

    expect(Settings.values.openSessionTreeOnStartup).toBe(
      DEFAULT_SETTINGS.openSessionTreeOnStartup,
    )
    expect(browser.runtime.sendMessage).not.toHaveBeenCalled()
  })

  it('keeps a successful write when broadcasting the update fails', async () => {
    const { loadSettingsFromStorage, saveSettingsToStorage } =
      await import('@/services/settings-actions')
    vi.mocked(browser.storage.local.get).mockResolvedValue({
      settings: structuredClone(DEFAULT_SETTINGS),
    })
    await loadSettingsFromStorage()
    Settings.values.openSessionTreeOnStartup = true
    vi.mocked(browser.runtime.sendMessage).mockRejectedValue(
      new Error('no listeners'),
    )

    await expect(saveSettingsToStorage()).rejects.toThrow(
      'Settings were saved but the update broadcast failed',
    )

    expect(browser.storage.local.set).toHaveBeenCalledWith({
      settings: expect.objectContaining({ openSessionTreeOnStartup: true }),
    })
    expect(Settings.values.openSessionTreeOnStartup).toBe(true)
  })

  it('merges only local changes into newer settings from another context', async () => {
    const { loadSettingsFromStorage, saveSettingsToStorage } =
      await import('@/services/settings-actions')
    vi.mocked(browser.storage.local.get).mockResolvedValueOnce({
      settings: structuredClone(DEFAULT_SETTINGS),
    })
    await loadSettingsFromStorage()
    Settings.values.openSessionTreeOnStartup = true
    vi.mocked(browser.storage.local.get).mockResolvedValueOnce({
      settings: {
        ...DEFAULT_SETTINGS,
        enableDragAndDrop: false,
      },
    })

    await saveSettingsToStorage()

    expect(browser.storage.local.set).toHaveBeenCalledWith({
      settings: {
        ...DEFAULT_SETTINGS,
        openSessionTreeOnStartup: true,
        enableDragAndDrop: false,
      },
    })
    expect(Settings.values.enableDragAndDrop).toBe(false)
  })

  it('queues rapid settings broadcasts and finishes on the newest values', async () => {
    let releaseFirstCallback: () => void = () => {}
    const firstCallback = new Promise<void>((resolve) => {
      releaseFirstCallback = resolve
    })
    vi.mocked(browser.storage.local.get)
      .mockResolvedValueOnce({
        settings: {
          ...DEFAULT_SETTINGS,
          openSessionTreeOnStartup: true,
        },
      })
      .mockResolvedValueOnce({
        settings: {
          ...DEFAULT_SETTINGS,
          openSessionTreeOnStartup: false,
        },
      })
    const callbackValues: boolean[] = []
    const onSettingsUpdated = vi.fn(async () => {
      callbackValues.push(Settings.values.openSessionTreeOnStartup)
      if (callbackValues.length === 1) await firstCallback
    })
    const { setupSettingsUpdatedListener } =
      await import('@/services/settings-actions')
    setupSettingsUpdatedListener(onSettingsUpdated)

    fakeBrowser.runtime.onMessage.emit({ type: 'settingsUpdated' })
    fakeBrowser.runtime.onMessage.emit({ type: 'settingsUpdated' })
    await vi.waitFor(() => expect(onSettingsUpdated).toHaveBeenCalledTimes(1))
    expect(browser.storage.local.get).toHaveBeenCalledTimes(1)

    releaseFirstCallback()
    await vi.waitFor(() => expect(onSettingsUpdated).toHaveBeenCalledTimes(2))
    expect(callbackValues).toEqual([true, false])
    expect(Settings.values.openSessionTreeOnStartup).toBe(false)
  })

  it('turns off favicon features when website access is revoked', async () => {
    const storedSettings = {
      ...DEFAULT_SETTINGS,
      fetchMissingFaviconsOnStartup: true,
      refreshFaviconsAfterPeriodOfTime: true,
      refreshFaviconsAfterPeriodOfTimeValue: 12,
      refreshFaviconsAfterPeriodOfTimeUnit: 'hours' as const,
      faviconRefreshTiming: 'expiration-and-startup' as const,
    }
    vi.mocked(browser.storage.local.get).mockResolvedValue({
      settings: storedSettings,
    })
    const { loadSettingsFromStorage, setupFaviconPermissionRemovalListener } =
      await import('@/services/settings-actions')
    await loadSettingsFromStorage()
    setupFaviconPermissionRemovalListener()

    fakeBrowser.permissions.onRemoved.emit({ origins: ['https://*/*'] })

    await vi.waitFor(() => {
      expect(browser.storage.local.set).toHaveBeenCalled()
    })
    expect(Settings.values.fetchMissingFaviconsOnStartup).toBe(false)
    expect(Settings.values.refreshFaviconsAfterPeriodOfTime).toBe(false)
    expect(Settings.values.refreshFaviconsAfterPeriodOfTimeValue).toBe(12)
    expect(Settings.values.refreshFaviconsAfterPeriodOfTimeUnit).toBe('hours')
    expect(Settings.values.faviconRefreshTiming).toBe('expiration-and-startup')
    expect(browser.storage.local.set).toHaveBeenLastCalledWith({
      settings: {
        ...storedSettings,
        fetchMissingFaviconsOnStartup: false,
        refreshFaviconsAfterPeriodOfTime: false,
      },
    })
  })

  it('ignores removal of unrelated optional permissions', async () => {
    const { setupFaviconPermissionRemovalListener } =
      await import('@/services/settings-actions')
    setupFaviconPermissionRemovalListener()

    fakeBrowser.permissions.onRemoved.emit({ origins: ['file:///*'] })
    await Promise.resolve()

    expect(browser.storage.local.set).not.toHaveBeenCalled()
  })

  it('keeps favicon features off in open contexts when revocation cannot be persisted', async () => {
    const storedSettings = {
      ...DEFAULT_SETTINGS,
      fetchMissingFaviconsOnStartup: true,
      refreshFaviconsAfterPeriodOfTime: true,
    }
    vi.mocked(browser.storage.local.get).mockResolvedValue({
      settings: storedSettings,
    })
    vi.mocked(browser.storage.local.set).mockRejectedValue(
      new Error('write failed'),
    )
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {})
    const onPermissionRemoved = vi.fn(() => {
      expect(Settings.values.fetchMissingFaviconsOnStartup).toBe(false)
      expect(Settings.values.refreshFaviconsAfterPeriodOfTime).toBe(false)
    })
    const { loadSettingsFromStorage, setupFaviconPermissionRemovalListener } =
      await import('@/services/settings-actions')
    await loadSettingsFromStorage()
    setupFaviconPermissionRemovalListener(onPermissionRemoved)

    fakeBrowser.permissions.onRemoved.emit({ origins: ['http://*/*'] })

    await vi.waitFor(() => {
      expect(consoleError).toHaveBeenCalledWith(
        'Failed to disable favicon settings after permission removal:',
        expect.any(Error),
      )
    })
    expect(Settings.values.fetchMissingFaviconsOnStartup).toBe(false)
    expect(Settings.values.refreshFaviconsAfterPeriodOfTime).toBe(false)
    expect(onPermissionRemoved).toHaveBeenCalledOnce()
    expect(browser.runtime.sendMessage).toHaveBeenCalledWith({
      type: 'faviconPermissionsRemoved',
    })
    expect(browser.runtime.sendMessage).not.toHaveBeenCalledWith({
      type: 'settingsUpdated',
    })
  })

  it('applies favicon permission removal messages without reloading stale storage', async () => {
    Settings.values.fetchMissingFaviconsOnStartup = true
    Settings.values.refreshFaviconsAfterPeriodOfTime = true
    const onSettingsUpdated = vi.fn()
    const { setupSettingsUpdatedListener } =
      await import('@/services/settings-actions')
    setupSettingsUpdatedListener(onSettingsUpdated)

    fakeBrowser.runtime.onMessage.emit({
      type: 'faviconPermissionsRemoved',
    })

    await vi.waitFor(() => {
      expect(onSettingsUpdated).toHaveBeenCalledOnce()
    })
    expect(Settings.values.fetchMissingFaviconsOnStartup).toBe(false)
    expect(Settings.values.refreshFaviconsAfterPeriodOfTime).toBe(false)
    expect(browser.storage.local.get).not.toHaveBeenCalled()
  })

  it('applies permission removal after an older settings load finishes', async () => {
    let resolveSettingsLoad: (value: Record<string, unknown>) => void = () => {}
    vi.mocked(browser.storage.local.get).mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          resolveSettingsLoad = resolve
        }),
    )
    const callbackValues: boolean[] = []
    const onSettingsUpdated = vi.fn(() => {
      callbackValues.push(Settings.values.refreshFaviconsAfterPeriodOfTime)
    })
    const { setupSettingsUpdatedListener } =
      await import('@/services/settings-actions')
    setupSettingsUpdatedListener(onSettingsUpdated)

    fakeBrowser.runtime.onMessage.emit({ type: 'settingsUpdated' })
    await vi.waitFor(() => {
      expect(browser.storage.local.get).toHaveBeenCalledOnce()
    })
    fakeBrowser.runtime.onMessage.emit({
      type: 'faviconPermissionsRemoved',
    })
    resolveSettingsLoad({
      settings: {
        ...DEFAULT_SETTINGS,
        fetchMissingFaviconsOnStartup: true,
        refreshFaviconsAfterPeriodOfTime: true,
      },
    })

    await vi.waitFor(() => {
      expect(onSettingsUpdated).toHaveBeenCalledTimes(2)
    })
    expect(callbackValues).toEqual([true, false])
    expect(Settings.values.fetchMissingFaviconsOnStartup).toBe(false)
    expect(Settings.values.refreshFaviconsAfterPeriodOfTime).toBe(false)
  })

  it('registers a settings updated listener that reloads storage', async () => {
    vi.mocked(browser.storage.local.get).mockResolvedValue({
      settings: {
        openSessionTreeOnStartup: true,
      },
    })
    const { setupSettingsUpdatedListener } =
      await import('@/services/settings-actions')

    setupSettingsUpdatedListener()
    fakeBrowser.runtime.onMessage.emit({ type: 'settingsUpdated' })

    await vi.waitFor(() => {
      expect(Settings.values.openSessionTreeOnStartup).toBe(true)
    })
  })

  it('runs an update callback after reloading settings storage', async () => {
    vi.mocked(browser.storage.local.get).mockResolvedValue({
      settings: {
        refreshFaviconsAfterPeriodOfTime: true,
      },
    })
    const onSettingsUpdated = vi.fn(() => {
      expect(Settings.values.refreshFaviconsAfterPeriodOfTime).toBe(true)
    })
    const { setupSettingsUpdatedListener } =
      await import('@/services/settings-actions')

    setupSettingsUpdatedListener(onSettingsUpdated)
    fakeBrowser.runtime.onMessage.emit({ type: 'settingsUpdated' })

    await vi.waitFor(() => {
      expect(onSettingsUpdated).toHaveBeenCalledTimes(1)
    })
  })

  it('reports update callback failures separately from storage failures', async () => {
    vi.mocked(browser.storage.local.get).mockResolvedValue({
      settings: {
        refreshFaviconsAfterPeriodOfTime: true,
      },
    })
    const error = new Error('alarms API unavailable')
    const onSettingsUpdated = vi.fn().mockRejectedValue(error)
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {})
    const { setupSettingsUpdatedListener } =
      await import('@/services/settings-actions')

    setupSettingsUpdatedListener(onSettingsUpdated)
    fakeBrowser.runtime.onMessage.emit({ type: 'settingsUpdated' })

    await vi.waitFor(() => {
      expect(consoleError).toHaveBeenCalledWith(
        'Failed to apply settings update:',
        error,
      )
    })
    expect(consoleError).not.toHaveBeenCalledWith(
      'Failed to load settings from storage:',
      error,
    )
  })

  it('ignores unrelated runtime messages in the settings listener', async () => {
    vi.mocked(browser.storage.local.get).mockResolvedValue({
      settings: {
        openSessionTreeOnStartup: true,
      },
    })
    const { setupSettingsUpdatedListener } =
      await import('@/services/settings-actions')

    setupSettingsUpdatedListener()
    fakeBrowser.runtime.onMessage.emit({ type: 'otherMessage' })
    await Promise.resolve()

    expect(Settings.values.openSessionTreeOnStartup).toBe(
      DEFAULT_SETTINGS.openSessionTreeOnStartup,
    )
    expect(browser.storage.local.get).not.toHaveBeenCalled()
  })

  it('loads valid enum and numeric setting values', async () => {
    vi.mocked(browser.storage.local.get).mockResolvedValue({
      settings: {
        openWindowsInSameLocationUpdateInterval: 15,
        openWindowsInSameLocationUpdateIntervalUnit: 'minutes',
        includeChildrenOfSelectedItems: 'always',
        includeChildrenOfSelectedItemsWhenIndenting: 'never',
        duplicateTreeItemDescendants: 'complete-subtree',
        duplicatedItemState: 'match-original',
        reconnectFirefoxRestoredItems: false,
        allowDropOntoDescendantItems: false,
        enableCopyOnDragAndDrop: false,
        tabGroupDropBehavior: 'any-adjacent-group',
        tabGroupColorIndicator: 'left',
        containerColorIndicator: 'strong-fade',
        containerFadeSide: 'left',
        containerIconPosition: 'right',
        saveTabsWhenTabGroupDeleted: true,
        showTabTitleOnHover: false,
        showTabUrlOnHover: false,
        tabGroupInfoOnHover: 'grouped-only',
        refreshFaviconsAfterPeriodOfTimeUnit: 'hours',
        faviconRefreshTiming: 'expiration-and-startup',
      },
    })
    const { loadSettingsFromStorage } =
      await import('@/services/settings-actions')

    await loadSettingsFromStorage()

    expect(Settings.values.openWindowsInSameLocationUpdateInterval).toBe(15)
    expect(Settings.values.openWindowsInSameLocationUpdateIntervalUnit).toBe(
      'minutes',
    )
    expect(Settings.values.includeChildrenOfSelectedItems).toBe('always')
    expect(Settings.values.includeChildrenOfSelectedItemsWhenIndenting).toBe(
      'never',
    )
    expect(Settings.values.duplicateTreeItemDescendants).toBe(
      'complete-subtree',
    )
    expect(Settings.values.duplicatedItemState).toBe('match-original')
    expect(Settings.values.reconnectFirefoxRestoredItems).toBe(false)
    expect(Settings.values.allowDropOntoDescendantItems).toBe(false)
    expect(Settings.values.enableCopyOnDragAndDrop).toBe(false)
    expect(Settings.values.tabGroupDropBehavior).toBe('any-adjacent-group')
    expect(Settings.values.tabGroupColorIndicator).toBe('left')
    expect(Settings.values.containerColorIndicator).toBe('strong-fade')
    expect(Settings.values.containerFadeSide).toBe('left')
    expect(Settings.values.containerIconPosition).toBe('right')
    expect(Settings.values.saveTabsWhenTabGroupDeleted).toBe(true)
    expect(Settings.values.showTabTitleOnHover).toBe(false)
    expect(Settings.values.showTabUrlOnHover).toBe(false)
    expect(Settings.values.tabGroupInfoOnHover).toBe('grouped-only')
    expect(Settings.values.refreshFaviconsAfterPeriodOfTimeUnit).toBe('hours')
    expect(Settings.values.faviconRefreshTiming).toBe('expiration-and-startup')
  })

  it('defaults duplication to selected items saved in the tree', () => {
    expect(DEFAULT_SETTINGS.duplicateTreeItemDescendants).toBe('selected-only')
    expect(DEFAULT_SETTINGS.duplicatedItemState).toBe('saved')
  })

  it('reconnects Firefox-restored items by default', () => {
    expect(DEFAULT_SETTINGS.reconnectFirefoxRestoredItems).toBe(true)
  })

  it('loads container presentation settings', async () => {
    vi.mocked(browser.storage.local.get).mockResolvedValue({
      settings: {
        containerColorIndicator: 'strong-fade',
        containerFadeSide: 'left',
        containerIconPosition: 'right',
      },
    })
    const { loadSettingsFromStorage } =
      await import('@/services/settings-actions')

    await loadSettingsFromStorage()

    expect(Settings.values.containerColorIndicator).toBe('strong-fade')
    expect(Settings.values.containerFadeSide).toBe('left')
    expect(Settings.values.containerIconPosition).toBe('right')
  })

  it('retains new container defaults for obsolete prototype settings', async () => {
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {})
    vi.mocked(browser.storage.local.get).mockResolvedValue({
      settings: {
        containerColorIndicator: 'top',
        showContainerIcon: false,
      },
    })
    const { loadSettingsFromStorage } =
      await import('@/services/settings-actions')

    await loadSettingsFromStorage()

    expect(Settings.values.containerColorIndicator).toBe('soft-fade')
    expect(Settings.values.containerFadeSide).toBe('right')
    expect(Settings.values.containerIconPosition).toBe('left')
    expect(consoleError).toHaveBeenCalledWith(
      'Invalid settings key: showContainerIcon',
    )
  })
})
