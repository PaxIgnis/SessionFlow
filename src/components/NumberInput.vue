<script lang="ts" setup>
import '@/styles/variables.css'
import { normalizeBoundedNumberInput } from '@/services/settings-actions'

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
  description?: string
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

  const value = normalizeBoundedNumberInput(input.value, props.min, props.max)
  if (value === undefined) return
  input.value = String(value)
  emit('update:value', value)
  emit('update', value)
}

const handleBlur = (event: Event) => {
  const input = event.target as HTMLInputElement
  const value = normalizeBoundedNumberInput(input.value, props.min, props.max)
  if (value === undefined) {
    input.value = String(props.value)
    emit('update:value', props.value)
    emit('update', props.value)
    return
  }
  input.value = String(value)
  emit('update:value', value)
  emit('update', value)
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

const changeValue = (delta: number) => {
  if (props.disabled) return
  const value = normalizeBoundedNumberInput(
    String(props.value + delta),
    props.min,
    props.max,
  )
  if (value === undefined || value === props.value) return
  emit('update:value', value)
  emit('update', value)
}
</script>

<template>
  <div class="number-container row">
    <div class="row-text">
      <label
        class="number-label row-label"
        :for="id"
        >{{ props.label }}</label
      >
      <p
        v-if="props.description"
        class="row-desc"
      >
        {{ props.description }}
      </p>
    </div>
    <div class="number-input-group stepper-group">
      <div class="stepper">
        <button
          type="button"
          :disabled="disabled || value <= (min ?? -Infinity)"
          :aria-label="`Decrease ${label}`"
          @click="changeValue(-1)"
        >
          −
        </button>
        <input
          :id="id"
          type="number"
          :value="value"
          :min="min"
          :max="max"
          :disabled="disabled"
          class="number-input stepper-value"
          @input="handleInput"
          @blur="handleBlur"
          @keydown="handleKeyDown"
          inputmode="numeric"
          pattern="[0-9]*"
        />
        <button
          type="button"
          :disabled="disabled || value >= (max ?? Infinity)"
          :aria-label="`Increase ${label}`"
          @click="changeValue(1)"
        >
          +
        </button>
      </div>
      <div
        v-if="units"
        class="unit-button-group segmented"
      >
        <button
          v-for="unit in units"
          :key="String(unit.value)"
          :disabled="disabled"
          :class="['unit-button', { active: selectedUnit === unit.value }]"
          :aria-pressed="selectedUnit === unit.value"
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
.number-label {
  cursor: default;
}

.number-input {
  width: 40px;
  border: 0;
  background: transparent;
  font-family: var(--font-mono);
}

.number-input:focus,
.number-input:focus:hover {
  outline: none;
  outline: 2px solid var(--options-focus);
  outline-offset: -2px;
}

.number-input::-webkit-outer-spin-button,
.number-input::-webkit-inner-spin-button {
  -webkit-appearance: none;
  margin: 0;
}

.number-input[type='number'] {
  -moz-appearance: textfield;
}

.unit-button {
  background: transparent;
}
</style>
