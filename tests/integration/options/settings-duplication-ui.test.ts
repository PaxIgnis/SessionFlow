import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

describe('duplication settings UI', () => {
  it('exposes duplication scope and state controls in General settings', () => {
    const source = readFileSync(
      new URL(
        '../../../src/entrypoints/options/components/settings.general.vue',
        import.meta.url,
      ),
      'utf8',
    )

    expect(source).toContain('label="When Duplicating Tabs or Notes"')
    expect(source).toContain(
      'v-model="Settings.values.duplicateTreeItemDescendants"',
    )
    expect(source).toContain(':options="OPTIONS.duplicateTreeItemDescendants"')
    expect(source).toContain('label="Duplicated Item State"')
    expect(source).toContain('v-model="Settings.values.duplicatedItemState"')
    expect(source).toContain(':options="OPTIONS.duplicatedItemState"')
  })
})
