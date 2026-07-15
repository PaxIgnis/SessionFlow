import SessionTreeNotification from '@/components/SessionTreeNotification.vue'
import {
  clearNotification,
  NotificationState,
  showPrivateWindowAccessRequired,
} from '@/services/notification-state'
import { createSSRApp } from 'vue'
import { renderToString } from 'vue/server-renderer'
import { afterEach, describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'

describe('Session Tree notification', () => {
  afterEach(() => {
    clearNotification()
  })

  it('renders the multi-line notification as an accessible alert', async () => {
    showPrivateWindowAccessRequired('tab')

    const markup = await renderToString(createSSRApp(SessionTreeNotification))

    expect(markup).toContain('class="sessiontree-notification"')
    expect(markup).toContain('role="alert"')
    expect(markup).toContain(NotificationState.message)
    expect(markup).toContain('1. Open Firefox Add-ons and Themes.')
    expect(markup).toContain('3. Set “Run in Private Windows” to “Allow”.')
  })

  it('renders nothing when there is no active notification', async () => {
    clearNotification()

    const markup = await renderToString(createSSRApp(SessionTreeNotification))

    expect(markup).not.toContain('sessiontree-notification')
    expect(markup).not.toContain('role="alert"')
  })

  it('keeps long instructions readable inside a short Session Tree window', () => {
    const source = readFileSync(
      new URL(
        '../../../src/components/SessionTreeNotification.vue',
        import.meta.url,
      ),
      'utf8',
    )

    expect(source).toContain('max-height: calc(100% - 60px)')
    expect(source).toContain('overflow-y: auto')
    expect(source).toContain('box-sizing: border-box')
  })
})
