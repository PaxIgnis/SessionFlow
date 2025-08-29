import * as Actions from '@/services/background-deferred-events-queue-actions'

export const DeferredEventsQueue = {
  windows: {} as Map<number, (() => void)[]>,
  tabs: {} as Map<number, (() => void)[]>,

  ...Actions,
}
