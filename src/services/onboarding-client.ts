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
