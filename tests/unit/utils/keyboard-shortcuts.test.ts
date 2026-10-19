import { describe, expect, it } from 'vitest'
import {
  isValidShortcut,
  shortcutFromEvent,
  browserShortcutFromKeys,
  browserShortcutToKeys,
} from '@/services/keyboard-shortcuts'
import { normalizeSettings } from '@/services/settings-actions'

describe('keyboard mappings', () => {
  it('preserves physical Control and Command when configuring Firefox on macOS', () => {
    expect(browserShortcutFromKeys('Ctrl+Shift+Y', true)).toBe(
      'MacCtrl+Shift+Y',
    )
    expect(browserShortcutFromKeys('Command+K', true)).toBe('Command+K')
    expect(browserShortcutToKeys('Ctrl+Shift+Y', true)).toBe('Command+Shift+Y')
    expect(browserShortcutToKeys('MacCtrl+K', true)).toBe('Ctrl+K')
    expect(browserShortcutToKeys('Ctrl+Shift+Y', false)).toBe('Ctrl+Shift+Y')
  })
  it('records exact modifiers and normalizes printable keys', () => {
    const base = {
      ctrlKey: false,
      altKey: false,
      shiftKey: false,
      metaKey: false,
    }
    expect(shortcutFromEvent({ ...base, key: ' ' })).toBe('Space')
    expect(
      shortcutFromEvent({ ...base, key: 's', ctrlKey: true, shiftKey: true }),
    ).toBe('Ctrl+Shift+S')
    expect(
      shortcutFromEvent({ ...base, key: 'ArrowUp', ctrlKey: true }),
    ).toBeUndefined()
    expect(shortcutFromEvent({ ...base, key: 'Control' })).toBeUndefined()
  })
  it.each([
    'Tab',
    'Escape',
    'Up',
    'Ctrl+Down',
    'Alt+Left',
    'Ctrl+Ctrl+K',
    'Unknown+K',
    'Ctrl+',
    'garbage',
  ])('rejects reserved or malformed local shortcut %s', (shortcut) => {
    expect(isValidShortcut(shortcut)).toBe(false)
  })
  it.each(['', 'Enter', 'Space', 'Ctrl+K', 'Command+Shift+S', 'F9'])(
    'accepts local shortcut %s',
    (shortcut) => {
      expect(isValidShortcut(shortcut)).toBe(true)
    },
  )
  it('requires Firefox-compatible global combinations', () => {
    for (const shortcut of [
      'Enter',
      'Space',
      'Shift+S',
      'Ctrl+Enter',
      'Ctrl+Alt+Shift+K',
    ])
      expect(isValidShortcut(shortcut, true)).toBe(false)
    for (const shortcut of ['', 'F9', 'Ctrl+Shift+Y', 'Alt+S', 'Command+K'])
      expect(isValidShortcut(shortcut, true)).toBe(true)
  })
  it('preserves cleared shortcuts and fills defaults for existing installations', () => {
    const settings = normalizeSettings({
      shortcutActivate: 'Ctrl+K',
      shortcutCollapse: '',
      shortcutClose: 9,
      shortcutPin: 'Ctrl+Right',
    })
    expect(settings.shortcutActivate).toBe('Ctrl+K')
    expect(settings.shortcutCollapse).toBe('')
    expect(settings.shortcutClose).toBe('')
    expect(settings.shortcutPin).toBe('')
    expect(normalizeSettings({}).shortcutActivate).toBe('Enter')
  })
})
