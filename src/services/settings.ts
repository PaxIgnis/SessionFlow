import * as SettingsOperations from './settings.storage.operations'
import { DEFAULT_SETTINGS } from '@/defaults/settings'
import { reactive } from 'vue'

const settings = {
  values: reactive(DEFAULT_SETTINGS),
  ...SettingsOperations,
}

export const Settings = settings

await settings.loadSettingsFromStorage().catch((error) => {
  console.error('Failed to load settings from storage:', error)
})
