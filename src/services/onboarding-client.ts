import type {
  OnboardingCompletionCommand,
  OnboardingMessage,
} from '@/types/onboarding'

export function openIntroduction(
  replay = false,
  startAt: 'welcome' | 'tips' = 'welcome',
): Promise<browser.tabs.Tab> {
  const query = [replay ? 'replay' : '', startAt === 'tips' ? 'step=tips' : '']
    .filter(Boolean)
    .join('&')
  return browser.tabs.create({
    url: browser.runtime.getURL(`/onboarding.html${query ? `?${query}` : ''}`),
  })
}

/**
 * Opens the session tree in a normal tab, where Firefox offers
 * "Add tab to taskbar" to turn it into a Web App (#73).
 */
export function openSessionTreeInTab(): Promise<browser.tabs.Tab> {
  return browser.tabs.create({
    url: browser.runtime.getURL('/sessiontree.html'),
  })
}

export function completeIntroduction(
  command: OnboardingCompletionCommand,
): Promise<void> {
  return browser.runtime.sendMessage({
    action: 'onboarding',
    command,
  } satisfies OnboardingMessage)
}

export function saveOnboardingRetention(
  retainPrivateWindows: boolean,
): Promise<void> {
  return browser.runtime.sendMessage({
    action: 'onboarding',
    command: 'set-retention',
    retainPrivateWindows,
  } satisfies OnboardingMessage)
}

export function saveOnboardingStartup(
  openSessionTreeOnStartup: boolean,
): Promise<void> {
  return browser.runtime.sendMessage({
    action: 'onboarding',
    command: 'set-startup',
    openSessionTreeOnStartup,
  } satisfies OnboardingMessage)
}
