import { readFileSync } from 'node:fs'
import { OPTIONS } from '@/types/settings'
import { describe, expect, it } from 'vitest'

describe('duplication settings UI', () => {
  it('exposes duplication state below the scope matrix under Context Menu', () => {
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

    expect(contextMenuSource).toContain('DescendantScopeMatrix')
    const matrixSource = readFileSync(
      new URL(
        '../../../src/entrypoints/options/components/DescendantScopeMatrix.vue',
        import.meta.url,
      ),
      'utf8',
    )
    expect(matrixSource).toContain("label: i18n.t('duplicate')")
    expect(matrixSource).toContain(
      'Settings.values.duplicateTreeItemDescendants',
    )
    expect(matrixSource).toContain('OPTIONS.duplicateTreeItemDescendants')
    expect(contextMenuSource).toContain(
      ':label="i18n.t(\'stateOfDuplicatedItems\')"',
    )
    expect(contextMenuSource).toContain(
      'v-model="Settings.values.duplicatedItemState"',
    )
    expect(contextMenuSource).toContain(
      ':options="OPTIONS.duplicatedItemState"',
    )
    expect(generalSource).not.toContain('Settings.values.duplicatedItemState')
    expect(contextMenuSource.indexOf('stateOfDuplicatedItems')).toBeGreaterThan(
      contextMenuSource.indexOf('<DescendantScopeMatrix />'),
    )
  })

  it('uses the shared descendant labels and order without changing values', () => {
    expect(OPTIONS.duplicateTreeItemDescendants).toEqual([
      { label: 'Always', value: 'complete-subtree' },
      { label: 'Only if Collapsed', value: 'collapsed' },
      { label: 'Never', value: 'selected-only' },
    ])
  })
})
