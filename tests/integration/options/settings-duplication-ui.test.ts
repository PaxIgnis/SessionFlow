import { readFileSync } from 'node:fs'
import { OPTIONS } from '@/types/settings'
import { describe, expect, it } from 'vitest'

describe('duplication settings UI', () => {
  it('exposes duplication scope under Context Menu and state under General', () => {
    const generalSource = readFileSync(
      new URL(
        '../../../src/entrypoints/options/components/settings.general.vue',
        import.meta.url,
      ),
      'utf8',
    )
    const contextMenuSource = readFileSync(
      new URL(
        '../../../src/entrypoints/options/components/settings.context-menu.vue',
        import.meta.url,
      ),
      'utf8',
    )

    expect(contextMenuSource).toContain('label="When Duplicating"')
    expect(contextMenuSource).toContain(
      'v-model="Settings.values.duplicateTreeItemDescendants"',
    )
    expect(contextMenuSource).toContain(
      ':options="OPTIONS.duplicateTreeItemDescendants"',
    )
    expect(generalSource).toContain('label="Duplicated Item State"')
    expect(generalSource).toContain(
      'v-model="Settings.values.duplicatedItemState"',
    )
    expect(generalSource).toContain(':options="OPTIONS.duplicatedItemState"')
  })

  it('uses the shared descendant labels and order without changing values', () => {
    expect(OPTIONS.duplicateTreeItemDescendants).toEqual([
      { label: 'Always', value: 'complete-subtree' },
      { label: 'Only if Collapsed', value: 'collapsed' },
      { label: 'Never', value: 'selected-only' },
    ])
  })
})
