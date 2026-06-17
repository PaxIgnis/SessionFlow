import fs from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

describe('drag-and-drop settings UI', () => {
  it('exposes the descendant-drop setting as a persisted drag-and-drop toggle', async () => {
    const componentSource = await fs.readFile(
      path.resolve(
        fileURLToPath(new URL('../../..', import.meta.url)),
        'src/entrypoints/options/components/settings.drag-and-drop.vue',
      ),
      'utf8',
    )

    const toggleMarkup = componentSource.match(
      /<ToggleButton[\s\S]*?allowDropOntoDescendantItems[\s\S]*?\/>/,
    )?.[0]

    expect(toggleMarkup).toBeDefined()
    expect(toggleMarkup).toContain(
      'label="Items Can Be Dropped onto Descendant Items"',
    )
    expect(toggleMarkup).toContain(
      'v-model="Settings.values.allowDropOntoDescendantItems"',
    )
    expect(toggleMarkup).toContain(
      ':disabled="!Settings.values.enableDragAndDrop"',
    )
    expect(toggleMarkup).toContain('@update="Settings.saveSettingsToStorage()"')
  })
})
