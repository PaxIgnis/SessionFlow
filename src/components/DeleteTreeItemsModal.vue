<script lang="ts" setup>
import { i18n, formatList, formatNumber } from '@/services/i18n'
import type { DeleteTreeItemCounts } from '@/services/modal-state'
import { computed, nextTick, onBeforeUnmount, onMounted, ref } from 'vue'

const props = defineProps<{
  counts: DeleteTreeItemCounts
  pending?: boolean
}>()
const emit = defineEmits<{ confirm: []; cancel: [] }>()
const dialog = ref<HTMLElement>()
let previouslyFocused: HTMLElement | null = null

const summary = computed(() => {
  const { windows, tabs, notes, separators } = props.counts

  const parts = [
    windows > 0 ? i18n.t('countWindow', windows, [formatNumber(windows)]) : '',
    tabs > 0 ? i18n.t('countTab', tabs, [formatNumber(tabs)]) : '',
    notes > 0 ? i18n.t('countNote', notes, [formatNumber(notes)]) : '',
    separators > 0
      ? i18n.t('countSeparator', separators, [formatNumber(separators)])
      : '',
  ].filter(Boolean)
  return parts.length ? formatList(parts) : i18n.t('noItems')
})

onMounted(async () => {
  previouslyFocused =
    document.activeElement instanceof HTMLElement
      ? document.activeElement
      : null
  await nextTick()
  dialog.value?.querySelector<HTMLElement>('button:not([disabled])')?.focus()
})

onBeforeUnmount(() => {
  const focusTarget = previouslyFocused?.isConnected
    ? previouslyFocused
    : (document.querySelector<HTMLElement>('.tree-item') ??
      document.querySelector<HTMLElement>('.sessiontree-content'))
  focusTarget?.focus({ preventScroll: true })
})

function handleKeydown(event: KeyboardEvent): void {
  if (event.key === 'Escape') {
    if (!props.pending) emit('cancel')
    return
  }
  if (event.key !== 'Tab') return

  const focusable = [
    ...(dialog.value?.querySelectorAll<HTMLElement>('button:not([disabled])') ??
      []),
  ]
  if (focusable.length === 0) {
    event.preventDefault()
    dialog.value?.focus()
    return
  }

  const first = focusable[0]
  const last = focusable.at(-1)!
  const active = document.activeElement
  if (event.shiftKey && (active === first || !dialog.value?.contains(active))) {
    event.preventDefault()
    last.focus()
  } else if (!event.shiftKey && active === last) {
    event.preventDefault()
    first.focus()
  }
}
</script>

<template>
  <div class="delete-tree-items-backdrop">
    <section
      ref="dialog"
      class="delete-tree-items-modal"
      role="dialog"
      aria-modal="true"
      aria-labelledby="delete-tree-items-title"
      tabindex="-1"
      @keydown="handleKeydown"
    >
      <h2 id="delete-tree-items-title">{{ i18n.t('deleteSelectedItems') }}</h2>
      <p>{{ i18n.t('deleteSummary', [summary]) }}</p>
      <p>{{ i18n.t('openTabsAndWindowsWillAlsoBeClosedInFirefox') }}</p>
      <div class="delete-tree-items-actions">
        <button
          class="delete-tree-items-confirm"
          :disabled="pending"
          @click="$emit('confirm')"
        >
          {{ i18n.t('delete') }}
        </button>
        <button
          class="delete-tree-items-cancel"
          :disabled="pending"
          @click="$emit('cancel')"
        >
          {{ i18n.t('cancel') }}
        </button>
      </div>
    </section>
  </div>
</template>

<style scoped>
.delete-tree-items-backdrop {
  align-items: center;
  background: rgba(0, 0, 0, 0.5);
  display: flex;
  inset: 0;
  justify-content: center;
  padding: 16px;
  position: fixed;
  z-index: 1000;
}

.delete-tree-items-modal {
  background: var(--background-color-primary);
  border: 1px solid var(--nav-panel-border-color);
  border-radius: 8px;
  box-sizing: border-box;
  color: var(--text-color-primary);
  padding: 18px;
  width: min(460px, calc(100vw - 32px));
}

.delete-tree-items-actions {
  display: flex;
  gap: 8px;
  justify-content: flex-end;
}

.delete-tree-items-confirm {
  background: rgb(115, 35, 35);
  border-color: rgb(165, 65, 65);
  color: rgb(255, 220, 220);
}
</style>
