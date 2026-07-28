<script lang="ts" setup>
import { truncateText } from '@/services/utils'
import { nextTick, onBeforeUnmount, onMounted, ref } from 'vue'

const props = defineProps<{
  title?: string
  initialValue: string
  placeholder?: string
  multiline?: boolean
  maxLength: number
}>()

const emit = defineEmits<{
  confirm: [title: string]
  cancel: []
}>()

const inputValue = ref(props.initialValue)
const inputRef = ref<HTMLInputElement | HTMLTextAreaElement | null>(null)
const dialogRef = ref<HTMLElement | null>(null)
let previouslyFocused: HTMLElement | null = null

const dialogTitle = props.title || 'Edit Text'
const inputPlaceholder = props.placeholder || 'Enter text'

function handleConfirm() {
  emit('confirm', truncateText(inputValue.value, props.maxLength))
}

function enforceInputLimit() {
  inputValue.value = truncateText(inputValue.value, props.maxLength)
}

function handleCancel() {
  emit('cancel')
}

function handleKeydown(event: KeyboardEvent) {
  if (event.key === 'Escape') {
    event.preventDefault()
    handleCancel()
    return
  }
  if (event.key === 'Tab') {
    containFocus(event)
    return
  }
  if (event.key === 'Enter' && !(props.multiline === true && event.shiftKey)) {
    event.preventDefault()
    handleConfirm()
  }
}

function containFocus(event: KeyboardEvent) {
  const focusable = Array.from(
    dialogRef.value?.querySelectorAll<HTMLElement>(
      'input, textarea, button:not([disabled])',
    ) ?? [],
  )
  if (focusable.length === 0) {
    event.preventDefault()
    dialogRef.value?.focus()
    return
  }

  const first = focusable[0]
  const last = focusable.at(-1)!
  if (event.shiftKey && document.activeElement === first) {
    event.preventDefault()
    last.focus()
  } else if (!event.shiftKey && document.activeElement === last) {
    event.preventDefault()
    first.focus()
  }
}

function handleBackdropClick(e: MouseEvent) {
  if (e.target === e.currentTarget) {
    handleCancel()
  }
}

onMounted(async () => {
  previouslyFocused =
    document.activeElement instanceof HTMLElement
      ? document.activeElement
      : null
  await nextTick()
  // setTimeout helps when opening from browser context menu, where focus can lag.
  setTimeout(() => {
    inputRef.value?.focus()
    inputRef.value?.select()
  }, 0)
})

onBeforeUnmount(() => {
  previouslyFocused?.focus({ preventScroll: true })
})
</script>

<template>
  <div
    class="modal-backdrop"
    @click="handleBackdropClick"
  >
    <div
      ref="dialogRef"
      class="modal-container"
      role="dialog"
      aria-modal="true"
      aria-labelledby="edit-text-modal-title"
      tabindex="-1"
      @keydown="handleKeydown"
    >
      <h2 id="edit-text-modal-title">{{ dialogTitle }}</h2>
      <textarea
        v-if="multiline"
        ref="inputRef"
        v-model="inputValue"
        class="modal-input modal-textarea"
        :data-max-length="maxLength"
        :placeholder="inputPlaceholder"
        rows="6"
        autofocus
        @input="enforceInputLimit"
      ></textarea>
      <input
        v-else
        ref="inputRef"
        v-model="inputValue"
        type="text"
        class="modal-input"
        :data-max-length="maxLength"
        :placeholder="inputPlaceholder"
        autofocus
        @input="enforceInputLimit"
      />
      <div class="modal-buttons">
        <button
          class="btn btn-primary"
          @click="handleConfirm"
        >
          OK
        </button>
        <button
          class="btn btn-secondary"
          @click="handleCancel"
        >
          Cancel
        </button>
      </div>
    </div>
  </div>
</template>

<style scoped>
.modal-backdrop {
  position: fixed;
  top: 0;
  left: 0;
  right: 0;
  bottom: 0;
  background: rgba(0, 0, 0, 0.5);
  display: flex;
  align-items: center;
  justify-content: center;
  z-index: 1000;
}

.modal-container {
  background: var(--background-color-primary, white);
  border-radius: 8px;
  padding: 20px;
  box-sizing: border-box;
  width: min(500px, calc(100vw - 32px));
  min-width: 0;
  max-width: 100%;
  max-height: calc(100vh - 32px);
  overflow-y: auto;
  box-shadow: 0 4px 12px rgba(0, 0, 0, 0.15);
}

h2 {
  margin: 0 0 16px 0;
  font-size: 16px;
  color: var(--text-color-primary);
  pointer-events: none;
}

.modal-input {
  width: 100%;
  padding: 8px 12px;
  border: 1px solid var(--border-color, #ccc);
  border-radius: 4px;
  font-size: 14px;
  font-family: inherit;
  color: var(--text-color-secondary, black);
  background: var(--background-color-input, white);
  box-sizing: border-box;
  margin-bottom: 16px;
}

.modal-input:focus {
  outline: none;
  border-color: var(--focus-border-color, #0066ff);
  box-shadow: 0 0 0 2px rgba(0, 102, 255, 0.1);
}

.modal-textarea {
  min-height: 96px;
  max-height: min(40vh, 240px);
  resize: vertical;
}

.modal-buttons {
  display: flex;
  gap: 8px;
  justify-content: flex-end;
}

.btn {
  padding: 8px 16px;
  border: none;
  border-radius: 4px;
  font-size: 14px;
  cursor: pointer;
  font-weight: 500;
  transition: all 0.2s;
}

.btn-primary {
  background: var(--button-active-background);
  color: var(--button-primary-foreground, white);
}

.btn-primary:hover {
  background: var(--button-active-background-hover);
}

.btn-secondary {
  background: var(--button-secondary-background, #f0f0f0);
  color: var(--button-secondary-foreground, #333);
}

.btn-secondary:hover {
  background: var(--button-secondary-background-hover, #e0e0e0);
}
</style>
