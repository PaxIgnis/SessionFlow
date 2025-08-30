import * as Actions from '@/services/background-actions'
import { DeferredEventsQueue } from '@/services/background-deferred-events-queue'
import * as BackgroundHandlers from '@/services/background-handlers'
import { Tree } from '@/services/background-tree'
import { Settings } from '@/services/settings'

export default defineBackground(() => {
  console.log('Hello, SessionFlow Background has Started!', {
    id: browser.runtime.id,
  })

  Actions.initializeSettings()
  DeferredEventsQueue.initializeDeferredEventsQueue()
  BackgroundHandlers.initializeListeners()
  Settings.setupSettingsUpdatedListener()
  Actions.setupBrowserActionMenu()
  Tree.initializeWindows()
})
