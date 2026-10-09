export const ONBOARDING_STORAGE_KEY = 'privateWindowOnboarding'
export const TREE_GUIDE_STORAGE_KEY = 'sessionTreeIntroduction'
export const ONBOARDING_VERSION = 1
export const PRIVATE_ACCESS_RESUME_TTL_MS = 30 * 60 * 1000

export type OnboardingCompletionCommand = 'continue' | 'dismiss' | 'import'

export interface OnboardingRecord {
  status: 'pending' | 'completed'
  version?: number
  welcomeStep?: number
  tip?: number
  featureId?: OnboardingFeatureId
  destination?: 'continue' | 'import'
  privateAccessResume?: { allowed: false; expiresAt: number }
}

export type OnboardingMessage =
  | { action: 'onboarding'; command: OnboardingCompletionCommand }
  | {
      action: 'onboarding'
      command: 'set-retention'
      retainPrivateWindows: boolean
    }
  | {
      action: 'onboarding'
      command: 'set-startup'
      openSessionTreeOnStartup: boolean
    }
import type { OnboardingFeatureId } from '@/defaults/onboarding'
