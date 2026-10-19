import {
  TREE_SHORTCUT_KEYS,
  type KeyboardSettings,
  type TreeShortcutKey,
} from '@/types/keyboard'

const keyNames: Record<string, string> = {
  ' ': 'Space',
  ArrowUp: 'Up',
  ArrowDown: 'Down',
  ArrowLeft: 'Left',
  ArrowRight: 'Right',
  ',': 'Comma',
  '.': 'Period',
}
const supportedKey =
  /^(?:[A-Z0-9]|F(?:[1-9]|1[0-9])|Enter|Space|Comma|Period|Home|End|PageUp|PageDown|Insert|Delete)$/

export function shortcutFromEvent(
  event: Pick<
    KeyboardEvent,
    'key' | 'ctrlKey' | 'altKey' | 'shiftKey' | 'metaKey'
  >,
): string | undefined {
  const key =
    keyNames[event.key] ??
    (event.key.length === 1 ? event.key.toUpperCase() : event.key)
  if (!supportedKey.test(key)) return undefined
  return [
    event.ctrlKey && 'Ctrl',
    event.altKey && 'Alt',
    event.metaKey && 'Command',
    event.shiftKey && 'Shift',
    key,
  ]
    .filter(Boolean)
    .join('+')
}

export function isValidShortcut(
  shortcut: unknown,
  browserCommand = false,
): shortcut is string {
  if (typeof shortcut !== 'string') return false
  if (!shortcut) return true
  const parts = shortcut.split('+')
  const key = parts.pop()!
  if (!supportedKey.test(key) || new Set(parts).size !== parts.length)
    return false
  if (
    parts.some(
      (part) => !['Ctrl', 'Alt', 'Command', 'Shift', 'MacCtrl'].includes(part),
    )
  )
    return false
  if (
    browserCommand &&
    (key === 'Enter' ||
      (parts.length === 0 && !/^F\d+$/.test(key)) ||
      parts.length > 2 ||
      (parts.length > 0 && !parts.some((part) => part !== 'Shift')))
  )
    return false
  return true
}

export function matchingTreeShortcut(
  event: KeyboardEvent,
  settings: KeyboardSettings,
): TreeShortcutKey | undefined {
  const shortcut = shortcutFromEvent(event)
  return shortcut
    ? TREE_SHORTCUT_KEYS.find((key) => settings[key] === shortcut)
    : undefined
}

// Firefox uses Ctrl as an alias for Command on macOS. The recorder uses
// physical modifiers, so translate them at the browser API boundary.
export function browserShortcutFromKeys(
  shortcut: string,
  mac: boolean,
): string {
  return mac ? shortcut.replace(/\bCtrl\b/g, 'MacCtrl') : shortcut
}

export function browserShortcutToKeys(shortcut: string, mac: boolean): string {
  return mac
    ? shortcut.replace(/\bCtrl\b/g, 'Command').replace(/\bMacCtrl\b/g, 'Ctrl')
    : shortcut
}
