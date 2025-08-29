import * as Actions from '@/services/background-tree-actions'
import * as TabActions from '@/services/background-tree-tab-actions'
import * as WindowActions from '@/services/background-tree-window-actions'
import { Window } from '@/types/session-tree'

export const Tree = {
  sessionTreeWindowId: undefined as number | undefined,
  windowPositionInterval: undefined as NodeJS.Timeout | undefined,
  windowsList: [] as Window[],
  windowsBackupList: [] as Window[],

  ...Actions,
  ...TabActions,
  ...WindowActions,
}
