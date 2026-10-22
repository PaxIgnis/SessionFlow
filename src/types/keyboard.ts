export const TREE_SHORTCUT_KEYS = [
  'shortcutActivate',
  'shortcutCollapse',
  'shortcutClose',
  'shortcutDuplicate',
  'shortcutPin',
  'shortcutReload',
  'shortcutSave',
  'shortcutEdit',
  'shortcutAddNote',
  'shortcutAddSeparator',
] as const

export type TreeShortcutKey = (typeof TREE_SHORTCUT_KEYS)[number]
export type KeyboardSettings = Record<TreeShortcutKey, string>
export type BrowserShortcutName =
  | 'open-session-tree'
  | 'open-settings'
  | 'shortcutSnapshot'

export interface KeyboardNotification {
  action: 'keyboard-notification'
  message: string
}

export const DEFAULT_TREE_SHORTCUTS: KeyboardSettings = {
  shortcutActivate: 'Enter',
  shortcutCollapse: 'Space',
  shortcutClose: '',
  shortcutDuplicate: '',
  shortcutPin: '',
  shortcutReload: '',
  shortcutSave: '',
  shortcutEdit: '',
  shortcutAddNote: '',
  shortcutAddSeparator: '',
}
