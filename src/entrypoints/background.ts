import * as Actions from '@/services/background-actions'
import { DeferredEventsQueue } from '@/services/background-deferred-events-queue'
import * as BackgroundHandlers from '@/services/background-handlers'
import { Tree } from '@/services/background-tree'
import { Settings } from '@/services/settings'

const SAVE_SESSION_TREE_INTERVAL_MS = 60 * 1000 // 1 minute

export default defineBackground(() => {
  console.log('Hello, SessionFlow Background has Started!', {
    id: browser.runtime.id,
  })

  Actions.initializeSettings()
  Tree.initializeWindows().then(() => {
    BackgroundHandlers.initializeListeners()

    setInterval(() => {
      void Tree.saveSessionTreeToStorage()
    }, SAVE_SESSION_TREE_INTERVAL_MS)
  })
  DeferredEventsQueue.initializeDeferredEventsQueue()
  Settings.setupSettingsUpdatedListener()
  Actions.setupBrowserActionMenu()
  Actions.updateBadgeOnStartup()
})
