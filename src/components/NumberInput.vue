<script lang="ts" setup>
import '@/styles/variables.css'

interface Units {
  label: string
  value: string | number | boolean
}

const props = defineProps<{
  label: string
  value: number
  min?: number
  max?: number
  id?: string
  units?: Units[]
  selectedUnit?: string | number | boolean
  disabled?: boolean
}>()

const emit = defineEmits<{
  'update:value': [value: number]
  'update:selectedUnit': [value: string | number | boolean]
  update: [value: number]
}>()

const handleInput = (event: Event) => {
  const input = event.target as HTMLInputElement

  // Allow empty input while typing
  if (input.value === '') {
    return
  }

  // Remove any non-digit characters except decimal point and minus sign
  const sanitizedValue = input.value.replace(/[^\d.-]/g, '')

  // Ensure valid number format
  if (/^-?\d*\.?\d*$/.test(sanitizedValue)) {
    const value = Number(sanitizedValue)
    // Check if value is within min/max bounds
    if (props.min !== undefined && value < props.min) {
      input.value = String(props.min)
      emit('update:value', props.min)
      emit('update', props.min)
    } else if (props.max !== undefined && value > props.max) {
      input.value = String(props.max)
      emit('update:value', props.max)
      emit('update', props.max)
    } else {
      input.value = sanitizedValue
      emit('update:value', value)
      emit('update', value)
    }
  }
}

const handleBlur = (event: Event) => {
  const input = event.target as HTMLInputElement
  if (input.value === '' || isNaN(Number(input.value))) {
    input.value = String(props.value)
    emit('update:value', props.value)
    emit('update', props.value)
  }
}

const handleKeyDown = (event: KeyboardEvent) => {
  // Allow: backspace, delete, tab, escape, enter
  if (
    ['Delete', 'Backspace', 'Tab', 'Escape', 'Enter'].includes(event.key) ||
    // Allow: Ctrl+A, Ctrl+C, Ctrl+V, Ctrl+X
    (event.key === 'a' && event.ctrlKey === true) ||
    (event.key === 'c' && event.ctrlKey === true) ||
    (event.key === 'v' && event.ctrlKey === true) ||
    (event.key === 'x' && event.ctrlKey === true) ||
    // Allow: home, end, left, right
    ['Home', 'End', 'ArrowLeft', 'ArrowRight'].includes(event.key)
  ) {
    return
  }
  // Allow minus sign at start for negative numbers
  if (
    event.key === '-' &&
    (event.target as HTMLInputElement).selectionStart === 0
  ) {
    return
  }
  // Ensure that it is a number and stop the keypress if not
  if (event.shiftKey || !/^[0-9]$/.test(event.key)) {
    event.preventDefault()
  }
}

const handleUnitToggle = (value: string | number | boolean) => {
  emit('update:selectedUnit', value)
  emit('update', props.value)
}
</script>

<template>
  <div class="number-container">
    <label class="number-label" :for="id">{{ props.label }}</label>
    <div class="number-input-group">
      <input
        :id="id"
        type="number"
        :value="value"
        :min="min"
        :max="max"
        :disabled="disabled"
        class="number-input"
        @input="handleInput"
        @blur="handleBlur"
        @keydown="handleKeyDown"
        inputmode="numeric"
        pattern="[0-9]*"
      />
      <div v-if="units" class="unit-button-group">
        <button
          v-for="unit in units"
          :key="String(unit.value)"
          :disabled="disabled"
          :class="['unit-button', { active: selectedUnit === unit.value }]"
          @click="handleUnitToggle(unit.value)"
          type="button"
        >
          {{ unit.label }}
        </button>
      </div>
    </div>
  </div>
</template>

<style scoped>
.number-container {
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding: 12px 0;
  border-bottom: 1px solid var(--options-list-divider-color);
}

.number-label {
  font-size: var(--font-size-sm);
  color: var(--text-color-primary);
}

.number-input-group {
  display: flex;
  gap: 0px;
  border-radius: 4px;
  padding: 1px;
}

.number-input {
  width: 40px;
  padding: 6px 12px;
  background-color: var(--background-color-secondary);
  color: var(--text-color-primary);
  border-width: 1px;
  border-style: solid;
  border-color: var(--options-input-border-color);
  border-radius: 4px;
  font-size: var(--font-size-sm);
  text-align: right;
  margin-right: 5px;
}

.number-input:focus,
.number-input:focus:hover {
  outline: none;
  border-color: var(--options-input-border-color-hover);
}

.number-input::-webkit-outer-spin-button,
.number-input::-webkit-inner-spin-button {
  -webkit-appearance: none;
  margin: 0;
}

.number-input[type='number'] {
  -moz-appearance: textfield;
}

.unit-button-group {
  display: flex;
  gap: 0px;
  border-radius: 4px;
  padding: 1px;
}

.unit-button {
  color: var(--text-color-primary);
  padding: 6px 12px;
  background: transparent;
  border-width: 0px;
  cursor: pointer;
  font-size: var(--font-size-sm);
  transition: background-color 0.2s;
}

.unit-button {
  border-radius: 4px;
}

.unit-button:hover {
  background: var(--nav-panel-hover-color);
}

.unit-button.active {
  background: var(--button-active-background);
  color: var(--button-active-foreground);
}

.unit-button.active:hover {
  background: var(--button-active-background-hover);
}
</style>
