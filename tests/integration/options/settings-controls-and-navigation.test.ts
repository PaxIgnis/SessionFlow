import { describe, expect, it } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'
import {
  findActiveSettingsSection,
  normalizeBoundedNumberInput,
} from '@/services/settings-actions'

const projectRoot = process.cwd()

describe('settings controls and navigation', () => {
  it.each([
    ['', 1, 999, undefined],
    ['   ', 1, 999, undefined],
    [' 12 ', 1, 999, 12],
    ['１２', 1, 999, undefined],
    ['abc', 1, 999, undefined],
    ['NaN', 1, 999, undefined],
    ['Infinity', 1, 999, undefined],
    ['-4', 1, 999, 1],
    ['0', 1, 999, 1],
    ['1000000000000000000000000', 1, 999, 999],
    ['4.5', 1, 999, 4.5],
  ] as const)(
    'normalizes numeric input %j without emitting invalid storage values',
    (input, min, max, expected) => {
      expect(normalizeBoundedNumberInput(input, min, max)).toBe(expected)
    },
  )

  it('selects the last settings section at or above the scroll position', () => {
    const sections = [
      { id: 'general', offsetTop: 0 },
      { id: 'tabs', offsetTop: 500 },
      { id: 'favicons', offsetTop: 1000 },
    ]

    expect(findActiveSettingsSection(sections, 0)).toBe('general')
    expect(findActiveSettingsSection(sections, 499)).toBe('general')
    expect(findActiveSettingsSection(sections, 500)).toBe('tabs')
    expect(findActiveSettingsSection(sections, 999)).toBe('tabs')
    expect(findActiveSettingsSection(sections, 5000)).toBe('favicons')
  })

  it('selects the final section when the panel reaches its scroll limit', () => {
    const sections = [
      { id: 'drag-and-drop', offsetTop: 2500 },
      { id: 'favicons', offsetTop: 2966 },
    ]

    expect(findActiveSettingsSection(sections, 2885, 3732, 847)).toBe(
      'favicons',
    )
  })

  it('keeps the first section active when the panel does not overflow', () => {
    const sections = [
      { id: 'general', offsetTop: 0 },
      { id: 'favicons', offsetTop: 500 },
    ]

    expect(findActiveSettingsSection(sections, 0, 847, 847)).toBe('general')
  })

  it('binds every parent-dependent control without mutating its child model', () => {
    const expectedBindings = new Map([
      [
        'src/entrypoints/options/components/settings.windows.vue',
        [
          ':disabled="!Settings.values.openWindowsInSameLocation"',
          ':disabled="Settings.values.saveWindowOnClose"',
        ],
      ],
      [
        'src/entrypoints/options/components/settings.tabs.vue',
        [':disabled="Settings.values.saveTabOnClose"'],
      ],
      [
        'src/entrypoints/options/components/settings.containers.vue',
        [':disabled="Settings.values.containerColorIndicator === \'off\'"'],
      ],
      [
        'src/entrypoints/options/components/settings.favicons.vue',
        [
          ':disabled="Settings.values.refreshFaviconsAfterPeriodOfTime === false"',
        ],
      ],
      [
        'src/entrypoints/options/components/settings.drag-and-drop.vue',
        [
          ':disabled="!Settings.values.enableDragAndDrop"',
          "Settings.values.includeChildrenOfSelectedItems === 'never'",
          '!Settings.values.tryToMaintainHierarchyOfDraggedItems',
        ],
      ],
    ])

    for (const [relativePath, bindings] of expectedBindings) {
      const source = fs.readFileSync(
        path.join(projectRoot, relativePath),
        'utf8',
      )
      for (const binding of bindings) expect(source).toContain(binding)
      expect(source).not.toMatch(/watch\([\s\S]*?Settings\.values/)
    }
  })

  it('keeps group and container presentation derived from reactive settings', () => {
    const source = fs.readFileSync(
      path.join(projectRoot, 'src/components/TreeItem.vue'),
      'utf8',
    )

    expect(source).toContain(
      "if (Settings.values.tabGroupColorIndicator === 'hidden')",
    )
    expect(source).toContain('position: Settings.values.tabGroupColorIndicator')
    expect(source).toContain(
      'treatment: Settings.values.containerColorIndicator',
    )
    expect(source).toContain('fadeSide: Settings.values.containerFadeSide')
    expect(source).toContain(
      'iconPosition: Settings.values.containerIconPosition',
    )
  })

  it('exposes the private favicon cache and display policy in favicon settings', () => {
    const source = fs.readFileSync(
      path.join(
        projectRoot,
        'src/entrypoints/options/components/settings.favicons.vue',
      ),
      'utf8',
    )

    expect(source).toContain(
      'v-model="Settings.values.cachePrivateTabFavicons"',
    )
    expect(source).toContain('Show and cache favicons for private tabs')
  })
})
