import { i18n } from '@/services/i18n'
import { reactive } from 'vue'

type PrivateItemType = 'tab' | 'window'

export const NotificationState = reactive<{ message?: string }>({})

let dismissTimer: ReturnType<typeof setTimeout> | undefined

export function showNotification(message: string, durationMs = 8_000): void {
  if (dismissTimer !== undefined) clearTimeout(dismissTimer)
  NotificationState.message = message
  dismissTimer = setTimeout(() => {
    NotificationState.message = undefined
    dismissTimer = undefined
  }, durationMs)
}

export function clearNotification(): void {
  if (dismissTimer !== undefined) clearTimeout(dismissTimer)
  dismissTimer = undefined
  NotificationState.message = undefined
}

export function showPrivateWindowAccessRequired(
  itemType: PrivateItemType,
): void {
  showNotification(
    [
      i18n.t(
        itemType === 'tab'
          ? 'privateTabAccessRequired'
          : 'privateWindowAccessRequired',
      ),
      i18n.t('toEnablePrivatewindowAccess'),
      i18n.t('1OpenFirefoxAddonsAndThemes'),
      i18n.t('2SelectExtensionsThenSessionFlow'),
      i18n.t('3SetRunInPrivateWindowsToAllow'),
    ].join('\n'),
  )
}
