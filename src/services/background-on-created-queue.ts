import * as Actions from '@/services/background-on-created-queue-actions'
import { PendingItem } from '@/types/session-tree'

export const OnCreatedQueue = {
  // create() calls that have not returned their IDs yet.
  unregisteredWindowCreations: 0,
  unregisteredTabCreations: 0,
  pendingWindows: new Map<number, PendingItem>(),
  pendingTabs: new Map<number, PendingItem>(),

  ...Actions,
}
