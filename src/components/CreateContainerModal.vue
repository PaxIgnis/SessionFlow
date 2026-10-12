<script lang="ts" setup>
import { computed, nextTick, onBeforeUnmount, onMounted, ref } from 'vue'
import { i18n } from '@/services/i18n'
import { createContainer } from '@/services/foreground-messages'
import {
  defaultContainerChoices,
  supportedContainerChoices,
} from '@/services/container-choices'
import { isKnownFirefoxContainerIcon } from '@/defaults/container-icons'

const props = defineProps<{ tabUids: UID[] }>()
const emit = defineEmits<{ close: [] }>()
const name = ref('')
const color = ref('blue')
const icon = ref('fingerprint')
const choices = ref(defaultContainerChoices())
const pending = ref(false)
const error = ref('')
const dialog = ref<HTMLElement | null>(null)
const nameInput = ref<HTMLInputElement | null>(null)
let previouslyFocused: HTMLElement | null = null
const colorCode = computed(
  () =>
    choices.value.colors.find((choice) => choice.color === color.value)
      ?.colorCode,
)

function choiceLabel(kind: 'Color' | 'Icon', value: string): string {
  const key =
    `container${kind}${value[0].toUpperCase()}${value.slice(1)}` as Parameters<
      typeof i18n.t
    >[0]
  return i18n.t(key) || value
}

async function submit() {
  if (pending.value) return
  if (!name.value.trim()) {
    error.value = i18n.t('containerNameRequired')
    nameInput.value?.focus()
    return
  }
  error.value = ''
  pending.value = true
  try {
    await createContainer(
      {
        name: name.value.trim(),
        color: color.value,
        icon: icon.value,
      },
      props.tabUids,
    )
    emit('close')
  } catch {
    error.value = i18n.t('containerCreateFailed')
  } finally {
    pending.value = false
  }
}

function handleKeydown(event: KeyboardEvent) {
  if (event.key === 'Escape') {
    event.preventDefault()
    if (!pending.value) emit('close')
  } else if (event.key === 'Tab') {
    const focusable = [
      ...(dialog.value?.querySelectorAll<HTMLElement>(
        'input:not(:disabled), button:not(:disabled)',
      ) ?? []),
    ]
    const first = focusable[0]
    const last = focusable.at(-1)
    if (!first) {
      event.preventDefault()
      dialog.value?.focus()
    } else if (event.shiftKey && document.activeElement === first) {
      event.preventDefault()
      last?.focus()
    } else if (!event.shiftKey && document.activeElement === last) {
      event.preventDefault()
      first.focus()
    }
  }
}

onMounted(async () => {
  previouslyFocused =
    document.activeElement instanceof HTMLElement
      ? document.activeElement
      : null
  await nextTick()
  setTimeout(() => nameInput.value?.focus(), 0)
  choices.value = await supportedContainerChoices()
  if (!choices.value.colors.some((choice) => choice.color === color.value))
    color.value = choices.value.colors[0].color
  if (!choices.value.icons.includes(icon.value))
    icon.value = choices.value.icons[0]
})
onBeforeUnmount(() => {
  void nextTick(() => previouslyFocused?.focus())
})
</script>

<template>
  <div class="create-container-backdrop">
    <form
      ref="dialog"
      class="create-container-modal"
      role="dialog"
      aria-modal="true"
      aria-labelledby="create-container-title"
      tabindex="-1"
      :aria-busy="pending"
      @submit.prevent="submit"
      @keydown.stop="handleKeydown"
    >
      <h2 id="create-container-title">{{ i18n.t('newContainer') }}</h2>
      <label for="container-name">{{ i18n.t('containerName') }}</label>
      <input
        id="container-name"
        ref="nameInput"
        v-model="name"
        :disabled="pending"
        required
        autocomplete="off"
        :aria-invalid="!!error"
        :aria-describedby="error ? 'container-create-error' : undefined"
      />
      <fieldset :disabled="pending">
        <legend>{{ i18n.t('containerColor') }}</legend>
        <div class="container-choices">
          <label
            v-for="choice in choices.colors"
            :key="choice.color"
            class="container-choice"
            :class="{ selected: color === choice.color }"
            :title="choiceLabel('Color', choice.color)"
          >
            <input
              v-model="color"
              type="radio"
              name="container-color"
              :value="choice.color"
              :aria-label="choiceLabel('Color', choice.color)"
            />
            <span
              class="color-swatch"
              :style="{ background: choice.colorCode }"
              aria-hidden="true"
            ></span>
          </label>
        </div>
      </fieldset>
      <fieldset :disabled="pending">
        <legend>{{ i18n.t('containerIcon') }}</legend>
        <div
          class="container-choices"
          :style="{ color: colorCode }"
        >
          <label
            v-for="choice in choices.icons"
            :key="choice"
            class="container-choice"
            :class="{ selected: icon === choice }"
            :title="choiceLabel('Icon', choice)"
          >
            <input
              v-model="icon"
              type="radio"
              name="container-icon"
              :value="choice"
              :aria-label="choiceLabel('Icon', choice)"
            />
            <svg
              viewBox="0 0 32 32"
              aria-hidden="true"
            >
              <use
                :href="`/icons/usercontext.svg#${isKnownFirefoxContainerIcon(choice) ? choice : 'circle'}`"
              />
            </svg>
          </label>
        </div>
      </fieldset>
      <p
        v-if="error"
        id="container-create-error"
        role="alert"
      >
        {{ error }}
      </p>
      <div class="create-container-actions">
        <button
          type="button"
          :disabled="pending"
          @click="emit('close')"
        >
          {{ i18n.t('cancel') }}
        </button>
        <button
          type="submit"
          :disabled="pending || !name.trim()"
        >
          {{ i18n.t('createContainer') }}
        </button>
      </div>
    </form>
  </div>
</template>

<style scoped>
.create-container-backdrop {
  align-items: center;
  background: rgba(0, 0, 0, 0.42);
  display: flex;
  inset: 0;
  justify-content: center;
  padding: 16px;
  position: fixed;
  z-index: 100;
}
.create-container-modal {
  background: var(--background-color-primary);
  border: 1px solid var(--nav-panel-border-color);
  border-radius: 8px;
  color: var(--text-color-primary);
  max-height: calc(100vh - 32px);
  max-width: 440px;
  overflow-y: auto;
  padding: 18px;
  width: 100%;
}
h2 {
  margin: 0 0 18px;
}
#container-name {
  box-sizing: border-box;
  display: block;
  margin: 6px 0 18px;
  width: 100%;
}
fieldset {
  border: 0;
  margin: 0 0 18px;
  padding: 0;
}
legend {
  margin-bottom: 8px;
}
.container-choices {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
}
.container-choice {
  align-items: center;
  border: 2px solid transparent;
  border-radius: 5px;
  cursor: pointer;
  display: flex;
  height: 34px;
  justify-content: center;
  position: relative;
  width: 34px;
}
.container-choice.selected {
  border-color: var(--text-color-primary);
}
.container-choice:has(input:focus-visible) {
  outline: 2px solid var(--text-color-primary);
  outline-offset: 2px;
}
.container-choice input {
  height: 100%;
  inset: 0;
  margin: 0;
  opacity: 0;
  position: absolute;
  width: 100%;
}
.color-swatch {
  border-radius: 50%;
  height: 22px;
  width: 22px;
}
svg {
  fill: currentColor;
  height: 24px;
  width: 24px;
}
.create-container-actions {
  display: flex;
  gap: 8px;
  justify-content: flex-end;
}
#container-create-error {
  color: var(--text-color-primary);
}
</style>
