import {
  clearNotification,
  NotificationState,
  showNotification,
  showPrivateWindowAccessRequired,
} from '@/services/notification-state'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

describe('notification state', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    clearNotification()
  })

  afterEach(() => {
    clearNotification()
    vi.useRealTimers()
  })

  it('replaces the current message and restarts automatic dismissal', () => {
    showNotification('First message', 8_000)
    vi.advanceTimersByTime(4_000)

    showNotification('Second message', 8_000)
    vi.advanceTimersByTime(7_999)

    expect(NotificationState.message).toBe('Second message')

    vi.advanceTimersByTime(1)

    expect(NotificationState.message).toBeUndefined()
  })

  it.each([
    [
      'tab',
      'Session Flow can’t open this private tab because private-window access isn’t enabled in Firefox.',
    ],
    [
      'window',
      'Session Flow can’t open this private window because private-window access isn’t enabled in Firefox.',
    ],
  ] as const)(
    'shows private %s denial with enablement instructions',
    (type, denial) => {
      showPrivateWindowAccessRequired(type)

      expect(NotificationState.message).toBe(
        [
          denial,
          'To enable private-window access:',
          '1. Open Firefox Add-ons and Themes.',
          '2. Select Extensions, then Session Flow.',
          '3. Set “Run in Private Windows” to “Allow”.',
        ].join('\n'),
      )
    },
  )
})
