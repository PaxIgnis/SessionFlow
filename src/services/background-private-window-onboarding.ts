import { Tree } from '@/services/background-tree'
import { openIntroduction } from '@/services/onboarding-client'
import { Settings } from '@/services/settings'
import { FaviconRefresh } from '@/services/favicon-refresh'
import { SessionSnapshots } from '@/services/background-session-snapshots'
import { isPrivateWindowAccessAllowed } from '@/services/utils'
import {
  ONBOARDING_STORAGE_KEY,
  ONBOARDING_VERSION,
  TREE_GUIDE_STORAGE_KEY,
  type OnboardingMessage,
  type OnboardingCompletionCommand,
  type OnboardingRecord,
} from '@/types/onboarding'

type OnboardingSettingsMessage = Exclude<
  OnboardingMessage,
  { command: OnboardingCompletionCommand }
>

let backgroundReady = Promise.resolve()
let completionPromise: Promise<void> | undefined
let settingsQueue = Promise.resolve()

/** Register before asynchronous startup so first-install events cannot be missed. */
export function initializePrivateWindowOnboarding(
  ready: Promise<void> = Promise.resolve(),
): void {
  backgroundReady = ready
  completionPromise = undefined
  settingsQueue = Promise.resolve()
  browser.runtime.onInstalled.addListener((details) => {
    if (details?.reason !== 'install') return
    void prepareIntroduction().catch((error) => {
      console.error('Failed to open introduction:', error)
    })
  })
  browser.runtime.onMessage.addListener(onMessage)
  void ready.then(resumeIntroductionAfterPrivateAccessChange).catch((error) => {
    console.error('Failed to resume introduction:', error)
  })
  // Release the previous onboarding popup. Closing the welcome tab never
  // takes over the toolbar; the introduction stays available in settings.
  void browser.browserAction.setPopup({ popup: '' }).catch(console.error)
}

/** Recover only the permission change that an unfinished introduction expected. */
export async function resumeIntroductionAfterPrivateAccessChange(): Promise<void> {
  const stored = await browser.storage.local.get(ONBOARDING_STORAGE_KEY)
  const record = stored[ONBOARDING_STORAGE_KEY] as OnboardingRecord | undefined
  const marker = record?.privateAccessResume
  if (
    record?.status !== 'pending' ||
    record.version !== ONBOARDING_VERSION ||
    record.welcomeStep !== 2 ||
    marker?.allowed !== false ||
    !Number.isFinite(marker.expiresAt) ||
    marker.expiresAt <= Date.now() ||
    !(await isPrivateWindowAccessAllowed())
  )
    return

  const url = browser.runtime.getURL('/onboarding.html')
  const tabs = await browser.tabs.query({ url: `${url}*` })
  const current = (await browser.storage.local.get(ONBOARDING_STORAGE_KEY))[
    ONBOARDING_STORAGE_KEY
  ] as OnboardingRecord | undefined
  if (
    current?.status !== 'pending' ||
    current.welcomeStep !== 2 ||
    current.privateAccessResume?.expiresAt !== marker.expiresAt
  )
    return
  const existing = tabs.find((tab) => tab.id !== undefined)
  if (existing?.id !== undefined) {
    // Strip ?replay so initialization restores the saved permission step.
    await browser.tabs.update(existing.id, { url, active: true })
    if (existing.windowId !== undefined) {
      await browser.windows
        .update(existing.windowId, { focused: true })
        .catch(console.debug)
    }
  } else {
    await openIntroduction()
  }

  // Consume only after opening succeeds, and don't overwrite newer page edits.
  const latest = (await browser.storage.local.get(ONBOARDING_STORAGE_KEY))[
    ONBOARDING_STORAGE_KEY
  ] as OnboardingRecord | undefined
  if (latest?.privateAccessResume?.expiresAt === marker.expiresAt) {
    const { privateAccessResume: _marker, ...progress } = latest
    await browser.storage.local.set({ [ONBOARDING_STORAGE_KEY]: progress })
  }
}

async function prepareIntroduction(): Promise<void> {
  try {
    await browser.storage.local.set({
      [ONBOARDING_STORAGE_KEY]: {
        status: 'pending',
        version: ONBOARDING_VERSION,
      },
    })
  } catch (error) {
    console.error('Failed to persist pending introduction:', error)
  }
  await openIntroduction()
}

function onMessage(message: OnboardingMessage): Promise<void> | undefined {
  if (message?.action !== 'onboarding') return
  if (
    !['continue', 'dismiss', 'import', 'set-retention', 'set-startup'].includes(
      message.command,
    )
  )
    return
  if (message.command === 'set-retention') {
    if (typeof message.retainPrivateWindows !== 'boolean') return
    return updateOnboardingSettings({
      action: message.action,
      command: message.command,
      retainPrivateWindows: message.retainPrivateWindows,
    })
  }
  if (message.command === 'set-startup') {
    if (typeof message.openSessionTreeOnStartup !== 'boolean') return
    return updateOnboardingSettings({
      action: message.action,
      command: message.command,
      openSessionTreeOnStartup: message.openSessionTreeOnStartup,
    })
  }

  completionPromise ??= completeIntroduction(message.command).finally(() => {
    completionPromise = undefined
  })
  return completionPromise
}

function updateOnboardingSettings(
  message: OnboardingSettingsMessage,
): Promise<void> {
  const update = settingsQueue.then(() => applyOnboardingSettings(message))
  settingsQueue = update.catch(() => undefined)
  return update
}

async function applyOnboardingSettings(
  message: OnboardingSettingsMessage,
): Promise<void> {
  await backgroundReady
  if (message.command === 'set-retention') {
    Settings.values.retainPrivateWindows = message.retainPrivateWindows
    Settings.values.includePrivateWindowsInSessionSnapshots =
      message.retainPrivateWindows
    Settings.values.cachePrivateTabFavicons = message.retainPrivateWindows
  }
  if (message.command === 'set-startup')
    Settings.values.openSessionTreeOnStartup = message.openSessionTreeOnStartup
  // Runtime messages do not loop back to their background sender. Apply
  // effects here, and allow completion even when no other view is open.
  await Settings.saveSettingsToStorage({ broadcast: false })
  if (message.command === 'set-retention') {
    await Tree.saveSessionTreeToStorage()
    await FaviconRefresh.handleSettingsUpdated()
    await SessionSnapshots.handleSettingsUpdated()
  }
  try {
    await browser.runtime.sendMessage({ type: 'settingsUpdated' })
  } catch {
    console.debug('No view to receive onboarding settings update')
  }
}

async function completeIntroduction(
  command: OnboardingCompletionCommand,
): Promise<void> {
  await backgroundReady
  await settingsQueue
  await browser.storage.local.set({
    [ONBOARDING_STORAGE_KEY]: {
      status: 'completed',
      version: ONBOARDING_VERSION,
    },
    // Clear the previous in-tree guide for users replaying the introduction.
    [TREE_GUIDE_STORAGE_KEY]: { step: -1 },
  })
  if (command === 'continue') await Tree.openSessionTree()
  if (command === 'import') {
    await browser.tabs.create({
      url: browser.runtime.getURL('/options.html#settings_storage'),
    })
  }
}
