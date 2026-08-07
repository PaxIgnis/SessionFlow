<script setup lang="ts">
defineProps<{
  kind: 'confirm' | 'error'
  title: string
  message: string
  confirmLabel?: string
  danger?: boolean
}>()

const emit = defineEmits<{
  confirm: []
  cancel: []
}>()
</script>

<template>
  <div
    class="modal-backdrop"
    role="presentation"
    @click.self="emit('cancel')"
  >
    <div
      class="modal"
      role="dialog"
      aria-modal="true"
      :aria-label="title"
    >
      <h3>{{ title }}</h3>
      <p>{{ message }}</p>
      <div class="modal-actions">
        <button
          v-if="kind === 'confirm'"
          type="button"
          @click="emit('cancel')"
        >
          Cancel
        </button>
        <button
          v-if="kind === 'confirm'"
          type="button"
          :class="{ danger }"
          @click="emit('confirm')"
        >
          {{ confirmLabel }}
        </button>
        <button
          v-else
          type="button"
          @click="emit('cancel')"
        >
          Dismiss
        </button>
      </div>
    </div>
  </div>
</template>

<style scoped>
.modal-backdrop {
  position: fixed;
  inset: 0;
  z-index: 1000;
  display: flex;
  align-items: center;
  justify-content: center;
  background: rgba(0, 0, 0, 0.55);
}
.modal {
  width: min(440px, calc(100vw - 40px));
  padding: 20px;
  border: 1px solid var(--options-list-divider-color);
  border-radius: 8px;
  background: var(--background-color-secondary);
  color: var(--text-color-primary);
  box-shadow: 0 12px 40px rgba(0, 0, 0, 0.35);
}
.modal-actions {
  display: flex;
  justify-content: flex-end;
  gap: 8px;
  margin-top: 20px;
}
.danger {
  color: #fff;
  background: #a52a2a;
}
</style>
