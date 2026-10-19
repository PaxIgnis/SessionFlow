import { describe, expect, it } from 'vitest'
import { createSSRApp } from 'vue'
import { renderToString } from 'vue/server-renderer'
import SnapshotConfirmationModal from '@/entrypoints/options/components/SnapshotConfirmationModal.vue'

describe('session snapshot Storage UI', () => {
  it('renders snapshot errors as an accessible dialog with a single action', async () => {
    const markup = await renderToString(
      createSSRApp(SnapshotConfirmationModal, {
        kind: 'error',
        title: 'Snapshot Failed',
        message: 'The snapshot could not be restored.',
      }),
    )

    expect(markup).toContain('role="dialog"')
    expect(markup).toContain('Snapshot Failed')
    expect(markup).toContain('The snapshot could not be restored.')
    expect(markup).toContain('aria-modal="true"')
    expect(markup.match(/<button\b/g)).toHaveLength(1)
  })
})
