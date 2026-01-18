import { Settings as SettingsValues } from '@/services/settings'
import { Settings, SETTINGS_TYPES } from '@/types/settings'

/**
 * Loads the settings from the browser storage and adds them to the global Settings object.
 *
 * @returns a Promise that resolves when the settings have been loaded
 */
export async function loadSettingsFromStorage(): Promise<void> {
  const settingsFromStorage = await browser.storage.local.get('settings')
  if (!settingsFromStorage.settings) {
    console.debug('No settings found in storage')
    return
  }
  for (const key in settingsFromStorage.settings) {
    // if the key is not one of the defined keys, skip it
    if (!(key in SettingsValues.values)) {
      console.error(`Invalid settings key: ${key}`)
      continue
    }
    // if the key is one of the defined keys, validate and add it to the global Settings object
    try {
      validateAndAddSettingKey(
        key as keyof Settings,
        settingsFromStorage.settings[key],
      )
    } catch (error) {
      console.error(`Error validating settings ${key}:`, error)
      continue
    }
  }
}

/**
 * Saves the settings from the global Settings object to the browser storage.
 * And send out a message that settings in local storage have been updated.
 *
 * @returns a Promise that resolves when the settings have been saved
 */
export async function saveSettingsToStorage(): Promise<void> {
  browser.runtime.sendMessage({
    type: 'settingsUpdated',
  })
  await browser.storage.local.set({ settings: toRaw(SettingsValues.values) })
}

/**
 * Validates that a setting key and value pair is valid.
 * If it is valid, it is added to the global Settings object,
 * otherwise an error is thrown.
 *
 * @param key - the key of the setting
 * @param value - the value of the setting
 */
function validateAndAddSettingKey<K extends keyof Settings>(
  key: K,
  value: unknown,
): void {
  // first check if the value of the key is a valid value for one of the keys
  // with a custom type from SETTINGS_TYPES
  if (key in SETTINGS_TYPES) {
    const allowedValues = SETTINGS_TYPES[key as keyof typeof SETTINGS_TYPES]
    if (!allowedValues.includes(value as (typeof allowedValues)[number])) {
      throw new Error(
        `Invalid value for ${String(key)}: ${String(
          value,
        )}. Expected one of: ${allowedValues.join(', ')}`,
      )
    } else {
      SettingsValues.values[key] = value as Settings[K]
    }
    // if the key has common type (string, number, boolean), check if the value is of the correct type
  } else {
    const expectedType = typeof SettingsValues.values[key as keyof Settings]
    if (typeof value !== expectedType) {
      throw new Error(
        `Invalid type for ${String(
          key,
        )}: expected ${expectedType}, got ${typeof value}`,
      )
    } else {
      SettingsValues.values[key] = value as Settings[K]
    }
  }
}

export function setupSettingsUpdatedListener(): void {
  // receives the settings updated message
  browser.runtime.onMessage.addListener((message) => {
    if (message.type === 'settingsUpdated') {
      // update the settings in the global Settings object
      loadSettingsFromStorage().catch((error) => {
        console.error('Failed to load settings from storage:', error)
      })
    }
  })
}
