import EditTextModal from '@/components/EditTextModal.vue'
import { normalizeEditTextValue } from '@/services/utils'
import { createSSRApp } from 'vue'
import { renderToString } from 'vue/server-renderer'
import { describe, expect, it } from 'vitest'
import fs from 'node:fs/promises'

describe('edit text modal', () => {
  it('renders an accessible single-line dialog with an input limit', async () => {
    const markup = await renderToString(
      createSSRApp(EditTextModal, {
        title: 'Edit Window Title',
        initialValue: 'Research',
        maxLength: 150,
      }),
    )

    expect(markup).toContain('role="dialog"')
    expect(markup).toContain('aria-modal="true"')
    expect(markup).toContain('aria-labelledby="edit-text-modal-title"')
    expect(markup).toContain('data-max-length="150"')
    expect(markup).toContain('<input')
    expect(markup).not.toContain('<textarea')
  })

  it('renders a multiline note editor with its exact input limit', async () => {
    const markup = await renderToString(
      createSSRApp(EditTextModal, {
        title: 'Edit Note',
        initialValue: 'First line\nSecond line',
        multiline: true,
        maxLength: 500,
      }),
    )

    expect(markup).toContain('<textarea')
    expect(markup).toContain('data-max-length="500"')
    expect(markup).toContain('First line\nSecond line')
  })

  it('contains focus, restores the trigger, and distinguishes Enter from Shift+Enter', async () => {
    const source = await fs.readFile(
      new URL('../../../src/components/EditTextModal.vue', import.meta.url),
      'utf8',
    )

    expect(source).toContain('previouslyFocused')
    expect(source).toMatch(/event\.key\s*[!=]==?\s*'Tab'/)
    expect(source).toContain("event.key === 'Escape'")
    expect(source).toContain("event.key === 'Enter'")
    expect(source).toContain('event.shiftKey')
    expect(source).toContain('previouslyFocused?.focus')
  })

  it('fits narrow and zoomed session-tree viewports', async () => {
    const source = await fs.readFile(
      new URL('../../../src/components/EditTextModal.vue', import.meta.url),
      'utf8',
    )

    expect(source).toMatch(
      /\.modal-container\s*\{[\s\S]*?width:\s*min\(500px, calc\(100vw - 32px\)\)/,
    )
    expect(source).toMatch(/\.modal-container\s*\{[\s\S]*?min-width:\s*0/)
    expect(source).toMatch(/\.modal-container\s*\{[\s\S]*?max-height:/)
    expect(source).toMatch(/\.modal-container\s*\{[\s\S]*?overflow-y:\s*auto/)
  })
})

describe('edit text normalization', () => {
  it.each([
    ['window-title', '  Research  ', 'Research'],
    ['window-title', '   ', ''],
    ['custom-label', '  Project α  ', 'Project α'],
    ['custom-label', '\t\n', undefined],
    ['note', '  First line\nSecond line  ', '  First line\nSecond line  '],
    ['note', ' \n\t ', ''],
  ] as const)('normalizes %s input', (kind, input, expected) => {
    expect(normalizeEditTextValue(kind, input)).toBe(expected)
  })

  it.each([
    ['window-title', 149, 149],
    ['window-title', 150, 150],
    ['window-title', 151, 150],
    ['custom-label', 149, 149],
    ['custom-label', 150, 150],
    ['custom-label', 151, 150],
    ['note', 499, 499],
    ['note', 500, 500],
    ['note', 501, 500],
  ] as const)(
    'enforces the %s boundary at %s characters',
    (kind, length, expected) => {
      expect(normalizeEditTextValue(kind, 'x'.repeat(length))?.length).toBe(
        expected,
      )
    },
  )

  it.each([
    ['window-title', 150],
    ['custom-label', 150],
    ['note', 500],
  ] as const)(
    'does not split Unicode code points at the %s limit',
    (kind, limit) => {
      const normalized = normalizeEditTextValue(kind, '😀'.repeat(limit + 1))

      expect(Array.from(normalized ?? '')).toHaveLength(limit)
      expect(normalized).toBe('😀'.repeat(limit))
    },
  )
})
