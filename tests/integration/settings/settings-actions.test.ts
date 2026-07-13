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
    vi.mocked(browser.storage.local.get).mockResolvedValue({})
    const { loadSettingsFromStorage } =
      await import('@/services/settings-actions')

    await loadSettingsFromStorage()

    expect(Settings.values).toEqual(expect.objectContaining(DEFAULT_SETTINGS))
    expect(Settings.values.allowDropOntoDescendantItems).toBe(true)
  })

  it('saves settings and broadcasts the update message', async () => {
    Settings.values.openSessionTreeOnStartup = true
    const { saveSettingsToStorage } =
      await import('@/services/settings-actions')

    await saveSettingsToStorage()

    expect(browser.runtime.sendMessage).toHaveBeenCalledWith({
      type: 'settingsUpdated',
    })
    expect(browser.storage.local.set).toHaveBeenCalledWith({
      settings: expect.objectContaining({
        openSessionTreeOnStartup: true,
      }),
    })
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
    await Promise.resolve()

    expect(Settings.values.openSessionTreeOnStartup).toBe(true)
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
        allowDropOntoDescendantItems: false,
        enableCopyOnDragAndDrop: false,
        tabGroupDropBehavior: 'any-adjacent-group',
        tabGroupColorIndicator: 'left',
        saveTabsWhenTabGroupDeleted: true,
        showTabTitleOnHover: false,
        showTabUrlOnHover: false,
        tabGroupInfoOnHover: 'grouped-only',
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
    expect(Settings.values.allowDropOntoDescendantItems).toBe(false)
    expect(Settings.values.enableCopyOnDragAndDrop).toBe(false)
    expect(Settings.values.tabGroupDropBehavior).toBe('any-adjacent-group')
    expect(Settings.values.tabGroupColorIndicator).toBe('left')
    expect(Settings.values.saveTabsWhenTabGroupDeleted).toBe(true)
    expect(Settings.values.showTabTitleOnHover).toBe(false)
    expect(Settings.values.showTabUrlOnHover).toBe(false)
    expect(Settings.values.tabGroupInfoOnHover).toBe('grouped-only')
  })
})
