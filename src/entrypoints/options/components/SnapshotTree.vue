<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import IconChevronRight from '@/assets/chevron-right.svg'
import IconPinned from '@/assets/pinned.svg'
import type { FaviconService } from '@/services/favicons'
import {
  cycleSnapshotSelection,
  flattenSnapshotItems,
  snapshotDescendantItems,
  snapshotSelectionState,
  type SnapshotVisibleRow,
} from '@/services/session-snapshot-selection'
import {
  buildIndentGuideStates,
  type TreeItemIndentGuideState,
} from '@/services/tree-utils'
import type {
  SessionSnapshotPayload,
  SnapshotTreeItem as SnapshotItem,
  SnapshotWindow,
} from '@/types/session-snapshots'
import { State, TreeItemType } from '@/types/session-tree'
import SnapshotTreeItem from './SnapshotTreeItem.vue'

const props = defineProps<{
  payload: SessionSnapshotPayload
  faviconService: Pick<FaviconService, 'getFavicon'>
}>()
const emit = defineEmits<{ selectionChange: [uids: string[]] }>()
const selected = ref(new Set<string>())
const collapsed = ref(new Set<string>())

watch(
  () => props.payload,
  (payload) => {
    selected.value = new Set()
    collapsed.value = new Set(
      payload.items.flatMap((item) => {
        const items =
          item.type === TreeItemType.WINDOW ? [item, ...item.children] : [item]
        return items
          .filter((candidate) => candidate.collapsed)
          .map((candidate) => candidate.uid)
      }),
    )
    emit('selectionChange', [])
  },
  { immediate: true },
)

const rows = computed(() =>
  flattenSnapshotItems(props.payload, collapsed.value),
)

const indentGuideStates = computed(() => {
  const topLevelStates = buildIndentGuideStates(props.payload.items)
  const states = new Map<string, TreeItemIndentGuideState>(topLevelStates)
  for (const item of props.payload.items) {
    if (item.type !== TreeItemType.WINDOW) continue
    const windowIndent = item.indentLevel ?? 0
    const windowState = topLevelStates.get(item.uid)
    const childStates = buildIndentGuideStates(item.children)
    for (const [uid, childState] of childStates) {
      states.set(uid, {
        verticalLevels: [
          ...(windowState?.verticalLevels.filter(
            (level) => level <= windowIndent,
          ) ?? []),
          ...(windowState?.hasFollowingAtSameLevel ? [windowIndent] : []),
          ...childState.verticalLevels.filter((level) => level > windowIndent),
        ],
        hasFollowingAtSameLevel: childState.hasFollowingAtSameLevel,
        hasFollowingDirectSibling: childState.hasFollowingDirectSibling,
      })
    }
  }
  return states
})

function selectionState(uid: string) {
  return snapshotSelectionState(props.payload, selected.value, uid)
}

function select(uid: string) {
  selected.value = cycleSnapshotSelection(props.payload, selected.value, uid)
  emit('selectionChange', [...selected.value])
}

function toggleCollapse(uid: string) {
  const next = new Set(collapsed.value)
  if (next.has(uid)) next.delete(uid)
  else next.add(uid)
  collapsed.value = next
}

function containingWindow(row: SnapshotVisibleRow): SnapshotWindow | undefined {
  if (row.item.type === TreeItemType.WINDOW) return row.item
  return props.payload.items.find(
    (item): item is SnapshotWindow =>
      item.type === TreeItemType.WINDOW && item.uid === row.containingWindowUid,
  )
}

function containingItems(item: SnapshotItem): readonly SnapshotItem[] {
  const window = props.payload.items.find(
    (candidate): candidate is SnapshotWindow =>
      candidate.type === TreeItemType.WINDOW &&
      candidate.children.some((child) => child.uid === item.uid),
  )
  return window?.children ?? props.payload.items
}

function hasChildren(item: SnapshotItem): boolean {
  if (item.type === TreeItemType.WINDOW) return item.children.length > 0
  return containingItems(item).some(
    (candidate) => candidate.parentUid === item.uid,
  )
}

function descendantItems(item: SnapshotItem): SnapshotItem[] {
  return snapshotDescendantItems(props.payload, item)
}

function childrenOpen(item: SnapshotItem): boolean {
  return descendantItems(item).some(
    (candidate) =>
      candidate.type === TreeItemType.TAB &&
      (candidate.state === State.OPEN || candidate.state === State.DISCARDED),
  )
}
</script>

<template>
  <div class="snapshot-tree">
    <div
      class="hiddenAssets"
      aria-hidden="true"
    >
      <svg>
        <use :xlink:href="`#${IconChevronRight}`" />
        <use :xlink:href="`#${IconPinned}`" />
      </svg>
    </div>
    <SnapshotTreeItem
      v-for="row in rows"
      :key="row.item.uid"
      :item="row.item"
      :checked="selectionState(row.item.uid).checked"
      :indeterminate="selectionState(row.item.uid).indeterminate"
      :collapsed="collapsed.has(row.item.uid)"
      :has-children="hasChildren(row.item)"
      :child-count="descendantItems(row.item).length"
      :children-open="childrenOpen(row.item)"
      :private-item="containingWindow(row)?.incognito === true"
      :favicon-service="faviconService"
      :indent-guide-state="indentGuideStates.get(row.item.uid)"
      @select="select(row.item.uid)"
      @collapse="toggleCollapse(row.item.uid)"
    />
  </div>
</template>

<style scoped>
.snapshot-tree {
  flex: 1 1 auto;
  min-height: 0;
  height: auto;
  overflow: auto;
  border: 1px solid var(--options-list-divider-color);
  border-radius: 5px;
  background: var(--background-color-primary);
  color: var(--text-color-primary);
}
.hiddenAssets {
  display: none;
}
</style>
