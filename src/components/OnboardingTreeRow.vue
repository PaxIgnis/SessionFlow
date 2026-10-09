<script setup lang="ts">
import { i18n } from '@/services/i18n'
import { computed } from 'vue'
import { isKnownFirefoxContainerIcon } from '@/defaults/container-icons'
import { Settings } from '@/services/settings'
import IconChevronRight from '@/assets/chevron-right.svg'
import type { TreeItemIndentGuideState } from '@/services/tree-utils'
import type {
  OnboardingExampleItem,
  ExampleWindowComposition,
} from '@/types/onboarding-demo'

const props = defineProps<{
  item: OnboardingExampleItem
  branch: boolean
  collapsed: boolean
  childCount: number
  guide?: TreeItemIndentGuideState
  composition?: ExampleWindowComposition
  childrenOpen: boolean
  hidesFocus: boolean
  active: boolean
}>()
const emit = defineEmits<{
  activate: []
  save: []
  close: []
  toggle: []
  select: [event: MouseEvent | KeyboardEvent]
  contextMenu: [event: MouseEvent]
}>()
function contextMenu(event: MouseEvent) {
  if (props.item.selected === undefined && !props.item.contextMenu) return
  event.preventDefault()
  emit('contextMenu', event)
}
const container = computed(() => props.item.container)
const group = computed(() => props.item.tabGroup)
const details = computed(
  () =>
    [
      group.value
        ? i18n.t('tabGroupDetail', [
            group.value.title || i18n.t('unnamedTabGroup'),
          ])
        : '',
      container.value ? i18n.t('containerDetail', [container.value.name]) : '',
    ]
      .filter(Boolean)
      .join('\n') || undefined,
)
</script>

<template>
  <div
    class="tree-item"
    :class="[
      `indentLevel-${item.indentLevel}`,
      item.drop ? `drag-over-${item.drop}` : '',
      {
        'tree-item-active': active,
        'tree-item-selected': item.selected === true,
        'tree-item-active-latest-tab':
          item.kind === 'tab' && item.state === 'active',
        'tree-item-state-unloaded':
          item.state === 'unloaded' &&
          Settings.values.dimUnloadedAndSavedFavicons,
        'tree-item-state-saved':
          item.state === 'saved' && Settings.values.dimUnloadedAndSavedFavicons,
        'tree-item-window': item.kind === 'window',
        'tree-item-note': item.kind === 'note',
        'tree-item-separator': item.kind === 'separator',
        'example-actions-visible': item.showActions,
      },
    ]"
    :style="{ '--indent-level': item.indentLevel }"
    :data-example-id="item.id"
    :data-state="item.state"
    :title="details"
    :tabindex="item.selected !== undefined || item.contextMenu ? 0 : undefined"
    @click="$emit('select', $event)"
    @keydown.enter.self.prevent="$emit('select', $event)"
    @contextmenu="contextMenu"
    @dblclick="$emit('activate')"
  >
    <span class="tree-item-overlay"></span>
    <span class="tree-item-underlay"></span>
    <span
      v-if="group && Settings.values.tabGroupColorIndicator !== 'hidden'"
      class="tree-item-tab-group-indicator"
      :class="`tree-item-tab-group-indicator-${Settings.values.tabGroupColorIndicator}`"
      :style="{ backgroundColor: `var(--tab-group-color-${group.color})` }"
      :title="group.title"
      aria-hidden="true"
    ></span>
    <span
      v-if="
        container &&
        Settings.values.containerColorIndicator !== 'off' &&
        Settings.values.containerFadeSide === 'right'
      "
      class="tree-item-container-indicator"
      :class="[
        `tree-item-container-indicator-${Settings.values.containerColorIndicator}-${Settings.values.containerFadeSide}`,
        {
          'tree-item-container-fade-end-inset': true,
          'tree-item-container-fade-title-after-icon':
            Settings.values.containerIconPosition === 'left',
        },
      ]"
      :style="{ '--container-color': container.colorCode }"
      aria-hidden="true"
    ></span>
    <span
      class="tree-item-root-spine"
      :class="{ 'tree-item-root-spine-branch': item.indentLevel === 0 }"
      aria-hidden="true"
    ></span>
    <span
      v-if="item.actions"
      class="tree-item-hover-menu"
      @dblclick.stop
    >
      <button
        v-if="
          (item.kind === 'tab' || item.kind === 'window') &&
          item.state !== 'saved'
        "
        class="tree-item-hover-menu-button"
        type="button"
        :aria-label="i18n.t('save')"
        :title="i18n.t('save')"
        @click.stop="$emit('save')"
      >
        <svg
          viewBox="0 0 24 24"
          aria-hidden="true"
        >
          <path d="M5 4h11l3 3v13H5z" />
          <path d="M8 4v5h7" />
        </svg>
      </button>
      <button
        class="tree-item-hover-menu-button"
        type="button"
        :aria-label="i18n.t('delete')"
        :title="i18n.t('delete')"
        @click.stop="$emit('close')"
      >
        <svg
          viewBox="0 0 24 24"
          aria-hidden="true"
        >
          <path d="M6 6l12 12M18 6L6 18" />
        </svg>
      </button>
    </span>
    <div class="tree-item-prepend">
      <div
        v-if="item.indentLevel > 0"
        class="tree-item-indent-lines"
        :style="{
          '--indent-parts':
            item.indentLevel + (item.kind === 'window' || branch ? 0 : 1),
        }"
      >
        <div
          v-for="level in Math.max(0, item.indentLevel - 1)"
          :key="level"
          class="tree-item-indent-line"
          :class="
            Settings.values.showIndentLinesWithoutChildren ||
            guide?.verticalLevels.includes(level)
              ? 'indent-line-vertical'
              : 'indent-line-spacer'
          "
        ></div>
        <div
          class="tree-item-indent-line indent-line-connector"
          :class="{
            'indent-line-connector-terminal':
              !Settings.values.showIndentLinesWithoutChildren &&
              !guide?.hasFollowingDirectSibling,
          }"
        ></div>
        <div
          v-if="!(item.kind === 'window' || branch)"
          class="tree-item-indent-line indent-line-end"
        ></div>
      </div>
      <div class="tree-item-action">
        <div
          v-if="item.kind === 'window' || branch"
          class="tree-item-action-button"
          :class="{
            'tree-item-action-button-counted':
              collapsed && item.kind !== 'window',
            'tree-item-action-button-hiding-focus': hidesFocus,
          }"
          role="button"
          tabindex="0"
          :aria-label="i18n.t(collapsed ? 'expandItem' : 'collapseItem')"
          :aria-expanded="!collapsed"
          @click.stop="$emit('toggle')"
          @keydown.enter.prevent="$emit('toggle')"
          @keydown.space.prevent="$emit('toggle')"
          @dblclick.stop
        >
          <span
            v-if="collapsed && item.kind !== 'window'"
            class="child-count"
            :class="{ 'tree-item-child-active': childrenOpen }"
            @dblclick.stop
            >{{ childCount }}</span
          >
          <svg
            class="collapse-arrow"
            :class="{ collapsed }"
            viewBox="0 0 12 12"
            aria-hidden="true"
          >
            <use :xlink:href="`#${IconChevronRight}`" />
          </svg>
        </div>
        <div
          v-else
          class="tree-item-action-spacer"
        ></div>
      </div>
      <span
        v-if="item.kind === 'tab'"
        class="tree-item-state-mark"
        :class="`tree-item-state-mark-${item.state === 'unloaded' ? 'unloaded' : item.state === 'saved' ? 'saved' : 'open'}`"
        aria-hidden="true"
        @dblclick.stop
      ></span>
      <span
        v-if="item.kind === 'tab'"
        class="tree-item-favicon-slot"
        ><img
          class="tree-item-favicon"
          :src="'/icons/default-favicon.svg'"
          alt=""
          @dblclick.stop
      /></span>
      <div class="tree-item-spacer"></div>
    </div>
    <div class="tree-item-content">
      <div
        v-if="item.kind === 'window'"
        class="tree-item-window-label"
        :class="{ 'tree-item-window-label-saved': item.state === 'saved' }"
      >
        <div
          class="tree-item-title"
          :class="`tree-item-text-${active ? 'active' : item.state === 'saved' ? 'saved' : 'open'}`"
        >
          {{ item.title }}
        </div>
      </div>
      <div
        v-else-if="item.kind === 'tab'"
        class="tree-item-tab-content"
      >
        <span
          v-if="
            container &&
            Settings.values.containerColorIndicator !== 'off' &&
            Settings.values.containerFadeSide === 'left'
          "
          class="tree-item-container-indicator"
          :class="[
            `tree-item-container-indicator-${Settings.values.containerColorIndicator}-left`,
            {
              'tree-item-container-fade-start-after-icon':
                Settings.values.containerIconPosition === 'left',
            },
          ]"
          :style="{ '--container-color': container.colorCode }"
          aria-hidden="true"
        ></span>
        <span
          v-if="container && Settings.values.containerIconPosition === 'left'"
          class="tree-item-container-icon tree-item-container-icon-left"
          :style="{ color: container.colorCode }"
          aria-hidden="true"
          ><svg
            v-if="isKnownFirefoxContainerIcon(container.icon)"
            viewBox="0 0 32 32"
          >
            <use :href="`/icons/usercontext.svg#${container.icon}`" /></svg
          ><span
            v-else
            class="tree-item-container-icon-fallback"
          ></span
        ></span>
        <div
          class="tree-item-title"
          :class="`tree-item-text-${item.state === 'unloaded' ? 'discarded' : item.state === 'saved' ? 'saved' : item.state === 'active' ? 'active' : 'open'}`"
        >
          <template v-if="item.customLabel">
            <span class="tree-item-custom-label">{{ item.customLabel }}</span>
            <span class="tree-item-custom-label-separator"> ~ </span>
          </template>
          <span>{{ item.title }}</span>
        </div>
        <span
          v-if="container && Settings.values.containerIconPosition === 'right'"
          class="tree-item-container-icon tree-item-container-icon-right"
          :style="{ color: container.colorCode }"
          aria-hidden="true"
          ><svg
            v-if="isKnownFirefoxContainerIcon(container.icon)"
            viewBox="0 0 32 32"
          >
            <use :href="`/icons/usercontext.svg#${container.icon}`" /></svg
          ><span
            v-else
            class="tree-item-container-icon-fallback"
          ></span
        ></span>
      </div>
      <div
        v-else-if="item.kind === 'note'"
        class="tree-item-title tree-item-note-text"
      >
        {{ item.title }}
      </div>
      <div
        v-else
        class="tree-item-separator-line"
        :aria-label="i18n.t('separator')"
      ></div>
    </div>
    <div
      v-if="composition"
      class="tree-item-window-meta"
      @dblclick.stop
    >
      <span
        class="tree-item-composition"
        role="img"
        :aria-label="
          i18n.t('onboardingWindowBarLabel', [
            String(composition.open),
            String(composition.unloaded),
            String(composition.saved),
          ])
        "
        ><i
          v-if="composition.open"
          class="tree-item-composition-open"
          :style="{ flexGrow: composition.open }"
        ></i
        ><i
          v-if="composition.unloaded"
          class="tree-item-composition-unloaded"
          :style="{ flexGrow: composition.unloaded }"
        ></i
        ><i
          v-if="composition.saved"
          class="tree-item-composition-saved"
          :style="{ flexGrow: composition.saved }"
        ></i
      ></span>
      <span
        class="tree-item-window-count"
        :class="{ 'tree-item-child-active': childrenOpen }"
        >{{ composition.open + composition.unloaded + composition.saved }}</span
      >
    </div>
  </div>
</template>

<style scoped src="../styles/tree-item.css"></style>
<style scoped>
/* Keep the real hover menu visible while the example cursor uses it. */
.example-actions-visible .tree-item-hover-menu,
.tree-item:focus-within .tree-item-hover-menu {
  visibility: visible;
}
/* The animated pointer swaps the count for the arrow just like real hover. */
.example-actions-visible .tree-item-action-button-counted .child-count {
  visibility: hidden;
}
.example-actions-visible .tree-item-action-button-counted .collapse-arrow {
  visibility: visible;
}
</style>
