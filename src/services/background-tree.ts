import * as Actions from '@/services/background-tree-actions'
import * as TabActions from '@/services/background-tree-tab-actions'
import * as WindowActions from '@/services/background-tree-window-actions'
import { Tab, Window } from '@/types/session-tree'

export const Tree = {
  sessionTreeWindowId: undefined as number | undefined,
  windowPositionInterval: undefined as NodeJS.Timeout | undefined,
  windowsList: [] as Window[],
  windowsBackupList: [] as Window[],
  existingUidsSet: new Set<UID>(),
  tabsByUid: new Map<UID, Tab>(),
  windowsByUid: new Map<UID, Window>(),

  ...Actions,
  ...TabActions,
  ...WindowActions,
}
