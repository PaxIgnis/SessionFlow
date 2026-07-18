import ContainerRecoveryModal from '@/components/ContainerRecoveryModal.vue'
import { createSSRApp } from 'vue'
import { renderToString } from 'vue/server-renderer'
import { describe, expect, it } from 'vitest'
import fs from 'node:fs/promises'

const work = {
  cookieStoreId: 'firefox-container-1',
  name: 'Work',
  color: 'blue',
  colorCode: '#37adff',
  icon: 'briefcase',
}

describe('container recovery modal', () => {
  it('explains single-container recovery choices', async () => {
    const markup = await renderToString(
      createSSRApp(ContainerRecoveryModal, { containers: [work] }),
    )

    expect(markup).toContain('role="dialog"')
    expect(markup).toContain('Work')
    expect(markup).toContain(
      'cookies and signed-in sessions cannot be recovered',
    )
    expect(markup).toContain('Recreate Container and Open')
    expect(markup).toContain('Open Without Container')
    expect(markup).toContain('Cancel')
    expect(markup).toContain('/icons/usercontext.svg#briefcase')
    expect(markup).toContain('tabindex="-1"')
  })

  it('disables every action while recovery is pending', async () => {
    const markup = await renderToString(
      createSSRApp(ContainerRecoveryModal, {
        containers: [work],
        pending: true,
      }),
    )

    expect(markup.match(/disabled/g)).toHaveLength(3)
  })

  it('manages initial focus, Tab containment, Escape, and focus restoration', async () => {
    const source = await fs.readFile(
      new URL(
        '../../../src/components/ContainerRecoveryModal.vue',
        import.meta.url,
      ),
      'utf8',
    )

    expect(source).toContain('onMounted')
    expect(source).toContain('previouslyFocused')
    expect(source).toMatch(/event\.key\s*[!=]==?\s*'Tab'/)
    expect(source).toContain("event.key === 'Escape'")
    expect(source).toContain('previouslyFocused?.focus()')
  })
})
