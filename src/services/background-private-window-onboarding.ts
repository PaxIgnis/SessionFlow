import { Tree } from '@/services/background-tree'
import { isPrivateWindowAccessAllowed } from '@/services/utils'

const ONBOARDING_STORAGE_KEY = 'privateWindowOnboarding'
const ONBOARDING_POPUP = 'private-window-onboarding.html'

type OnboardingRecord = {
  status: 'pending' | 'completed'
}

type OnboardingMessage = {
  action?: string
  command?: 'continue' | 'dismiss'
}

let backgroundReady = Promise.resolve()
let completionPromise: Promise<void> | undefined

/** Registers first-run onboarding before asynchronous background startup. */
export function initializePrivateWindowOnboarding(
  ready: Promise<void> = Promise.resolve(),
): void {
  backgroundReady = ready
  completionPromise = undefined
  browser.runtime.onInstalled.addListener(onInstalled)
  browser.runtime.onMessage.addListener(onMessage)
  void restorePendingOnboarding().catch((error) => {
    console.error('Failed to restore private-window onboarding:', error)
  })
}

function onInstalled(details?: browser.runtime._OnInstalledDetails): void {
  if (details?.reason !== 'install') return

  void prepareOnboarding(true).catch((error) => {
    console.error('Failed to initialize private-window onboarding:', error)
  })
}

function onMessage(message: OnboardingMessage): Promise<void> | undefined {
  if (message.action !== 'privateWindowOnboarding') return
  if (message.command === 'continue') return completeOnboardingOnce(true)
  if (message.command === 'dismiss') return completeOnboardingOnce(false)
}

function completeOnboardingOnce(openSessionTree: boolean): Promise<void> {
  completionPromise ??= completeOnboarding(openSessionTree).catch((error) => {
    completionPromise = undefined
    throw error
  })
  return completionPromise
}

async function restorePendingOnboarding(): Promise<void> {
  const stored = await browser.storage.local.get(ONBOARDING_STORAGE_KEY)
  const record = stored[ONBOARDING_STORAGE_KEY] as OnboardingRecord | undefined
  if (record?.status === 'pending') {
    await prepareOnboarding(false)
  }
}

async function prepareOnboarding(openImmediately: boolean): Promise<void> {
  if (openImmediately) {
    await browser.storage.local.set({
      [ONBOARDING_STORAGE_KEY]: { status: 'pending' },
    })
  }

  const accessAllowed = await isPrivateWindowAccessAllowed()
  const pendingCompletion = completionPromise
  if (pendingCompletion) {
    await pendingCompletion
    return
  }

  if (accessAllowed) {
    await markOnboardingCompleted()
    return
  }

  await armOnboarding(openImmediately)
}

async function armOnboarding(openImmediately: boolean): Promise<void> {
  await browser.browserAction.setPopup({ popup: ONBOARDING_POPUP })
  if (!openImmediately) return

  try {
    await browser.browserAction.openPopup()
  } catch (error) {
    console.debug(
      'Private-window onboarding will open on the first toolbar click:',
      error,
    )
  }
}

async function completeOnboarding(openSessionTree: boolean): Promise<void> {
  await backgroundReady
  await markOnboardingCompleted()

  if (openSessionTree) {
    await Tree.openSessionTree()
  }
}

async function markOnboardingCompleted(): Promise<void> {
  await browser.storage.local.set({
    [ONBOARDING_STORAGE_KEY]: { status: 'completed' },
  })
  await browser.browserAction.setPopup({ popup: '' })
}
