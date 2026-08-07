import { describe, expect, it, vi } from 'vitest'
import { isReactive, reactive } from 'vue'
import { SessionSnapshotClient } from '@/services/session-snapshot-client'
import { installFakeBrowser } from '../../helpers/fake-browser'

describe('session snapshot client', () => {
  it('copies reactive selected UIDs into structured-cloneable restore messages', async () => {
    const fakeBrowser = installFakeBrowser()
    const selectedUids = reactive(['tab-1' as UID])
    fakeBrowser.runtime.sendMessage.mockResolvedValue({
      ok: true,
      data: { windows: 1, tabs: 1, notes: 0, separators: 0 },
    })

    await SessionSnapshotClient.restoreSummary({
      snapshotId: 'snapshot-1',
      mode: 'selected',
      selectedUids,
    })
    await SessionSnapshotClient.restore({
      snapshotId: 'snapshot-1',
      mode: 'selected',
      selectedUids,
      allowWithoutSafetySnapshot: false,
    })

    expect(isReactive(selectedUids)).toBe(true)
    for (const [message] of vi.mocked(browser.runtime.sendMessage).mock.calls) {
      const selected = (message as unknown as { selectedUids: UID[] })
        .selectedUids
      expect(selected).toEqual(['tab-1'])
      expect(isReactive(selected)).toBe(false)
      expect(() => structuredClone(message)).not.toThrow()
    }
  })
})
