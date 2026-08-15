import { DEFAULT_SETTINGS } from '@/defaults/settings'
import { Settings as SettingsValues } from '@/services/settings'
import { Settings, SETTINGS_TYPES } from '@/types/settings'

export interface SettingsSectionPosition {
  id: string
  offsetTop: number
}

const NUMERIC_SETTING_BOUNDS: Partial<
  Record<keyof Settings, { min: number; max: number }>
> = {
  openWindowsInSameLocationUpdateInterval: { min: 1, max: 3600 },
  refreshFaviconsAfterPeriodOfTimeValue: { min: 1, max: 999 },
}
const FAVICON_PERMISSION_ORIGINS = new Set(['http://*/*', 'https://*/*'])
const FAVICON_PERMISSION_REMOVED_MESSAGE = 'faviconPermissionsRemoved'
const permissionListenerApis = new WeakSet<object>()

type InvalidSettingReporter = (key: string, error: Error) => void

let lastSynchronizedSettings = structuredClone(DEFAULT_SETTINGS)
let settingsUpdateQueue = Promise.resolve()

function validateSettingValue<K extends keyof Settings>(
  key: K,
  value: unknown,
): Settings[K] {
  if (key in SETTINGS_TYPES) {
    const allowedValues: readonly string[] =
      SETTINGS_TYPES[key as keyof typeof SETTINGS_TYPES]
    if (typeof value !== 'string' || !allowedValues.includes(value)) {
      throw new Error(
        `Invalid value for ${String(key)}: ${String(
          value,
        )}. Expected one of: ${allowedValues.join(', ')}`,
      )
    }
    return value as Settings[K]
  }

  const defaultValue = DEFAULT_SETTINGS[key]
  if (typeof value !== typeof defaultValue) {
    throw new Error(
      `Invalid type for ${String(key)}: expected ${typeof defaultValue}, got ${typeof value}`,
    )
  }

  if (typeof defaultValue === 'number') {
    if (typeof value !== 'number' || !Number.isFinite(value)) {
      throw new Error(
        `Invalid finite number for ${String(key)}: ${String(value)}`,
      )
    }
    const bounds = NUMERIC_SETTING_BOUNDS[key]
    if (bounds) {
      return Math.min(Math.max(value, bounds.min), bounds.max) as Settings[K]
    }
  }

  return value as Settings[K]
}

export function normalizeSettings(
  value: unknown,
  reportInvalid?: InvalidSettingReporter,
): Settings {
  const normalized = structuredClone(DEFAULT_SETTINGS)
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    return normalized
  }

  for (const [key, candidate] of Object.entries(value)) {
    if (!(key in DEFAULT_SETTINGS)) {
      reportInvalid?.(key, new Error(`Invalid settings key: ${key}`))
      continue
    }
    try {
      const typedKey = key as keyof Settings
      normalized[typedKey] = validateSettingValue(typedKey, candidate) as never
    } catch (error) {
      reportInvalid?.(
        key,
        error instanceof Error ? error : new Error(String(error)),
      )
    }
  }
  normalized.sessionSnapshotInterval = Math.min(
    Math.max(
      normalized.sessionSnapshotInterval,
      normalized.sessionSnapshotIntervalUnit === 'hours' ? 1 : 5,
    ),
    normalized.sessionSnapshotIntervalUnit === 'hours' ? 24 : 1440,
  )
  return normalized
}

function replaceSettingsValues(settings: Settings): void {
  Object.assign(SettingsValues.values, settings)
}

function disableFaviconPermissionSettings(): void {
  SettingsValues.values.fetchMissingFaviconsOnStartup = false
  SettingsValues.values.refreshFaviconsAfterPeriodOfTime = false
}

function contextualError(message: string, error: unknown): Error {
  return new Error(`${message}: ${String(error)}`)
}

function settingsPatch(
  current: Settings,
  baseline: Settings,
): Partial<Settings> {
  const patch: Partial<Settings> = {}
  for (const key of Object.keys(DEFAULT_SETTINGS) as Array<keyof Settings>) {
    if (!Object.is(current[key], baseline[key])) {
      ;(patch as Record<keyof Settings, Settings[keyof Settings]>)[key] =
        current[key]
    }
  }
  return patch
}

/**
 * Loads the settings from the browser storage and adds them to the global Settings object.
 *
 * @returns a Promise that resolves when the settings have been loaded
 */
export async function loadSettingsFromStorage(): Promise<void> {
  let settingsFromStorage: Record<string, unknown>
  try {
    settingsFromStorage = await browser.storage.local.get('settings')
  } catch (error) {
    throw contextualError('Failed to read settings from storage', error)
  }
  const normalized = normalizeSettings(
    settingsFromStorage.settings,
    (key, error) => {
      if (!(key in DEFAULT_SETTINGS)) {
        console.error(`Invalid settings key: ${key}`)
      } else {
        console.error(`Error validating settings ${key}:`, error)
      }
    },
  )
  replaceSettingsValues(normalized)
  lastSynchronizedSettings = structuredClone(normalized)
}

/**
 * Saves the settings from the global Settings object to the browser storage.
 * And send out a message that settings in local storage have been updated.
 *
 * @returns a Promise that resolves when the settings have been saved
 */
export async function saveSettingsToStorage(): Promise<void> {
  const previous = structuredClone(lastSynchronizedSettings)
  const current = normalizeSettings(toRaw(SettingsValues.values))
  const patch = settingsPatch(current, previous)

  let stored: Record<string, unknown>
  try {
    stored = await browser.storage.local.get('settings')
  } catch (error) {
    replaceSettingsValues(previous)
    throw contextualError('Failed to read latest settings before saving', error)
  }
  const latest = normalizeSettings(stored.settings)
  const merged = normalizeSettings({ ...latest, ...patch })

  try {
    await browser.storage.local.set({ settings: merged })
  } catch (error) {
    replaceSettingsValues(previous)
    throw contextualError('Failed to write settings to storage', error)
  }

  replaceSettingsValues(merged)
  lastSynchronizedSettings = structuredClone(merged)
  try {
    await browser.runtime.sendMessage({ type: 'settingsUpdated' })
  } catch (error) {
    throw contextualError(
      'Settings were saved but the update broadcast failed',
      error,
    )
  }
}

export function setupSettingsUpdatedListener(
  onSettingsUpdated?: () => void | Promise<void>,
): void {
  // receives the settings updated message
  browser.runtime.onMessage.addListener((message) => {
    if (
      message.type !== 'settingsUpdated' &&
      message.type !== FAVICON_PERMISSION_REMOVED_MESSAGE
    ) {
      return
    }

    settingsUpdateQueue = settingsUpdateQueue.then(async () => {
      if (message.type === 'settingsUpdated') {
        try {
          await loadSettingsFromStorage()
        } catch (error) {
          console.error('Failed to load settings from storage:', error)
          return
        }
      } else {
        disableFaviconPermissionSettings()
      }

      try {
        await onSettingsUpdated?.()
      } catch (error) {
        console.error('Failed to apply settings update:', error)
      }
    })
  })
}

export function setupFaviconPermissionRemovalListener(
  onPermissionRemoved?: () => void | Promise<void>,
): void {
  const permissions = browser.permissions as typeof browser.permissions & {
    onRemoved?: {
      addListener: (listener: (removed: { origins?: string[] }) => void) => void
    }
  }
  if (!permissions.onRemoved || permissionListenerApis.has(permissions)) return
  permissionListenerApis.add(permissions)

  permissions.onRemoved.addListener((removed) => {
    if (
      !removed.origins?.some((origin) => FAVICON_PERMISSION_ORIGINS.has(origin))
    ) {
      return
    }
    settingsUpdateQueue = settingsUpdateQueue.then(async () => {
      disableFaviconPermissionSettings()
      void browser.runtime
        .sendMessage({ type: FAVICON_PERMISSION_REMOVED_MESSAGE })
        .catch((error) => {
          console.error(
            'Failed to broadcast favicon permission removal:',
            error,
          )
        })
      try {
        await saveSettingsToStorage()
      } catch (error) {
        disableFaviconPermissionSettings()
        console.error(
          'Failed to disable favicon settings after permission removal:',
          error,
        )
      }

      try {
        await onPermissionRemoved?.()
      } catch (error) {
        console.error('Failed to apply favicon permission removal:', error)
      }
    })
  })
}

export function normalizeBoundedNumberInput(
  rawValue: string,
  min?: number,
  max?: number,
): number | undefined {
  const normalizedText = rawValue.trim()
  if (
    normalizedText === '' ||
    !/^-?(?:\d+(?:\.\d*)?|\.\d+)$/.test(normalizedText)
  ) {
    return undefined
  }
  const value = Number(normalizedText)
  if (!Number.isFinite(value)) return undefined
  if (min !== undefined && value < min) return min
  if (max !== undefined && value > max) return max
  return value
}

export function findActiveSettingsSection(
  sections: SettingsSectionPosition[],
  scrollTop: number,
  scrollHeight?: number,
  clientHeight?: number,
): string | undefined {
  if (
    scrollHeight !== undefined &&
    clientHeight !== undefined &&
    scrollHeight > clientHeight + 1 &&
    scrollTop + clientHeight >= scrollHeight - 1
  ) {
    return sections.at(-1)?.id
  }

  let active = sections[0]?.id
  for (const section of sections) {
    if (section.offsetTop > scrollTop) break
    active = section.id
  }
  return active
}
