<script setup lang="ts">
import { Settings } from '@/services/settings'
import { OPTIONS } from '@/types/settings'

type ScopeKey =
  | 'contextMenuDeleteDescendants'
  | 'duplicateTreeItemDescendants'
  | 'contextMenuOpenDescendants'
  | 'contextMenuReloadDescendants'
  | 'contextMenuSaveDescendants'
  | 'contextMenuPinDescendants'
  | 'includeChildrenOfSelectedItemsWhenIndenting'

interface MatrixOption {
  label: string
  value: string
}

interface MatrixRow {
  key: ScopeKey
  label: string
  options: readonly MatrixOption[]
}

const ordinaryOptions = OPTIONS.includeChildrenOfSelectedItems
const rows: MatrixRow[] = [
  {
    key: 'contextMenuDeleteDescendants',
    label: 'Delete',
    options: ordinaryOptions,
  },
  {
    key: 'duplicateTreeItemDescendants',
    label: 'Duplicate',
    options: OPTIONS.duplicateTreeItemDescendants,
  },
  {
    key: 'contextMenuOpenDescendants',
    label: 'Open saved tabs',
    options: ordinaryOptions,
  },
  {
    key: 'contextMenuReloadDescendants',
    label: 'Reload tabs',
    options: ordinaryOptions,
  },
  {
    key: 'contextMenuSaveDescendants',
    label: 'Save tabs',
    options: ordinaryOptions,
  },
  {
    key: 'contextMenuPinDescendants',
    label: 'Pin and unpin',
    options: ordinaryOptions,
  },
  {
    key: 'includeChildrenOfSelectedItemsWhenIndenting',
    label: 'Change indent',
    options: ordinaryOptions,
  },
]

function updateScope(row: MatrixRow, value: string) {
  switch (row.key) {
    case 'duplicateTreeItemDescendants':
      Settings.values.duplicateTreeItemDescendants = value as
        | 'complete-subtree'
        | 'collapsed'
        | 'selected-only'
      break
    case 'contextMenuDeleteDescendants':
      Settings.values.contextMenuDeleteDescendants = value as
        | 'always'
        | 'collapsed'
        | 'never'
      break
    case 'contextMenuOpenDescendants':
      Settings.values.contextMenuOpenDescendants = value as
        | 'always'
        | 'collapsed'
        | 'never'
      break
    case 'contextMenuReloadDescendants':
      Settings.values.contextMenuReloadDescendants = value as
        | 'always'
        | 'collapsed'
        | 'never'
      break
    case 'contextMenuSaveDescendants':
      Settings.values.contextMenuSaveDescendants = value as
        | 'always'
        | 'collapsed'
        | 'never'
      break
    case 'contextMenuPinDescendants':
      Settings.values.contextMenuPinDescendants = value as
        | 'always'
        | 'collapsed'
        | 'never'
      break
    case 'includeChildrenOfSelectedItemsWhenIndenting':
      Settings.values.includeChildrenOfSelectedItemsWhenIndenting = value as
        | 'always'
        | 'collapsed'
        | 'never'
  }
  Settings.saveSettingsToStorage()
}
</script>

<template>
  <div class="matrix">
    <div
      class="matrix-head"
      aria-hidden="true"
    >
      <span class="matrix-head-label">Action</span>
      <span class="matrix-head-col">Always</span>
      <span class="matrix-head-col">If collapsed</span>
      <span class="matrix-head-col">Never</span>
    </div>
    <div
      v-for="row in rows"
      :key="row.key"
      class="matrix-row"
      role="radiogroup"
      :aria-label="row.label"
    >
      <span class="matrix-label">{{ row.label }}</span>
      <label
        v-for="option in row.options"
        :key="option.value"
        class="matrix-cell"
      >
        <input
          type="radio"
          :name="`descendant-scope-${row.key}`"
          :value="option.value"
          :checked="Settings.values[row.key] === option.value"
          :aria-label="`${row.label}: ${option.label.toLowerCase()}`"
          @change="updateScope(row, option.value)"
        />
        <span class="dot"></span>
        <span class="cell-text">{{ option.label }}</span>
      </label>
    </div>
  </div>
</template>

<style scoped>
.matrix {
  --matrix-column-width: 104px;
  margin-top: 4px;
}

.matrix-head,
.matrix-row {
  display: grid;
  grid-template-columns: minmax(0, 1fr) repeat(3, var(--matrix-column-width));
  align-items: center;
}

.matrix-head {
  padding-bottom: 9px;
  border-bottom: 1px solid var(--options-hairline-strong);
}

.matrix-head-label,
.matrix-head-col {
  color: var(--options-text-faint);
  font-size: 0.6875rem;
  font-weight: 600;
  letter-spacing: 0.085em;
  text-transform: uppercase;
}

.matrix-head-col {
  text-align: center;
}

.matrix-row {
  border-bottom: 1px solid var(--options-hairline);
}

.matrix-row:hover {
  background: rgba(255, 255, 255, 0.022);
}

.matrix-label {
  padding: 11px 16px 11px 0;
  color: var(--text-color-primary);
  font-size: 0.875rem;
}

.matrix-cell {
  position: relative;
  display: flex;
  align-self: stretch;
  align-items: center;
  justify-content: center;
  cursor: pointer;
  transition: background-color 0.15s;
}

.matrix-cell:hover {
  background: rgba(255, 255, 255, 0.035);
}

.matrix-cell:has(input:checked) {
  background: var(--options-accent-wash);
}

/* The radio is the control, so it stays a real full-size element and is only
   made transparent — .dot draws its appearance. Clipping it to a 1px box the
   way a visually-hidden label is clipped leaves nothing for Firefox to focus,
   and native radio-group arrow navigation works by focusing the next radio. */
.matrix-cell input {
  position: absolute;
  inset: 0;
  width: 100%;
  height: 100%;
  margin: 0;
  padding: 0;
  border: 0;
  opacity: 0;
  cursor: pointer;
}

/* A label, not a control: hidden from sight, kept in the accessible tree. */
.cell-text {
  position: absolute;
  width: 1px;
  height: 1px;
  margin: -1px;
  overflow: hidden;
  clip-path: inset(50%);
  white-space: nowrap;
}

.dot {
  display: grid;
  width: 15px;
  height: 15px;
  place-items: center;
  border: 1.5px solid var(--options-text-faint);
  border-radius: 50%;
}

.dot::after {
  width: 7px;
  height: 7px;
  border-radius: 50%;
  background: var(--button-active-background);
  content: '';
  transform: scale(0);
  transition: transform 0.15s ease;
}

.matrix-cell input:checked + .dot {
  border-color: var(--button-active-background);
}

.matrix-cell input:checked + .dot::after {
  transform: scale(1);
}

.matrix-cell input:focus-visible + .dot {
  outline: 2px solid var(--options-focus);
  outline-offset: 3px;
}

@media (max-width: 680px) {
  .matrix-head {
    display: none;
  }

  .matrix-row {
    grid-template-columns: 1fr;
    padding: 10px 0;
  }

  .matrix-label {
    padding: 0 0 8px;
    font-weight: 500;
  }

  .matrix-cell {
    justify-content: flex-start;
    gap: 8px;
    min-height: 30px;
    padding: 4px 8px;
  }

  .cell-text {
    position: static;
    width: auto;
    height: auto;
    margin: 0;
    overflow: visible;
    clip-path: none;
  }
}
</style>
