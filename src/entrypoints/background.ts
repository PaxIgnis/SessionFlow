import * as Actions from '@/services/background-actions'
import { initializeListeners } from '@/services/background-handlers'
import { Tree } from '@/services/background-tree'
import { deferredEventsQueue } from '@/services/deferred.events.queue'

export default defineBackground(() => {
  console.log('Hello, SessionFlow Background has Started!', {
    id: browser.runtime.id,
  })

  Actions.initializeSettings()
  deferredEventsQueue.initializeDeferredEventsQueue()
  initializeListeners()
  console.log('BackgroundTree: ', Tree)
  Tree.initializeWindows()
})
