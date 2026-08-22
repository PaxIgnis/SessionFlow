<script setup lang="ts">
import { computed } from 'vue'
import { isKnownFirefoxContainerIcon } from '@/defaults/container-icons'
import type { FaviconService } from '@/services/favicons'
import { Settings } from '@/services/settings'
import {
  createTreeItemTally,
  formatStateBreakdown,
  formatTallyLines,
  type TreeItemIndentGuideState,
  type TreeItemTally,
} from '@/services/tree-utils'
import type {
  SnapshotNote,
  SnapshotSeparator,
  SnapshotTab,
  SnapshotTreeItem,
  SnapshotWindow,
} from '@/types/session-snapshots'
import { State, TreeItemType } from '@/types/session-tree'

const props = defineProps<{
  item: SnapshotTreeItem
  checked: boolean
  indeterminate: boolean
  collapsed: boolean
  hasChildren: boolean
  childCount: number
  childrenOpen: boolean
  privateItem: boolean
  faviconService: Pick<FaviconService, 'getFavicon'>
  indentGuideState?: TreeItemIndentGuideState
}>()

const emit = defineEmits<{
  select: []
  collapse: []
}>()

function selectItem(event: Event): void {
  ;(event.target as HTMLInputElement).checked = props.checked
  emit('select')
}

function isWindow(item: SnapshotTreeItem): item is SnapshotWindow {
  return item.type === TreeItemType.WINDOW
}

function isTab(item: SnapshotTreeItem): item is SnapshotTab {
  return item.type === TreeItemType.TAB
}

function isNote(item: SnapshotTreeItem): item is SnapshotNote {
  return item.type === TreeItemType.NOTE
}

function isSeparator(item: SnapshotTreeItem): item is SnapshotSeparator {
  return item.type === TreeItemType.SEPARATOR
}

function getTabFavicon(tab: SnapshotTab): string {
  return props.faviconService.getFavicon(tab.url, props.privateItem)
}

function shouldShowVerticalIndentLine(indentLevel: number): boolean {
  return (
    Settings.values.showIndentLinesWithoutChildren ||
    props.indentGuideState?.verticalLevels.includes(indentLevel) === true
  )
}

const dimStateFavicons = computed(
  () => Settings.values.dimUnloadedAndSavedFavicons,
)

const tabGroupIndicator = computed(() => {
  if (!isTab(props.item) || !props.item.tabGroup) return undefined
  if (Settings.values.tabGroupColorIndicator === 'hidden') return undefined
  return {
    color: `var(--tab-group-color-${props.item.tabGroup.color})`,
    position: Settings.values.tabGroupColorIndicator,
    title: props.item.tabGroup.title?.trim() || 'Unnamed tab group',
  }
})

const containerDisplay = computed(() => {
  if (!isTab(props.item) || !props.item.container) return undefined
  return {
    metadata: props.item.container,
    treatment: Settings.values.containerColorIndicator,
    fadeSide: Settings.values.containerFadeSide,
    iconPosition: Settings.values.containerIconPosition,
    knownIcon: isKnownFirefoxContainerIcon(props.item.container.icon),
  }
})

const containerDescriptionId = computed(() =>
  containerDisplay.value
    ? `snapshot-container-description-${props.item.uid}`
    : undefined,
)

const tabGroupDescriptionId = computed(() =>
  isTab(props.item) && props.item.tabGroup
    ? `snapshot-tab-group-description-${props.item.uid}`
    : undefined,
)

const itemDescriptionIds = computed(() => {
  const ids = [
    containerDescriptionId.value,
    tabGroupDescriptionId.value,
  ].filter(Boolean)
  return ids.length > 0 ? ids.join(' ') : undefined
})

const itemHoverDetails = computed(() => {
  if (isWindow(props.item)) return windowHoverDetails.value
  if (!isTab(props.item)) return undefined
  const details: string[] = []
  if (Settings.values.showTabTitleOnHover)
    details.push(`Title: ${props.item.title}`)
  if (Settings.values.showTabUrlOnHover) details.push(`URL: ${props.item.url}`)
  if (
    Settings.values.tabGroupInfoOnHover === 'always' ||
    (Settings.values.tabGroupInfoOnHover === 'grouped-only' &&
      props.item.tabGroup)
  ) {
    details.push(
      `Tab group: ${
        props.item.tabGroup?.title?.trim() ||
        (props.item.tabGroup ? 'Unnamed tab group' : 'None')
      }`,
    )
  }
  if (props.item.container)
    details.push(`Container: ${props.item.container.name}`)
  return details.length > 0 ? details.join('\n') : undefined
})

/* The snapshot tree carries its own item types, so tallyTreeItem cannot be
   handed these children directly; the shape it fills is still the shared one,
   which keeps the summaries worded exactly like the live tree's. */
function tallyWindowChildren(children: SnapshotTreeItem[]): TreeItemTally {
  const tally = createTreeItemTally()
  for (const child of children) {
    if (isTab(child)) {
      tally.tabs++
      if (child.state === State.OPEN) tally.open++
      else if (child.state === State.DISCARDED) tally.unloaded++
      else if (child.state === State.SAVED) tally.saved++
    } else if (isNote(child)) tally.notes++
    else if (isSeparator(child)) tally.separators++
  }
  return tally
}

const windowComposition = computed(() => {
  if (!isWindow(props.item)) return undefined

  const tally = tallyWindowChildren(props.item.children)

  // Summed from the three drawn states rather than tally.tabs, so the number
  // always matches what the bar beside it accounts for.
  const total = tally.open + tally.unloaded + tally.saved
  if (total === 0) return undefined

  return {
    open: tally.open,
    unloaded: tally.unloaded,
    saved: tally.saved,
    total,
    title: formatStateBreakdown(tally),
  }
})

const WINDOW_STATE_LABELS: Partial<Record<State, string>> = {
  [State.OPEN]: 'Open',
  [State.SAVED]: 'Saved',
  [State.DISCARDED]: 'Unloaded',
}

const windowHoverDetails = computed(() => {
  if (!isWindow(props.item)) return undefined

  const tally = tallyWindowChildren(props.item.children)

  const kind = props.item.incognito ? 'Private window' : 'Window'
  const name = props.item.title?.trim()
  const lines = [name ? `${kind}: ${name}` : kind]
  const state = WINDOW_STATE_LABELS[props.item.state]
  if (state) lines.push(`State: ${state}`)

  return [...lines, ...formatTallyLines(tally)].join('\n')
})
</script>

<template>
  <div
    class="tree-item"
    tabindex="-1"
    :class="[
      'indentLevel-' + (item.indentLevel ?? 0),
      {
        'tree-item-selected': checked,
        'tree-item-note': isNote(item),
        'tree-item-state-unloaded':
          dimStateFavicons && isTab(item) && item.state === State.DISCARDED,
        'tree-item-state-saved':
          dimStateFavicons && isTab(item) && item.state === State.SAVED,
        'tree-item-separator': isSeparator(item),
        'tree-item-window': isWindow(item),
        'tree-item-window-private': isWindow(item) && item.incognito,
      },
    ]"
    :style="{ '--indent-level': item.indentLevel ?? 0 }"
    :aria-describedby="itemDescriptionIds"
    :title="itemHoverDetails"
    @click.stop="emit('select')"
  >
    <span class="tree-item-overlay"></span>
    <span class="tree-item-underlay"></span>
    <span
      class="tree-item-root-spine"
      :class="{
        'tree-item-root-spine-branch': (item.indentLevel ?? 0) === 0,
      }"
      aria-hidden="true"
    ></span>
    <span
      v-if="containerDisplay"
      :id="containerDescriptionId"
      class="tree-item-container-description"
    >
      Container: {{ containerDisplay.metadata.name }}
    </span>
    <span
      v-if="isTab(item) && item.tabGroup"
      :id="tabGroupDescriptionId"
      class="tree-item-tab-group-description"
    >
      Tab group: {{ item.tabGroup.title?.trim() || 'Unnamed tab group' }}
    </span>
    <span
      v-if="tabGroupIndicator"
      class="tree-item-tab-group-indicator"
      :class="`tree-item-tab-group-indicator-${tabGroupIndicator.position}`"
      :style="{ backgroundColor: tabGroupIndicator.color }"
      :title="tabGroupIndicator.title"
      :aria-label="tabGroupIndicator.title"
    ></span>
    <span
      v-if="
        containerDisplay &&
        containerDisplay.treatment !== 'off' &&
        containerDisplay.fadeSide === 'right'
      "
      class="tree-item-container-indicator"
      :class="[
        `tree-item-container-indicator-${containerDisplay.treatment}-right`,
        'tree-item-container-fade-end-inset',
        {
          'tree-item-container-fade-title-after-icon':
            containerDisplay.iconPosition === 'left',
        },
      ]"
      :style="{ '--container-color': containerDisplay.metadata.colorCode }"
      aria-hidden="true"
    ></span>
    <div class="tree-item-prepend">
      <div
        v-if="item.indentLevel > 0"
        class="tree-item-indent-lines"
        :style="{
          '--indent-parts':
            item.indentLevel + (isWindow(item) || item.isParent ? 0 : 1),
        }"
      >
        <div
          v-for="i in Math.max(0, (item.indentLevel ?? 0) - 1)"
          :key="i"
          class="tree-item-indent-line"
          :class="
            shouldShowVerticalIndentLine(i)
              ? 'indent-line-vertical'
              : 'indent-line-spacer'
          "
        ></div>
        <div
          class="tree-item-indent-line indent-line-connector"
          :class="{
            'indent-line-connector-terminal':
              !Settings.values.showIndentLinesWithoutChildren &&
              !indentGuideState?.hasFollowingDirectSibling,
          }"
        ></div>
        <div
          v-if="!(isWindow(item) || item.isParent)"
          class="tree-item-indent-line indent-line-end"
        ></div>
      </div>
      <div class="tree-item-action">
        <button
          v-if="isWindow(item) || hasChildren"
          class="tree-item-action-button"
          :class="{
            'tree-item-action-button-counted': collapsed && !isWindow(item),
          }"
          type="button"
          :aria-label="collapsed ? 'Expand item' : 'Collapse item'"
          @click.stop="emit('collapse')"
        >
          <span
            v-if="collapsed && !isWindow(item)"
            class="child-count"
            :class="{ 'tree-item-child-active': childrenOpen }"
            >{{ childCount }}</span
          >
          <svg
            class="collapse-arrow"
            :class="{ collapsed }"
          >
            <use :xlink:href="'#chevron-right'" />
          </svg>
        </button>
        <div
          v-else
          class="tree-item-action-spacer"
        ></div>
      </div>
      <input
        class="snapshot-tree-checkbox"
        type="checkbox"
        :checked="checked"
        :indeterminate="indeterminate"
        :aria-label="`Select ${isWindow(item) ? item.title || 'window' : isTab(item) ? item.customLabel || item.title : isNote(item) ? item.text || 'note' : 'separator'}`"
        @click.stop
        @change.stop="selectItem"
      />
      <span
        v-if="isTab(item)"
        class="tree-item-state-mark"
        :class="{
          'tree-item-state-mark-open': item.state === State.OPEN,
          'tree-item-state-mark-unloaded': item.state === State.DISCARDED,
          'tree-item-state-mark-saved': item.state === State.SAVED,
        }"
        aria-hidden="true"
      ></span>
      <span
        v-if="isTab(item)"
        class="tree-item-favicon-slot"
      >
        <img
          class="tree-item-favicon"
          :src="getTabFavicon(item)"
          alt=""
        />
        <svg
          v-if="item.pinned"
          class="tree-item-pinned"
          aria-hidden="true"
        >
          <use :xlink:href="'#pinned'" />
        </svg>
      </span>
      <div class="tree-item-spacer"></div>
    </div>
    <div class="tree-item-content">
      <template v-if="isWindow(item)">
        <div
          class="tree-item-window-label"
          :class="{
            'tree-item-window-label-private': item.incognito,
            'tree-item-window-label-saved':
              item.state === State.SAVED && !item.incognito,
          }"
          :aria-label="
            item.incognito
              ? `Private window: ${item.title || 'Window'}`
              : item.title || 'Window'
          "
        >
          <img
            class="tree-item-favicon tree-item-window-favicon"
            :src="
              item.incognito ? '/icons/private-browsing.svg' : '/icon/16.png'
            "
            alt=""
          />
          <div
            class="tree-item-title"
            :class="{
              'tree-item-text-open': item.state === State.OPEN,
              'tree-item-text-saved': item.state === State.SAVED,
              'tree-item-text-discarded': item.state === State.DISCARDED,
            }"
          >
            {{ item.title || 'Window' }}
          </div>
          <span
            v-if="item.incognito"
            class="tree-item-window-private-badge"
          >
            Private
          </span>
        </div>
      </template>
      <template v-else-if="isTab(item)">
        <div class="tree-item-tab-content">
          <span
            v-if="
              containerDisplay &&
              containerDisplay.treatment !== 'off' &&
              containerDisplay.fadeSide === 'left'
            "
            class="tree-item-container-indicator"
            :class="[
              `tree-item-container-indicator-${containerDisplay.treatment}-left`,
              {
                'tree-item-container-fade-start-after-icon':
                  containerDisplay.iconPosition === 'left',
              },
            ]"
            :style="{
              '--container-color': containerDisplay.metadata.colorCode,
            }"
            aria-hidden="true"
          ></span>
          <span
            v-if="containerDisplay?.iconPosition === 'left'"
            class="tree-item-container-icon tree-item-container-icon-left"
            :style="{ color: containerDisplay.metadata.colorCode }"
            aria-hidden="true"
          >
            <svg
              v-if="containerDisplay.knownIcon"
              viewBox="0 0 32 32"
              aria-hidden="true"
            >
              <use
                :href="`/icons/usercontext.svg#${containerDisplay.metadata.icon}`"
              />
            </svg>
            <span
              v-else
              class="tree-item-container-icon-fallback"
              aria-hidden="true"
            ></span>
          </span>
          <div
            class="tree-item-title"
            :class="{
              'tree-item-text-open': item.state === State.OPEN,
              'tree-item-text-saved': item.state === State.SAVED,
              'tree-item-text-discarded': item.state === State.DISCARDED,
            }"
          >
            <template v-if="item.customLabel">
              <span class="tree-item-custom-label">{{ item.customLabel }}</span>
              <span class="tree-item-custom-label-separator"> ~ </span>
            </template>
            <span>{{ item.title }}</span>
          </div>
          <span
            v-if="containerDisplay?.iconPosition === 'right'"
            class="tree-item-container-icon tree-item-container-icon-right"
            :style="{ color: containerDisplay.metadata.colorCode }"
            aria-hidden="true"
          >
            <svg
              v-if="containerDisplay.knownIcon"
              viewBox="0 0 32 32"
              aria-hidden="true"
            >
              <use
                :href="`/icons/usercontext.svg#${containerDisplay.metadata.icon}`"
              />
            </svg>
            <span
              v-else
              class="tree-item-container-icon-fallback"
              aria-hidden="true"
            ></span>
          </span>
        </div>
      </template>
      <template v-else-if="isNote(item)">
        <div class="tree-item-title tree-item-note-text">{{ item.text }}</div>
      </template>
      <template v-else-if="isSeparator(item)">
        <div
          class="tree-item-separator-line"
          aria-label="Separator"
        ></div>
      </template>
    </div>
    <div
      v-if="windowComposition"
      class="tree-item-window-meta"
    >
      <span
        class="tree-item-composition"
        role="img"
        :aria-label="windowComposition.title"
      >
        <i
          v-if="windowComposition.open"
          class="tree-item-composition-open"
          :style="{ flexGrow: windowComposition.open }"
        ></i>
        <i
          v-if="windowComposition.unloaded"
          class="tree-item-composition-unloaded"
          :style="{ flexGrow: windowComposition.unloaded }"
        ></i>
        <i
          v-if="windowComposition.saved"
          class="tree-item-composition-saved"
          :style="{ flexGrow: windowComposition.saved }"
        ></i>
      </span>
      <span
        class="tree-item-window-count"
        :class="{ 'tree-item-child-active': childrenOpen }"
        >{{ windowComposition.total }}</span
      >
    </div>
  </div>
</template>

<style scoped>
.tree-item {
  --tree-item-title-start: calc(
    81px + var(--tree-root-step) +
      (var(--prepend-width, 16px) * var(--indent-level, 0))
  );
  align-items: center;
  position: relative;
  display: grid;
  grid-template-areas: 'prepend content append';
  grid-template-columns: max-content 1fr auto;
  outline: none;
  max-width: 100%;
  padding: 1px 16px;
  text-decoration: none;
  box-sizing: border-box;
  min-height: max(20px, calc(var(--font-size-xs) + 7px));
  --tree-item-backdrop: var(--tree-background);
  background: transparent;
  color: inherit;
  padding-inline-start: calc(
    16px + var(--tree-root-step) +
      (var(--prepend-width, 16px) * var(--indent-level, 0))
  ) !important;
  user-select: none;
}

*,
*::before,
*::after {
  box-sizing: border-box;
}

.tree-item-overlay {
  border-radius: inherit;
  inset: 0;
  opacity: 0;
  pointer-events: none;
  position: absolute;
}

.tree-item:not(.tree-item-selected):hover > .tree-item-overlay {
  background: var(--list-item-hover-background);
  opacity: 1;
}

.tree-item-selected > .tree-item-overlay {
  background: var(--list-item-selected-background, rgba(0, 102, 255, 0.12));
  opacity: 1;
}

.tree-item-underlay {
  position: absolute;
}

.tree-item-state-mark {
  flex: 0 0 8px;
  height: 8px;
  margin-inline-end: 3px;
  position: relative;
  width: 8px;
  z-index: 2;
}

.tree-item-state-mark::after {
  border-radius: 50%;
  content: '';
  left: 50%;
  position: absolute;
  top: 50%;
  translate: -50% -50%;
}

.tree-item-state-mark-open::after {
  background: var(--state-live);
  height: 5px;
  width: 5px;
}

.tree-item-state-mark-unloaded::after {
  border: 1px solid color-mix(in srgb, var(--state-live) 70%, transparent);
  height: 5px;
  width: 5px;
}

.tree-item-state-mark-saved::after {
  background: var(--state-rest);
  height: 4px;
  width: 4px;
}

.tree-item-state-unloaded .tree-item-favicon {
  opacity: 0.62;
}

.tree-item-state-saved .tree-item-favicon {
  filter: grayscale(1);
  opacity: 0.5;
}

.tree-item-root-spine {
  border-inline-start: 1px solid var(--list-indent-guide-stroke);
  bottom: 0;
  inset-inline-start: 8px;
  opacity: 0.4;
  pointer-events: none;
  position: absolute;
  top: 0;
  width: var(--tree-root-step);
}

.tree-item-root-spine-branch::before {
  border-bottom: 1px solid var(--list-indent-guide-stroke);
  content: '';
  inset-inline-start: 0;
  position: absolute;
  top: 50%;
  width: 100%;
}

.tree-item-tab-group-indicator {
  position: absolute;
  z-index: 3;
  top: 2px;
  bottom: 2px;
  width: 3px;
  border-radius: 2px;
}
.tree-item-tab-group-indicator-right {
  right: 1px;
}
.tree-item-tab-group-indicator-left {
  left: 1px;
}

.tree-item-container-indicator {
  pointer-events: none;
  position: absolute;
  z-index: 0;
}
.tree-item-container-indicator-soft-fade-right,
.tree-item-container-indicator-strong-fade-right {
  bottom: 2px;
  left: var(--tree-item-title-start);
  top: 2px;
}
.tree-item-container-fade-title-after-icon {
  left: calc(var(--tree-item-title-start) + 18px);
}
.tree-item-container-indicator-soft-fade-left,
.tree-item-container-indicator-strong-fade-left {
  bottom: 2px;
  left: 0;
  right: 48%;
  top: 2px;
}
.tree-item-container-indicator-soft-fade-left {
  background: linear-gradient(
    to right,
    color-mix(in srgb, var(--container-color) 28%, transparent),
    transparent
  );
}
.tree-item-container-indicator-strong-fade-left {
  background: linear-gradient(
    to right,
    color-mix(in srgb, var(--container-color) 48%, transparent),
    transparent
  );
}
.tree-item-container-fade-start-after-icon {
  left: 18px;
}
.tree-item-container-indicator-soft-fade-right {
  background: linear-gradient(
    to right,
    transparent 48%,
    color-mix(in srgb, var(--container-color) 28%, transparent)
  );
}
.tree-item-container-indicator-strong-fade-right {
  background: linear-gradient(
    to right,
    transparent 48%,
    color-mix(in srgb, var(--container-color) 48%, transparent)
  );
}
.tree-item-container-fade-end-inset {
  right: 8px;
}

.tree-item-window-meta {
  align-items: center;
  align-self: center;
  display: flex;
  gap: 7px;
  grid-area: append;
  padding-inline-start: 8px;
  position: relative;
  z-index: 2;
}

.tree-item-composition {
  background: rgba(255, 255, 255, 0.06);
  border-radius: 2px;
  display: flex;
  gap: 1px;
  height: 3px;
  overflow: hidden;
  width: 46px;
}

.tree-item-composition-open {
  background: var(--state-live);
}

.tree-item-composition-unloaded {
  background: color-mix(in srgb, var(--state-live) 45%, transparent);
}

.tree-item-composition-saved {
  background: color-mix(in srgb, var(--state-rest) 62%, transparent);
}

.tree-item-window-count {
  color: var(--list-item-discarded-foreground);
  font-family: var(--font-mono);
  font-size: var(--font-size-2xs);
  font-variant-numeric: tabular-nums;
  font-weight: 600;
  min-width: 17px;
  text-align: end;
}

.tree-item-content {
  align-self: center;
  grid-area: content;
  overflow: hidden;
  min-width: 40px;
  max-height: none;
}
.tree-item-tab-content {
  align-items: center;
  display: flex;
  gap: 4px;
  min-width: 0;
  position: relative;
  width: 100%;
}
.tree-item-container-icon {
  align-items: center;
  display: inline-flex;
  flex: 0 0 14px;
  height: 14px;
  justify-content: center;
  position: relative;
  width: 14px;
  z-index: 2;
}
.tree-item-container-icon svg {
  fill: currentColor;
  height: 100%;
  width: 100%;
}
.tree-item-container-icon-fallback {
  background: currentColor;
  border-radius: 50%;
  height: 8px;
  width: 8px;
}
.tree-item-tab-content > .tree-item-title {
  flex: 1 1 auto;
  min-width: 0;
  z-index: 2;
}
.tree-item-container-description,
.tree-item-tab-group-description {
  clip: rect(0 0 0 0);
  clip-path: inset(50%);
  height: 1px;
  overflow: hidden;
  position: absolute;
  white-space: nowrap;
  width: 1px;
}

.tree-item-prepend {
  align-items: center;
  align-self: center;
  display: flex;
  grid-area: prepend;
  height: 100%;
  min-width: 65px;
}
.tree-item-window .tree-item-prepend {
  min-width: 47px;
}
.tree-item-note .tree-item-prepend {
  min-width: 43px;
}
.tree-item-indent-lines {
  position: absolute;
  inset-inline-start: var(--tree-root-step);
  height: 100%;
  display: grid;
  padding-inline-start: 8px;
  padding-block: 0;
  grid-template-columns: repeat(var(--indent-parts, 1), var(--prepend-width));
  opacity: 0.4;
  pointer-events: none;
}
.tree-item-indent-line,
.tree-item-indent-line::before {
  border: 0 solid var(--list-indent-guide-stroke);
}
.tree-item-action {
  margin-inline-end: 4px;
  margin-inline-start: -7px;
  align-self: center;
  display: flex;
  align-items: center;
  flex: 0 0 16px;
  justify-content: center;
  width: 16px;
}
.tree-item-action-button {
  align-items: center;
  border: 0;
  padding: 0;
  background: transparent;
  cursor: pointer;
  display: flex;
  position: relative;
}
.tree-item-action-button-counted {
  display: grid;
  place-items: center;
  width: 16px;
}
.tree-item-action-button-counted > * {
  grid-area: 1 / 1;
}
.tree-item-action-button-counted .collapse-arrow {
  margin: 0;
  visibility: hidden;
}
.tree-item:hover .tree-item-action-button-counted .child-count {
  visibility: hidden;
}
.tree-item:hover .tree-item-action-button-counted .collapse-arrow {
  visibility: visible;
}
.tree-item-action-spacer {
  width: 16px;
}
.collapse-arrow {
  display: inline-block;
  width: 12px;
  height: 12px;
  cursor: pointer;
  user-select: none;
  transition: transform 0.2s linear;
  margin-right: 3px;
  margin-left: 1px;
  position: relative;
  stroke: var(--list-icon-foreground);
  transform: rotate(90deg);
}
.collapse-arrow.collapsed {
  transform: rotate(0deg);
}
.indent-line-connector::before {
  content: '';
  position: absolute;
  border-bottom-width: 1px;
  height: calc(50% + 1px);
  width: 100%;
}
.indent-line-vertical,
.indent-line-spacer,
.indent-line-connector {
  border-inline-start-width: 1px;
  height: 100%;
  width: calc(50% + 1px);
  justify-self: end;
}
.indent-line-spacer {
  border-inline-start-width: 0;
}
.indent-line-connector {
  position: relative;
}
.indent-line-connector-terminal {
  border-inline-start-width: 0;
}
.indent-line-connector-terminal::before {
  border-inline-start-width: 1px;
  border-end-start-radius: 4px;
  width: calc(100% + 1px);
}
.indent-line-end {
  border-bottom-width: 1px;
  height: calc(50% + 1px);
  margin-inline-end: 0;
  margin-inline-start: 0;
  width: calc(40% + 1px);
}
.snapshot-tree-checkbox {
  flex: 0 0 auto;
  width: 13px;
  height: 13px;
  margin: 0 12px 0 -2px;
  accent-color: var(--button-active-background);
  z-index: 2;
}
.tree-item-favicon {
  align-items: center;
  display: inline-flex;
  justify-content: center;
  position: relative;
  user-select: none;
  line-height: 1;
  min-width: 1em;
  height: 1em;
  width: 1em;
}
.tree-item-prepend .tree-item-favicon {
  margin-inline-end: 2px;
}
.tree-item-window-label {
  align-items: center;
  background: var(--window-item-background);
  border: 1px solid var(--window-item-border);
  border-radius: 4px;
  display: inline-flex;
  gap: 5px;
  max-width: 100%;
  min-width: 0;
  padding: 0 6px 0 4px;
  position: relative;
  z-index: 2;
}
.tree-item-window-label-saved {
  background: color-mix(in srgb, var(--state-rest) 13%, transparent);
  border-color: color-mix(in srgb, var(--state-rest) 58%, transparent);
  border-style: dashed;
}
.tree-item-window-label-private {
  background: var(--private-window-item-background);
  border-color: var(--private-window-item-border);
  padding-inline-start: 6px;
}
.tree-item-window-favicon {
  flex: 0 0 auto;
}
.tree-item-window-label .tree-item-title {
  flex: 0 1 auto;
  min-width: 0;
}
.tree-item-window-private-badge {
  color: var(--private-window-item-foreground);
  flex: 0 0 auto;
  font-family: var(--font-family-session-tree);
  font-size: var(--font-size-xxs);
  font-weight: 700;
  letter-spacing: 0.02em;
  line-height: 1;
  text-transform: uppercase;
}
.tree-item-favicon-slot {
  align-items: center;
  display: inline-flex;
  flex: 0 0 auto;
  justify-content: center;
  position: relative;
  z-index: 2;
}
.tree-item-pinned {
  bottom: -4px;
  fill: var(--list-item-open-foreground);
  filter: drop-shadow(0 0 1.2px rgb(10, 12, 16))
    drop-shadow(0 0 1.2px rgb(10, 12, 16))
    drop-shadow(0 0 1.2px rgb(10, 12, 16));
  height: 11px;
  inset-inline-start: -5px;
  pointer-events: none;
  position: absolute;
  user-select: none;
  width: 11px;
}
.tree-item-title {
  display: block;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
  font-size: var(--font-size-xs);
  min-height: 15px;
  padding-top: 1px;
  font-family: var(--font-family-session-tree);
  position: relative;
  z-index: 0;
}
.tree-item-custom-label,
.tree-item-custom-label-separator {
  color: var(--list-item-custom-label-foreground);
}
.tree-item-text-open {
  color: var(--list-item-open-foreground);
}
.tree-item-text-saved {
  color: var(--list-item-saved-foreground);
}
.tree-item-text-discarded {
  color: var(--list-item-discarded-foreground);
}
.child-count {
  color: var(--list-item-discarded-foreground);
  font-family: var(--font-mono);
  font-size: var(--font-size-2xs);
  font-variant-numeric: tabular-nums;
  font-weight: 600;
  cursor: pointer;
  line-height: 1;
  overflow: visible;
  position: relative;
  text-align: center;
  user-select: none;
  white-space: nowrap;
  width: 16px;
  z-index: 2;
}
.tree-item-child-active {
  color: var(--list-item-child-open-foreground) !important;
}
.tree-item-note-text {
  color: var(--note-text-foreground);
  font-style: normal;
  font-weight: 700;
  letter-spacing: 0.01em;
}
.tree-item-note-text::before {
  background: currentColor;
  border-radius: 1px;
  content: '';
  display: inline-block;
  height: 11px;
  margin-inline-end: 7px;
  vertical-align: -2px;
  width: 2px;
}
.tree-item-separator.indentLevel-0 {
  padding-inline-end: 0 !important;
  padding-inline-start: calc(8px + var(--tree-root-step)) !important;
}
.tree-item-separator .tree-item-prepend {
  min-width: 0;
  overflow: visible;
  width: 38px;
}
.tree-item-separator .tree-item-spacer {
  display: none;
}
.tree-item-separator .tree-item-content {
  align-self: stretch;
  max-height: none;
}
.tree-item-separator-line {
  border: 0 solid var(--list-indent-guide-stroke);
  border-bottom-width: 1px;
  height: calc(50% + 1px);
  opacity: 0.4;
  position: relative;
  z-index: 1;
  width: 100%;
}
</style>
