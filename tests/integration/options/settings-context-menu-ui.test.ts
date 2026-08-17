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
    expect(componentSource).toContain('DescendantScopeMatrix')
    const matrixSource = await fs.readFile(
      path.resolve(
        repositoryRoot,
        'src/entrypoints/options/components/DescendantScopeMatrix.vue',
      ),
      'utf8',
    )
    for (const label of [
      'Delete',
      'Duplicate',
      'Open saved tabs',
      'Reload tabs',
      'Save tabs',
      'Pin and unpin',
      'Change indent',
    ]) {
      expect(matrixSource).toContain(`label: '${label}'`)
    }
    expect(matrixSource).toContain('type="radio"')
    expect(matrixSource).toContain(':name="`descendant-scope-${row.key}`"')
    expect(matrixSource).toContain('Settings.saveSettingsToStorage()')
    for (const setting of [
      'contextMenuDeleteDescendants',
      'duplicateTreeItemDescendants',
      'contextMenuOpenDescendants',
      'contextMenuReloadDescendants',
      'contextMenuSaveDescendants',
      'contextMenuPinDescendants',
      'includeChildrenOfSelectedItemsWhenIndenting',
    ]) {
      expect(matrixSource).toContain(`Settings.values.${setting}`)
    }
    expect(matrixSource).toContain('OPTIONS.duplicateTreeItemDescendants')
    expect(matrixSource).toContain("'complete-subtree'")
    expect(matrixSource).toContain("'selected-only'")
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
