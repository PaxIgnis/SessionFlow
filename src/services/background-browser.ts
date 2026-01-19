import * as Actions from '@/services/background-browser-actions'
import * as TabActions from '@/services/background-browser-tab-actions'
import * as WindowActions from '@/services/background-browser-window-actions'

export const Browser = {
  ...Actions,
  ...TabActions,
  ...WindowActions,
}
