import * as SettingsOperations from '@/services/settings.storage.operations'
import { DEFAULT_SETTINGS } from '@/defaults/settings'
import { reactive } from 'vue'

export const Settings = {
  values: reactive(DEFAULT_SETTINGS),
  ...SettingsOperations,
}

// export const Settings = settings
