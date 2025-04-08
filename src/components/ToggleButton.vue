<script lang="ts" setup>
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
  border-bottom: 1px solid #eee;
}

.toggle-label {
  font-size: 14px;
  color: #333;
}

.toggle-button-group {
  display: flex;
  gap: 1px;
  background: #fff;
  border-radius: 4px;
  padding: 1px;
}

.toggle-button {
  padding: 6px 12px;
  background: #fff;
  border: 1px solid #ddd;
  cursor: pointer;
  font-size: 14px;
  transition: background-color 0.2s;
}

.toggle-button {
  border-radius: 4px;
}

.toggle-button:hover {
  background: #f5f5f5;
}

.toggle-button.active {
  background: #2196f3;
  color: #fff;
}
</style>
