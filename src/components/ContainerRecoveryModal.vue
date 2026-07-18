<script lang="ts" setup>
import { isKnownFirefoxContainerIcon } from '@/defaults/container-icons'
import type { ContainerMetadata } from '@/types/session-tree'
import { computed, nextTick, onBeforeUnmount, onMounted, ref } from 'vue'

const props = defineProps<{
  containers: ContainerMetadata[]
  pending?: boolean
}>()
const emit = defineEmits<{
  recreate: []
  withoutContainer: []
  cancel: []
}>()

const plural = computed(() => props.containers.length > 1)
const dialog = ref<HTMLElement>()
let previouslyFocused: HTMLElement | null = null

onMounted(async () => {
  previouslyFocused =
    document.activeElement instanceof HTMLElement
      ? document.activeElement
      : null
  await nextTick()
  const firstAction = dialog.value?.querySelector<HTMLElement>(
    'button:not([disabled])',
  )
  ;(firstAction ?? dialog.value)?.focus()
})

onBeforeUnmount(() => {
  previouslyFocused?.focus()
})

function handleDialogKeydown(event: KeyboardEvent): void {
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
  <div class="container-recovery-backdrop">
    <section
      ref="dialog"
      class="container-recovery-modal"
      role="dialog"
      aria-modal="true"
      aria-labelledby="container-recovery-title"
      tabindex="-1"
      @keydown="handleDialogKeydown"
    >
      <h2 id="container-recovery-title">
        {{
          plural ? 'Containers No Longer Exist' : 'Container No Longer Exists'
        }}
      </h2>
      <p>
        Session Flow cannot open this item in its saved
        {{ plural ? 'containers' : 'container' }}.
      </p>
      <ul>
        <li
          v-for="container in containers"
          :key="container.cookieStoreId"
          :style="{ '--container-color': container.colorCode }"
        >
          <span
            class="container-recovery-icon"
            aria-hidden="true"
          >
            <svg
              v-if="isKnownFirefoxContainerIcon(container.icon)"
              viewBox="0 0 32 32"
            >
              <use :href="`/icons/usercontext.svg#${container.icon}`" />
            </svg>
            <span v-else></span>
          </span>
          {{ container.name }}
        </li>
      </ul>
      <p>
        Recreating creates a new empty container. Its cookies and signed-in
        sessions cannot be recovered.
      </p>
      <div class="container-recovery-actions">
        <button
          :disabled="pending"
          @click="$emit('recreate')"
        >
          {{
            plural
              ? 'Recreate Missing Containers and Open'
              : 'Recreate Container and Open'
          }}
        </button>
        <button
          :disabled="pending"
          @click="$emit('withoutContainer')"
        >
          {{
            plural
              ? 'Open Without Missing Containers'
              : 'Open Without Container'
          }}
        </button>
        <button
          :disabled="pending"
          @click="$emit('cancel')"
        >
          Cancel
        </button>
      </div>
    </section>
  </div>
</template>

<style scoped>
.container-recovery-backdrop {
  align-items: center;
  background: rgba(0, 0, 0, 0.42);
  display: flex;
  inset: 0;
  justify-content: center;
  padding: 16px;
  position: fixed;
  z-index: 100;
}

.container-recovery-modal {
  background: var(--background-color-primary);
  border: 1px solid var(--nav-panel-border-color);
  border-radius: 8px;
  color: var(--text-color-primary);
  max-width: 480px;
  padding: 18px;
  width: 100%;
}

.container-recovery-icon {
  align-items: center;
  color: var(--container-color);
  display: inline-flex;
  height: 14px;
  justify-content: center;
  margin-right: 7px;
  vertical-align: text-bottom;
  width: 14px;
}

.container-recovery-icon svg {
  fill: currentColor;
  height: 100%;
  width: 100%;
}

.container-recovery-icon > span {
  background: currentColor;
  border-radius: 50%;
  height: 9px;
  width: 9px;
}

.container-recovery-actions {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
  justify-content: flex-end;
}
</style>
