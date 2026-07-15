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
      `Session Flow can’t open this private ${itemType} because private-window access isn’t enabled in Firefox.`,
      'To enable private-window access:',
      '1. Open Firefox Add-ons and Themes.',
      '2. Select Extensions, then Session Flow.',
      '3. Set “Run in Private Windows” to “Allow”.',
    ].join('\n'),
  )
}
