<script setup lang="ts">
import { computed, ref } from 'vue'
import { buildIndentGuideStates } from '@/services/tree-utils'
import type {
  OnboardingExampleItem,
  ExampleWindowComposition,
} from '@/types/onboarding-demo'
import OnboardingTreeRow from './OnboardingTreeRow.vue'

const props = defineProps<{ items: OnboardingExampleItem[] }>()
const emit = defineEmits<{
  activate: [id: string]
  save: [id: string]
  close: [id: string]
  select: [id: string, event: MouseEvent | KeyboardEvent]
  contextMenu: [id: string, event: MouseEvent]
  collapse: [id: string, collapsed: boolean]
}>()
const collapseOverrides = ref<Record<string, boolean>>({})
function toggle(id: string, collapsed: boolean) {
  collapseOverrides.value[id] = !collapsed
  emit('collapse', id, !collapsed)
}
const rows = computed(() => {
  const ancestors: { uid: UID; hidden: boolean; collapsed: boolean }[] = []
  return props.items.map((item, index) => {
    const collapsed =
      collapseOverrides.value[item.id] ?? item.collapsed ?? false
    const parent = ancestors[item.indentLevel - 1]
    const hidden = parent?.hidden === true || parent?.collapsed === true
    ancestors.length = item.indentLevel
    ancestors.push({ uid: item.id as UID, hidden, collapsed })
    const descendants: OnboardingExampleItem[] = []
    for (let next = index + 1; next < props.items.length; next++) {
      if (props.items[next].indentLevel <= item.indentLevel) break
      descendants.push(props.items[next])
    }
    const composition: ExampleWindowComposition = {
      open: 0,
      unloaded: 0,
      saved: 0,
    }
    for (const child of descendants) {
      if (child.kind !== 'tab') continue
      if (child.state === 'saved') composition.saved++
      else if (child.state === 'unloaded') composition.unloaded++
      else composition.open++
    }
    return {
      item,
      uid: item.id as UID,
      parentUid: parent?.uid,
      indentLevel: item.indentLevel,
      isVisible: !hidden,
      collapsed,
      branch: descendants.length > 0,
      childCount: descendants.length,
      childrenOpen: composition.open > 0 || composition.unloaded > 0,
      hidesFocus:
        collapsed && descendants.some((child) => child.state === 'active'),
      active:
        item.state === 'active' ||
        (item.kind === 'window' &&
          descendants.some((child) => child.state === 'active')),
      composition: item.kind === 'window' ? composition : undefined,
    }
  })
})
const guides = computed(() => buildIndentGuideStates(rows.value))
</script>

<template>
  <div class="onboarding-tree-preview">
    <template
      v-for="row in rows"
      :key="row.item.id"
    >
      <OnboardingTreeRow
        v-if="row.isVisible"
        :item="row.item"
        :branch="row.branch"
        :collapsed="row.collapsed"
        :child-count="row.childCount"
        :guide="guides.get(row.uid)"
        :composition="row.composition"
        :children-open="row.childrenOpen"
        :hides-focus="row.hidesFocus"
        :active="row.active"
        @toggle="toggle(row.item.id, row.collapsed)"
        @activate="$emit('activate', row.item.id)"
        @save="$emit('save', row.item.id)"
        @close="$emit('close', row.item.id)"
        @select="$emit('select', row.item.id, $event)"
        @context-menu="$emit('contextMenu', row.item.id, $event)"
      />
    </template>
  </div>
</template>

<style scoped>
.onboarding-tree-preview {
  font: 1rem var(--font-family-session-tree);
  color: var(--list-item-open-foreground);
  background: var(--tree-background);
  padding: 4px 0;
}
</style>
