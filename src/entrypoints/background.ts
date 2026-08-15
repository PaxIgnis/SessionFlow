import * as Actions from '@/services/background-actions'
import { DeferredEventsQueue } from '@/services/background-deferred-events-queue'
import * as BackgroundHandlers from '@/services/background-handlers'
import { initializePrivateWindowOnboarding } from '@/services/background-private-window-onboarding'
import { Tree } from '@/services/background-tree'
import { FaviconRefresh } from '@/services/favicon-refresh'
import { Settings } from '@/services/settings'
import { stampOpenTreeIdentities } from '@/services/background-session-restore'
import { SessionSnapshots } from '@/services/background-session-snapshots'

export default defineBackground(() => {
  console.log('Hello, SessionFlow Background has Started!', {
    id: browser.runtime.id,
  })

  DeferredEventsQueue.initializeDeferredEventsQueue()
  Actions.setupBrowserActionMenu()
  let startBackground: () => void = () => undefined
  const backgroundReady = new Promise<void>((resolve, reject) => {
    startBackground = () => {
      void initializeBackground().then(resolve, reject)
    }
  })
  initializePrivateWindowOnboarding(backgroundReady)
  Actions.updateBadgeOnStartup()
  startBackground()
  void backgroundReady.catch((error) => {
    console.error('Failed to initialize SessionFlow background', error)
  })
})

async function initializeBackground(): Promise<void> {
  BackgroundHandlers.initializeContainerListeners()
  await Actions.initializeSettings()
  try {
    await SessionSnapshots.initialize()
    if (Settings.values.automaticSessionSnapshots) {
      await SessionSnapshots.capturePersistedStartupTree()
    }
  } catch (error) {
    console.error('Failed to initialize session snapshots:', error)
  }
  await Tree.initializeContainers()
  await Tree.initializeWindows()
  if (Tree.initialized) SessionSnapshots.markTreeInitialized()
  await stampOpenTreeIdentities()

  BackgroundHandlers.initializeListeners()
  Actions.scheduleSessionTreeOpenOnStartup()
  Settings.setupSettingsUpdatedListener(async () => {
    try {
      await FaviconRefresh.handleSettingsUpdated()
    } catch (error) {
      console.error('Failed to update favicon refresh settings:', error)
    }
    try {
      await SessionSnapshots.handleSettingsUpdated()
    } catch (error) {
      console.error('Failed to update session snapshot settings:', error)
    }
  })
  Settings.setupFaviconPermissionRemovalListener(
    FaviconRefresh.handleSettingsUpdated,
  )

  Actions.startSessionTreePersistence()

  await FaviconRefresh.initialize()
}
