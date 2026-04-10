<script lang="ts" setup>
import { ref } from 'vue'

const props = defineProps<{
  title?: string
  initialValue: string
  placeholder?: string
}>()

const emit = defineEmits<{
  confirm: [title: string]
  cancel: []
}>()

const inputValue = ref(props.initialValue)

const dialogTitle = props.title || 'Edit Text'
const inputPlaceholder = props.placeholder || 'Enter text'

function handleConfirm() {
  emit('confirm', inputValue.value)
}

function handleCancel() {
  emit('cancel')
}

function handleKeydown(e: KeyboardEvent) {
  if (e.key === 'Enter') {
    handleConfirm()
  } else if (e.key === 'Escape') {
    handleCancel()
  }
}

function handleBackdropClick(e: MouseEvent) {
  if (e.target === e.currentTarget) {
    handleCancel()
  }
}
</script>

<template>
  <div
    class="modal-backdrop"
    @click="handleBackdropClick"
  >
    <div class="modal-container">
      <h2>{{ dialogTitle }}</h2>
      <input
        v-model="inputValue"
        type="text"
        class="modal-input"
        :placeholder="inputPlaceholder"
        @keydown="handleKeydown"
        autofocus
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
  min-width: 300px;
  max-width: 500px;
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
