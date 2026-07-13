import * as Actions from '@/services/background-actions'
import { DeferredEventsQueue } from '@/services/background-deferred-events-queue'
import * as BackgroundHandlers from '@/services/background-handlers'
import { Tree } from '@/services/background-tree'
import { FaviconRefresh } from '@/services/favicon-refresh'
import { Settings } from '@/services/settings'

const SAVE_SESSION_TREE_INTERVAL_MS = 60 * 1000 // 1 minute

export default defineBackground(() => {
  console.log('Hello, SessionFlow Background has Started!', {
    id: browser.runtime.id,
  })

  DeferredEventsQueue.initializeDeferredEventsQueue()
  Actions.setupBrowserActionMenu()
  Actions.updateBadgeOnStartup()
  void initializeBackground().catch((error) => {
    console.error('Failed to initialize SessionFlow background', error)
  })
})

async function initializeBackground(): Promise<void> {
  await Actions.initializeSettings()
  await Tree.initializeWindows()

  BackgroundHandlers.initializeListeners()
  Settings.setupSettingsUpdatedListener(FaviconRefresh.handleSettingsUpdated)

  setInterval(() => {
    void Tree.saveSessionTreeToStorage()
  }, SAVE_SESSION_TREE_INTERVAL_MS)

  await FaviconRefresh.initialize()
}
