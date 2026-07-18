import fs from 'node:fs/promises'
import path from 'node:path'
import { OPTIONS, SETTINGS_TYPES } from '@/types/settings'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

const repositoryRoot = path.resolve(
  fileURLToPath(new URL('../../..', import.meta.url)),
)

describe('container settings UI', () => {
  it('lists the left fade side before the right fade side', () => {
    expect(SETTINGS_TYPES.containerFadeSide).toEqual(['left', 'right'])
    expect(OPTIONS.containerFadeSide).toEqual([
      { label: 'Left', value: 'left' },
      { label: 'Right', value: 'right' },
    ])
  })

  it('places Containers between Tabs and Tab Groups', async () => {
    const optionsSource = await fs.readFile(
      path.resolve(repositoryRoot, 'src/entrypoints/options/options.vue'),
      'utf8',
    )

    expect(optionsSource).toMatch(
      /<SettingsTabs\s*\/>[\s\S]*?<SettingsContainers\s*\/>[\s\S]*?<SettingsTabGroups\s*\/>/,
    )
    expect(optionsSource).toMatch(
      /settings_tabs[\s\S]*?settings_containers[\s\S]*?settings_tab_groups/,
    )
  })

  it('exposes independent fade treatment, side, and icon controls', async () => {
    const componentSource = await fs.readFile(
      path.resolve(
        repositoryRoot,
        'src/entrypoints/options/components/settings.containers.vue',
      ),
      'utf8',
    )

    expect(componentSource).toContain('id="settings_containers"')
    expect(componentSource).toContain('label="Container Color Indicator"')
    expect(componentSource).toContain(
      'v-model="Settings.values.containerColorIndicator"',
    )
    expect(componentSource).toContain(
      ':options="OPTIONS.containerColorIndicator"',
    )
    expect(componentSource).toContain('class="child-setting"')
    expect(componentSource).toContain('label="Fade Side"')
    expect(componentSource).toContain(
      'v-model="Settings.values.containerFadeSide"',
    )
    expect(componentSource).toContain(':options="OPTIONS.containerFadeSide"')
    expect(componentSource).toContain(
      ':disabled="Settings.values.containerColorIndicator === \'off\'"',
    )
    expect(componentSource).toContain('label="Container Icon"')
    expect(componentSource).toContain(
      'v-model="Settings.values.containerIconPosition"',
    )
    expect(componentSource).toContain(
      ':options="OPTIONS.containerIconPosition"',
    )
  })
})
