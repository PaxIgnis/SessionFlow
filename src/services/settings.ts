import { DEFAULT_SETTINGS } from '@/defaults/settings'
import * as Actions from '@/services/settings-actions'
import { reactive } from 'vue'

export const Settings = {
  values: reactive(DEFAULT_SETTINGS),

  ...Actions,
}
