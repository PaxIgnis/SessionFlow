import * as Actions from '@/services/background-actions'
import { DeferredEventsQueue } from '@/services/background-deferred-events-queue'
import { initializeListeners } from '@/services/background-handlers'
import { Tree } from '@/services/background-tree'

export default defineBackground(() => {
  console.log('Hello, SessionFlow Background has Started!', {
    id: browser.runtime.id,
  })

  Actions.initializeSettings()
  DeferredEventsQueue.initializeDeferredEventsQueue()
  initializeListeners()
  console.log('BackgroundTree: ', Tree)
  Tree.initializeWindows()
})
