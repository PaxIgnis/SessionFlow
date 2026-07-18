import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

describe('Firefox session restoration settings UI', () => {
  it('exposes the restored-item reconnection control in General settings', () => {
    const source = readFileSync(
      new URL(
        '../../../src/entrypoints/options/components/settings.general.vue',
        import.meta.url,
      ),
      'utf8',
    )

    expect(source).toContain(
      'label="Reconnect Firefox-Restored Tabs and Windows"',
    )
    expect(source).toContain(
      'v-model="Settings.values.reconnectFirefoxRestoredItems"',
    )
    expect(source).toContain(':options="OPTIONS.boolean"')
  })
})
