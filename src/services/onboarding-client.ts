import type {
  OnboardingCompletionCommand,
  OnboardingMessage,
} from '@/types/onboarding'

export function openIntroduction(replay = false): Promise<browser.tabs.Tab> {
  return browser.tabs.create({
    url: browser.runtime.getURL(`/onboarding.html${replay ? '?replay' : ''}`),
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
