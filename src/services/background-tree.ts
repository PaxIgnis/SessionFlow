import * as Actions from '@/services/background-tree-actions'
import * as NoteActions from '@/services/background-tree-note-actions'
import * as SeparatorActions from '@/services/background-tree-separator-actions'
import * as TabActions from '@/services/background-tree-tab-actions'
import * as WindowActions from '@/services/background-tree-window-actions'
import * as TreeUtils from '@/services/tree-utils'
import {
  Note,
  Separator,
  Tab,
  TopLevelTreeItem,
  Window,
} from '@/types/session-tree'

export const Tree = {
  sessionTreeWindowId: undefined as number | undefined,
  windowPositionInterval: undefined as NodeJS.Timeout | undefined,
  Items: [] as TopLevelTreeItem[],
  existingUidsSet: new Set<UID>(),
  tabsByUid: new Map<UID, Tab>(),
  notesByUid: new Map<UID, Note>(),
  separatorsByUid: new Map<UID, Separator>(),
  windowsByUid: new Map<UID, Window>(),
  initialized: false as boolean,

  ...Actions,
  ...NoteActions,
  ...SeparatorActions,
  ...TabActions,
  ...WindowActions,
  ...TreeUtils,
}
