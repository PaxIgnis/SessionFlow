<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import IconChevronRight from '@/assets/chevron-right.svg'
import IconPinned from '@/assets/pinned.svg'
import type { FaviconService } from '@/services/favicons'
import {
  buildSnapshotLocationIndex,
  cycleSnapshotSelection,
  flattenSnapshotItems,
  snapshotDescendantItems,
  snapshotSelectionStates,
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

const locations = computed(() => buildSnapshotLocationIndex(props.payload))

// Resolved for every visible row in one pass.
const selectionStates = computed(() =>
  snapshotSelectionStates(
    props.payload,
    selected.value,
    rows.value.map((row) => row.item.uid),
  ),
)

// Per-row facts the template used to recompute inline.
const rowMeta = computed(() => {
  const parentUids = new Set<string>()
  const collectParents = (items: readonly SnapshotItem[]) => {
    for (const item of items) if (item.parentUid) parentUids.add(item.parentUid)
  }
  collectParents(props.payload.items)
  for (const item of props.payload.items) {
    if (item.type === TreeItemType.WINDOW) collectParents(item.children)
  }

  const meta = new Map<
    string,
    { hasChildren: boolean; childCount: number; childrenOpen: boolean }
  >()
  for (const row of rows.value) {
    const item = row.item
    const descendants = snapshotDescendantItems(
      props.payload,
      item,
      locations.value,
    )
    meta.set(item.uid, {
      hasChildren:
        item.type === TreeItemType.WINDOW
          ? item.children.length > 0
          : parentUids.has(item.uid),
      childCount: descendants.length,
      childrenOpen: descendants.some(
        (candidate) =>
          candidate.type === TreeItemType.TAB &&
          (candidate.state === State.OPEN ||
            candidate.state === State.DISCARDED),
      ),
    })
  }
  return meta
})

const EMPTY_META = { hasChildren: false, childCount: 0, childrenOpen: false }

function meta(uid: string) {
  return rowMeta.value.get(uid) ?? EMPTY_META
}

function selectionState(uid: string) {
  return (
    selectionStates.value.get(uid) ?? { checked: false, indeterminate: false }
  )
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
      :has-children="meta(row.item.uid).hasChildren"
      :child-count="meta(row.item.uid).childCount"
      :children-open="meta(row.item.uid).childrenOpen"
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
