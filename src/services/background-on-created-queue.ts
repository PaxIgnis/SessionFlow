import * as Actions from '@/services/background-on-created-queue-actions'
import { PendingItem } from '@/types/session-tree'

export const OnCreatedQueue = {
  pendingWindowCount: 0,
  pendingTabCount: 0,
  pendingWindows: new Map<number, PendingItem>(),
  pendingTabs: new Map<number, PendingItem>(),

  ...Actions,
}
