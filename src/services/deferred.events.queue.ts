import * as actions from '@/services/deferred.events.queue.actions'

export const deferredEventsQueue = {
  windows: {} as Map<number, (() => void)[]>,
  tabs: {} as Map<number, (() => void)[]>,

  ...actions,
}
