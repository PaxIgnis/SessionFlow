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
  description?: string
}>()

const emit = defineEmits<{
  'update:modelValue': [value: string | number | boolean]
  update: [value: string | number | boolean]
}>()

const handleToggle = (value: string | number | boolean) => {
  if (!props.options.some((option) => Object.is(option.value, value))) return
  emit('update:modelValue', value)
  emit('update', value)
}
</script>

<template>
  <div class="toggle-container row">
    <div class="row-text">
      <label class="toggle-label row-label">{{ props.label }}</label>
      <p
        v-if="props.description"
        class="row-desc"
      >
        {{ props.description }}
      </p>
    </div>
    <div class="toggle-button-group segmented">
      <button
        v-for="option in props.options"
        :key="String(option.value)"
        :class="[
          'toggle-button',
          { active: props.modelValue === option.value },
        ]"
        :disabled="disabled"
        :aria-pressed="props.modelValue === option.value"
        @click="handleToggle(option.value)"
        type="button"
      >
        {{ option.label }}
      </button>
    </div>
  </div>
</template>

<style scoped>
.toggle-label {
  cursor: default;
}

.toggle-button {
  background: transparent;
}
</style>
