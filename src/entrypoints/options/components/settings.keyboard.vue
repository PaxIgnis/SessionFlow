<script lang="ts" setup>
import { computed, onMounted, onUnmounted, ref } from 'vue'
import { i18n } from '@/services/i18n'
import { Settings } from '@/services/settings'
import {
  isValidShortcut,
  shortcutFromEvent,
  browserShortcutFromKeys,
  browserShortcutToKeys,
} from '@/services/keyboard-shortcuts'
import {
  TREE_SHORTCUT_KEYS,
  type BrowserShortcutName,
  type TreeShortcutKey,
} from '@/types/keyboard'

type ShortcutName = BrowserShortcutName | TreeShortcutKey
const commands = ref<Record<BrowserShortcutName, string>>({
  'open-session-tree': '',
  'open-settings': '',
  shortcutSnapshot: '',
})
const browserCommands = ref<browser.commands.Command[]>([])
const error = ref('')
const errorName = ref<ShortcutName>()
const invalidName = ref<ShortcutName>()
const activeName = ref<ShortcutName>()
const preview = ref('')
const heldKeys = new Set<string>()
let candidate: string | undefined
let attempted = false
let invalidChord = false
let activationKey: string | undefined
let errorTimer: ReturnType<typeof setTimeout> | undefined
let invalidTimer: ReturnType<typeof setTimeout> | undefined

function notify(message: string, name?: ShortcutName): void {
  error.value = message
  errorName.value = name
  invalidName.value = name
  clearTimeout(errorTimer)
  clearTimeout(invalidTimer)
  errorTimer = setTimeout(() => {
    error.value = ''
  }, 5000)
  invalidTimer = setTimeout(() => {
    invalidName.value = undefined
  }, 1000)
}
function finish(name: ShortcutName): void {
  if (activeName.value === name) stop()
  const input = document.getElementById(name)
  if (document.activeElement === input) input?.blur()
}
function begin(name: ShortcutName): void {
  if (pending.value) return
  activeName.value = name
  preview.value = ''
  heldKeys.clear()
  candidate = undefined
  attempted = false
  invalidChord = false
  activationKey = undefined
}
function stop(): void {
  activeName.value = undefined
  heldKeys.clear()
  attempted = false
  activationKey = undefined
}
function display(name: ShortcutName): string {
  return activeName.value === name ? preview.value : value(name)
}
const pending = ref(false)
const loaded = ref(false)
const isMac =
  typeof navigator !== 'undefined' && navigator.platform.startsWith('Mac')
const rows = computed(() => [
  { name: 'open-session-tree' as const, label: i18n.t('openSessionTree') },
  { name: 'open-settings' as const, label: i18n.t('keyboardOpenSettings') },
  { name: 'shortcutSnapshot' as const, label: i18n.t('shortcutSnapshot') },
  ...TREE_SHORTCUT_KEYS.map((name) => ({ name, label: i18n.t(name) })),
])
const groups = computed(() => [
  {
    id: 'keyboard-firefox',
    title: i18n.t('keyboardFirefoxWide'),
    description: i18n.t('keyboardRequirements'),
    rows: rows.value.filter((row) => isBrowserCommand(row.name)),
  },
  {
    id: 'keyboard-tree',
    title: i18n.t('keyboardSessionTree'),
    description: i18n.t('keyboardTreeRequirements'),
    rows: rows.value.filter((row) => !isBrowserCommand(row.name)),
  },
])

function isBrowserCommand(name: ShortcutName): name is BrowserShortcutName {
  return (
    name === 'open-session-tree' ||
    name === 'open-settings' ||
    name === 'shortcutSnapshot'
  )
}
function value(name: ShortcutName): string {
  return isBrowserCommand(name) ? commands.value[name] : Settings.values[name]
}
async function refresh(): Promise<boolean> {
  try {
    browserCommands.value = (await browser.commands.getAll()).map(
      (command) => ({
        ...command,
        shortcut: browserShortcutToKeys(command.shortcut ?? '', isMac),
      }),
    )
    for (const command of browserCommands.value) {
      if (command.name && isBrowserCommand(command.name as ShortcutName)) {
        commands.value[command.name as BrowserShortcutName] =
          command.shortcut ?? ''
      }
    }
    loaded.value = true
    return true
  } catch {
    notify(i18n.t('keyboardLoadFailed'), activeName.value)
    loaded.value = false
    return false
  }
}
async function save(name: ShortcutName, shortcut: string): Promise<void> {
  if (pending.value) return
  error.value = ''
  if (!isValidShortcut(shortcut, isBrowserCommand(name))) {
    notify(i18n.t('keyboardInvalidShortcut'), name)
    return
  }
  pending.value = true
  const previous = value(name)
  try {
    if (!(await refresh())) return
    if (
      shortcut &&
      (rows.value.some(
        (row) => row.name !== name && value(row.name) === shortcut,
      ) ||
        browserCommands.value.some(
          (command) => command.name !== name && command.shortcut === shortcut,
        ))
    ) {
      notify(i18n.t('keyboardDuplicateShortcut'), name)
      return
    }
    if (isBrowserCommand(name)) {
      await browser.commands.update({
        name,
        shortcut: browserShortcutFromKeys(shortcut, isMac),
      })
      await refresh()
    } else {
      Settings.values[name] = shortcut
      await Settings.saveSettingsToStorage()
    }
  } catch {
    if (!isBrowserCommand(name)) Settings.values[name] = previous
    notify(i18n.t('keyboardSaveFailed'), name)
  } finally {
    pending.value = false
    if (activeName.value === name) preview.value = value(name)
  }
}
function record(event: KeyboardEvent, name: ShortcutName): void {
  if (event.key === 'Tab') return
  if (event.key === 'Escape') {
    event.preventDefault()
    event.stopPropagation()
    finish(name)
    return
  }
  if (activeName.value !== name) {
    if (
      !event.repeat &&
      !event.isComposing &&
      !event.ctrlKey &&
      !event.altKey &&
      !event.metaKey &&
      !event.shiftKey &&
      (event.key === 'Enter' || event.key === ' ')
    ) {
      event.preventDefault()
      event.stopPropagation()
      begin(name)
      activationKey = event.code || event.key
    }
    return
  }
  event.preventDefault()
  event.stopPropagation()
  if (activationKey) return
  if (event.isComposing || event.repeat || pending.value) return
  attempted = true
  const modifiers = ['Control', 'Alt', 'Shift', 'Meta']
  const modifierOnly = modifiers.includes(event.key)
  if (
    !modifierOnly &&
    [...heldKeys].some((key) => !/^(Control|Alt|Shift|Meta)/.test(key))
  )
    invalidChord = true
  heldKeys.add(event.code || event.key)
  if (modifierOnly && candidate) invalidChord = true
  if (!modifierOnly) candidate = shortcutFromEvent(event)
  const keys = [
    event.ctrlKey && 'Ctrl',
    event.altKey && 'Alt',
    event.metaKey && 'Command',
    event.shiftKey && 'Shift',
  ].filter(Boolean)
  if (modifierOnly) preview.value = keys.join(' + ') + ' +'
  else
    preview.value =
      candidate?.split('+').join(' + ') ?? [...keys, event.key].join(' + ')
}
async function release(
  event: KeyboardEvent,
  name: ShortcutName,
): Promise<void> {
  if (
    event.key === 'Tab' ||
    event.key === 'Escape' ||
    activeName.value !== name
  )
    return
  event.preventDefault()
  event.stopPropagation()
  if (activationKey) {
    if (activationKey === (event.code || event.key)) activationKey = undefined
    return
  }
  heldKeys.delete(event.code || event.key)
  if (
    !attempted ||
    activeName.value !== name ||
    heldKeys.size ||
    event.ctrlKey ||
    event.altKey ||
    event.metaKey ||
    event.shiftKey
  )
    return
  attempted = false
  preview.value = value(name)
  if (!candidate || invalidChord)
    notify(i18n.t('keyboardInvalidShortcut'), name)
  else await save(name, candidate)
  finish(name)
}
onMounted(() => {
  void refresh()
  window.addEventListener('focus', refresh)
})
onUnmounted(() => {
  window.removeEventListener('focus', refresh)
  clearTimeout(errorTimer)
  clearTimeout(invalidTimer)
})
</script>

<template>
  <section
    id="settings_keyboard"
    class="content-panel-section section"
  >
    <h2 class="section-title">{{ i18n.t('keyboardMappings') }}</h2>
    <p
      id="keyboard-recording-help"
      class="section-description"
    >
      {{ i18n.t('keyboardRecordingHelp') }}
    </p>
    <fieldset
      v-for="group in groups"
      :key="group.id"
      class="keyboard-group"
    >
      <legend>{{ group.title }}</legend>
      <p
        :id="group.id"
        class="section-description"
      >
        {{ group.description }}
      </p>
      <div class="rows">
        <div
          v-for="row in group.rows"
          :key="row.name"
          class="row keyboard-row"
        >
          <div class="keyboard-label">
            <span :id="row.name + '-label'">{{ row.label }}</span>
            <small
              v-if="row.name === 'shortcutClose'"
              id="keyboard-delete-warning"
              >{{ i18n.t('keyboardDeleteWarning') }}</small
            >
          </div>
          <div class="keyboard-controls">
            <input
              :id="row.name"
              :value="display(row.name)"
              :class="{
                recording: activeName === row.name,
                invalid: invalidName === row.name,
              }"
              :placeholder="
                activeName === row.name ? i18n.t('keyboardRecordPrompt') : '---'
              "
              :aria-invalid="invalidName === row.name || undefined"
              :aria-describedby="`keyboard-recording-help ${group.id}${row.name === 'shortcutClose' ? ' keyboard-delete-warning' : ''}${error && errorName === row.name ? ' keyboard-error' : ''}`"
              :aria-labelledby="row.name + '-label'"
              readonly
              :disabled="!loaded"
              :aria-busy="pending"
              @click.stop="begin(row.name)"
              @blur="stop"
              @keyup="release($event, row.name)"
              @keydown="record($event, row.name)"
            />
            <button
              type="button"
              class="keyboard-clear"
              :title="i18n.t('keyboardClearAction', [row.label])"
              :disabled="pending || !loaded || !value(row.name)"
              :aria-label="i18n.t('keyboardClearAction', [row.label])"
              @click.stop="save(row.name, '')"
            >
              <svg
                width="16"
                height="16"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                stroke-width="1.8"
                stroke-linecap="round"
                stroke-linejoin="round"
                aria-hidden="true"
              >
                <path d="M3 6h18M9 6V3h6v3M5 6l1 15h12l1-15M10 10v7M14 10v7" />
              </svg>
            </button>
            <div
              v-if="error && errorName === row.name"
              id="keyboard-error"
              role="alert"
              class="keyboard-error"
            >
              {{ error }}
            </div>
          </div>
        </div>
      </div>
    </fieldset>
    <p
      v-if="error && !errorName"
      role="alert"
      class="keyboard-error keyboard-load-error"
    >
      {{ error }}
    </p>
    <p class="eyebrow">{{ i18n.t('keyboardFixedNavigation') }}</p>
    <dl class="keyboard-navigation">
      <dt>↑ / ↓</dt>
      <dd>{{ i18n.t('keyboardNavigateRows') }}</dd>
      <dt>← / →</dt>
      <dd>{{ i18n.t('keyboardNavigateHierarchy') }}</dd>
      <dt>Ctrl + ↑ / ↓</dt>
      <dd>{{ i18n.t('keyboardMoveRows') }}</dd>
      <dt>Ctrl + ← / →</dt>
      <dd>{{ i18n.t('keyboardIndent') }}</dd>
      <dt>Alt + ↑ / ↓</dt>
      <dd>{{ i18n.t('keyboardOpenTabs') }}</dd>
    </dl>
  </section>
</template>

<style scoped>
.keyboard-group {
  min-width: 0;
  margin: 24px 0 0;
  padding: 0;
  border: 0;
}
.keyboard-group legend {
  padding: 0;
  font-weight: 600;
}
.keyboard-label {
  display: grid;
  gap: 4px;
}
.keyboard-label small {
  max-width: 360px;
  font-size: 0.8125rem;
  line-height: 1.5;
  opacity: 0.8;
}
.keyboard-controls {
  position: relative;
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
}
.keyboard-controls input {
  width: 210px;
  min-width: 0;
  padding: 6px 8px;
  border: 1px solid var(--options-hairline);
  border-radius: 4px;
  background: var(--background-color-secondary);
  color: inherit;
  font: inherit;
  cursor: pointer;
  caret-color: transparent;
  user-select: none;
  outline: none;
  transition:
    border-color 0.15s,
    box-shadow 0.15s;
}
.keyboard-controls input:focus-visible:not(:active):not(.recording) {
  outline: 1px dashed currentColor;
  outline-offset: 2px;
}
.keyboard-controls input.recording {
  outline: none;
  border-color: #528fff;
  box-shadow: 0 0 0 2px rgb(82 143 255 / 25%);
}
.keyboard-controls input.invalid {
  border-color: #ee6868;
  box-shadow: 0 0 0 2px rgb(238 104 104 / 30%);
}
.keyboard-controls button {
  padding: 4px 8px;
  border: 1px solid var(--options-hairline);
  border-radius: 4px;
  background: var(--background-color-secondary);
  color: inherit;
  font: inherit;
  cursor: pointer;
}
.keyboard-clear {
  display: grid;
  place-items: center;
}
.keyboard-clear:disabled {
  opacity: 0.4;
  cursor: default;
}
.keyboard-clear:focus-visible {
  outline: 2px solid #528fff;
  outline-offset: 2px;
}
.keyboard-navigation {
  display: grid;
  grid-template-columns: max-content 1fr;
  gap: 10px 20px;
}
.keyboard-navigation dt {
  font-weight: 600;
}
.keyboard-navigation dd {
  margin: 0;
}
.keyboard-error {
  position: absolute;
  bottom: calc(100% + 8px);
  right: 38px;
  z-index: 1100;
  width: max-content;
  max-width: min(360px, calc(100vw - 48px));
  padding: 10px 14px;
  border: 1px solid #cf6969;
  border-radius: 6px;
  background: #742e34;
  color: #ffe5e5;
  box-shadow: 0 8px 24px rgb(0 0 0 / 40%);
  font-size: 0.8125rem;
  line-height: 1.5;
  pointer-events: none;
}
.keyboard-load-error {
  position: fixed;
  top: 18px;
  bottom: auto;
  right: auto;
  left: 50%;
  transform: translateX(-50%);
}
</style>
