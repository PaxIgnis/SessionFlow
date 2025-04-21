<script lang="ts" setup>
import '@/styles/variables.css'

interface Option {
  label: string
  value: string | number | boolean
}

const props = defineProps<{
  label: string
  modelValue: string | number | boolean
  options: Option[]
  disabled?: boolean
}>()

const emit = defineEmits<{
  'update:modelValue': [value: string | number | boolean]
  update: [value: string | number | boolean]
}>()

const handleToggle = (value: string | number | boolean) => {
  emit('update:modelValue', value)
  emit('update', value)
}
</script>

<template>
  <div class="toggle-container">
    <label class="toggle-label">{{ props.label }}</label>
    <div class="toggle-button-group">
      <button
        v-for="option in props.options"
        :key="String(option.value)"
        :class="[
          'toggle-button',
          { active: props.modelValue === option.value },
        ]"
        :disabled="disabled"
        @click="handleToggle(option.value)"
        type="button"
      >
        {{ option.label }}
      </button>
    </div>
  </div>
</template>

<style scoped>
.toggle-container {
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding: 12px 0;
  border-bottom: 1px solid var(--options-list-divider-color);
}

.toggle-label {
  font-size: var(--font-size-sm);
  color: var(--text-color-primary);
}

.toggle-button-group {
  display: flex;
  gap: 0px;
  border-radius: 4px;
  padding: 1px;
}

.toggle-button {
  color: var(--text-color-primary);
  padding: 6px 12px;
  background: transparent;
  border-width: 0px;
  cursor: pointer;
  font-size: var(--font-size-sm);
  transition: background-color 0.2s;
}

.toggle-button {
  border-radius: 4px;
}

.toggle-button:hover {
  background: var(--nav-panel-hover-color);
}

.toggle-button.active {
  background: var(--button-active-background);
  color: var(--button-active-foreground);
}

.toggle-button.active:hover {
  background: var(--button-active-background-hover);
}
</style>
