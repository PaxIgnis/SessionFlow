import fs from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

const repositoryRoot = path.resolve(
  fileURLToPath(new URL('../../..', import.meta.url)),
)

describe('container settings UI', () => {
  it('exposes independent fade treatment, side, and icon controls', async () => {
    const componentSource = await fs.readFile(
      path.resolve(
        repositoryRoot,
        'src/entrypoints/options/components/settings.containers.vue',
      ),
      'utf8',
    )

    expect(componentSource).toContain('id="settings_containers"')
    expect(componentSource).toContain(':label="i18n.t(\'colorIndicator\')"')
    expect(componentSource).toContain(
      'v-model="Settings.values.containerColorIndicator"',
    )
    expect(componentSource).toContain(
      ':options="OPTIONS.containerColorIndicator"',
    )
    expect(componentSource).toContain('class="dependents"')
    expect(componentSource).toContain(':label="i18n.t(\'fadeSide\')"')
    expect(componentSource).toContain(
      'v-model="Settings.values.containerFadeSide"',
    )
    expect(componentSource).toContain(':options="OPTIONS.containerFadeSide"')
    expect(componentSource).toContain(
      ':disabled="Settings.values.containerColorIndicator === \'off\'"',
    )
    expect(componentSource).toContain(':label="i18n.t(\'containerIcon\')"')
    expect(componentSource).toContain(
      'v-model="Settings.values.containerIconPosition"',
    )
    expect(componentSource).toContain(
      ':options="OPTIONS.containerIconPosition"',
    )
  })
})
