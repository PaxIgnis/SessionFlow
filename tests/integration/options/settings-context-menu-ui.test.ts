import fs from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

const repositoryRoot = path.resolve(
  fileURLToPath(new URL('../../..', import.meta.url)),
)

describe('context menu settings UI', () => {
  it('adds a dedicated Context Menu navigation section', async () => {
    const optionsSource = await fs.readFile(
      path.resolve(repositoryRoot, 'src/entrypoints/options/options.vue'),
      'utf8',
    )

    expect(optionsSource).toContain(
      "import SettingsContextMenu from './components/settings.context-menu.vue'",
    )
    expect(optionsSource).toContain("{ id: 'settings_context_menu', level: 0 }")
    expect(optionsSource).toContain('<SettingsContextMenu />')
  })

  it('exposes an independent descendant scope for each applicable action', async () => {
    const componentSource = await fs.readFile(
      path.resolve(
        repositoryRoot,
        'src/entrypoints/options/components/settings.context-menu.vue',
      ),
      'utf8',
    )

    expect(componentSource).toContain('id="settings_context_menu"')
    expect(componentSource).toContain('When Deleting')
    expect(componentSource).toContain('When Duplicating')
    expect(componentSource).toContain('When Opening Saved Tabs')
    expect(componentSource).toContain('When Reloading Tabs')
    expect(componentSource).toContain('When Saving Tabs')
    expect(componentSource).toContain('When Pinning or Unpinning Tabs')
    expect(componentSource).toContain('When Adjusting Indent')
    expect(componentSource).toContain(
      'When to Apply Actions to Unselected Descendant Items:',
    )
    expect(componentSource.match(/class="child-setting"/g)).toHaveLength(7)
    for (const setting of [
      'contextMenuDeleteDescendants',
      'duplicateTreeItemDescendants',
      'contextMenuOpenDescendants',
      'contextMenuReloadDescendants',
      'contextMenuSaveDescendants',
      'contextMenuPinDescendants',
      'includeChildrenOfSelectedItemsWhenIndenting',
    ]) {
      expect(componentSource).toContain(`Settings.values.${setting}`)
    }
  })

  it('moves duplicate and indent descendant controls out of General', async () => {
    const generalSource = await fs.readFile(
      path.resolve(
        repositoryRoot,
        'src/entrypoints/options/components/settings.general.vue',
      ),
      'utf8',
    )

    expect(generalSource).not.toContain('duplicateTreeItemDescendants')
    expect(generalSource).not.toContain(
      'includeChildrenOfSelectedItemsWhenIndenting',
    )
  })
})
