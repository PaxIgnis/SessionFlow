<script lang="ts" setup>
import { TAB_LOADING } from '@/defaults/favicons'
import { ContextMenu } from '@/services/context-menu'
import { DragAndDrop } from '@/services/drag-and-drop'
import { FaviconService } from '@/services/favicons'
import * as Messages from '@/services/foreground-messages'
import { SessionTree } from '@/services/foreground-tree'
import { Selection } from '@/services/selection'
import { Settings } from '@/services/settings'
import { ContextMenuType } from '@/types/context-menu'
import {
  DragInfo,
  DragType,
  SelectionType,
  State,
  Tab,
  Window,
} from '@/types/session-tree'
import { computed } from 'vue'

const props = defineProps<{
  item: Tab | Window
  faviconService: FaviconService
}>()

function onDragStart(e: DragEvent) {
  if (!Settings.values.enableDragAndDrop) return
  let items: Array<Tab | Window> = []

  if (Settings.values.includeSelectedItemsWithDraggedItem) {
    // collect dragged items info
    items = Selection.getSelectedItems(getType(props.item))
    console.debug('Drag started for items:', items, 'origin item:', props.item)

    // if the dragged item is not in the selection, add it by simulating a ctrl+click
    if (!items.find((it) => it.uid === props.item.uid)) {
      Selection.selectItem(
        props.item,
        getType(props.item),
        new MouseEvent('click', {
          bubbles: true,
          cancelable: true,
          ctrlKey: true,
        })
      )
    }
    items = Selection.getSelectedItems(getType(props.item))
  } else {
    // only drag the single item
    items = [props.item]
  }

  console.debug('Final dragged items:', items)

  const dragInfo: DragInfo = {
    dragType:
      getType(props.item) === SelectionType.TAB
        ? DragType.TAB
        : DragType.WINDOW,
    items: items,
  }

  // initialize drag-and-drop operation
  DragAndDrop.start(dragInfo)

  // prepare native drag data
  if (e.dataTransfer) {
    const uris = []
    const urls = []
    const plain = []

    if (isTab(props.item)) {
      for (const item of items) {
        uris.push((item as Tab).url)
        uris.push(`# ${item.title}`)
        urls.push(`<a href="${(item as Tab).url}">${item.title}</a>`)
        plain.push((item as Tab).url)
      }
    } else if (isWindow(props.item)) {
      for (const item of items) {
        const title = item.title ? item.title : `Window id ${item.id}`
        urls.push(`<span>${title}</span>`)
        plain.push(title)
      }
    }

    // set native drag data
    e.dataTransfer.setData(
      'application/x-sessionflow-draganddrop',
      JSON.stringify(dragInfo)
    )
    e.dataTransfer.setData('text/x-moz-url', uris.join('\r\n'))
    if (isTab(props.item))
      e.dataTransfer.setData('text/uri-list', uris.join('\r\n'))
    e.dataTransfer.setData('text/html', urls.join('\r\n'))
    e.dataTransfer.setData('text/plain', plain.join('\r\n'))
  }
}

function isWindow(item: Tab | Window): item is Window {
  return (item as Window).tabs !== undefined
}

function isTab(item: Tab | Window): item is Tab {
  return (item as Tab).url !== undefined
}

function getType(item: Tab | Window): SelectionType {
  return isWindow(item) ? SelectionType.WINDOW : SelectionType.TAB
}

/*
 * Toggles the collapsed state of a window or tab item.
 */
function toggleCollapsedItem() {
  if (isWindow(props.item)) {
    Messages.toggleCollapseWindow(props.item.uid)
  } else if (isTab(props.item)) {
    Messages.toggleCollapseTab(props.item.uid)
  }
}

/*
 * Computed property to track the number of child tabs for a window or tab item.
 */
const childCount = computed(() => {
  if (isWindow(props.item)) {
    return props.item.tabs.length
  } else if (isTab(props.item)) {
    const win = SessionTree.reactiveWindowsList.value.find(
      (w) => w.uid === (props.item as Tab).windowUid
    )
    if (!win) return 0
    const allTabs = win.tabs
    const parentIndex = allTabs.findIndex((t) => t.uid === props.item.uid)
    if (parentIndex === -1) return 0

    let count = 0
    const parentIndent = (props.item as Tab).indentLevel ?? 1
    for (let i = parentIndex + 1; i < allTabs.length; i++) {
      const t = allTabs[i]
      const indent = t.indentLevel ?? 0
      if (indent <= parentIndent) break // reached sibling/ancestor
      count++
    }
    return count
  }
  return 0
})

function itemDblClickAction() {
  if (isWindow(props.item)) {
    Messages.windowDoubleClick(props.item.uid, props.item.id, props.item.state)
  } else if (isTab(props.item)) {
    const window = SessionTree.reactiveWindowsList.value.find(
      (w) => w.uid === (props.item as Tab).windowUid
    )
    if (!window) {
      console.warn(
        'Could not find parent window for tab double-click action',
        props.item
      )
      return
    }
    Messages.tabDoubleClick(
      props.item.id,
      window.id,
      props.item.uid,
      props.item.windowUid,
      props.item.state,
      props.item.url
    )
  }
}

function saveItemAction() {
  if (isWindow(props.item)) {
    Messages.saveWindow(props.item.id, props.item.uid)
  } else if (isTab(props.item)) {
    Messages.saveTab(props.item.id, props.item.uid)
  }
}

function closeItemAction() {
  if (isWindow(props.item)) {
    Messages.closeWindow(props.item.id, props.item.uid)
  } else if (isTab(props.item)) {
    Messages.closeTab(props.item.id, props.item.uid)
  }
}

/**
 * Computed property to determine if the item has any open children in the browser.
 */
const childrenOpen = computed(() => {
  if (isWindow(props.item)) {
    return props.item.tabs.some(
      (tab) => tab.state === State.OPEN || tab.state === State.DISCARDED
    )
  } else if (isTab(props.item)) {
    const window = SessionTree.reactiveWindowsList.value.find(
      (w) => w.uid === (props.item as Tab).windowUid
    )
    if (!window) return false
    const allTabs = window.tabs
    const parentIndex = allTabs.findIndex((t) => t.uid === props.item.uid)
    if (parentIndex === -1) return false

    const parentIndent = props.item.indentLevel ?? 1
    for (let i = parentIndex + 1; i < allTabs.length; i++) {
      const tab = allTabs[i]
      const indent = tab.indentLevel ?? 1
      if (indent <= parentIndent) break
      if (tab.state === State.OPEN || tab.state === State.DISCARDED) return true
    }
  }
  return false
})
</script>

<template>
  <div
    class="tree-item drag-and-drop-target"
    draggable="true"
    @dragstart="onDragStart"
    :drag-and-drop-id="String(item.uid)"
    :drag-and-drop-type="getType(item) === SelectionType.TAB ? 'tab' : 'window'"
    :class="[
      'indentLevel-' + (item.indentLevel ?? 0),
      {
        'tree-item-selected': item.selected === true,
        'tree-item-active': item.active === true,
        'tree-item-active-latest-tab':
        isTab(item) &&
        item.active === true &&
        SessionTree.reactiveWindowsList.value.find(w => w.uid === (item as Tab).windowUid)
          ?.active === true,
      },
    ]"
    :style="{
      '--indent-level': item.indentLevel ?? 0,
    }"
    @click.stop="
      Selection.selectItem(
        item,
        isTab(item) ? SelectionType.TAB : SelectionType.WINDOW,
        $event
      )
    "
    @contextmenu.stop="
      ContextMenu.handleContextMenuClick(
        isTab(item) ? ContextMenuType.Tab : ContextMenuType.Window,
        $event,
        isWindow(item) ? item : undefined,
        isTab(item) ? item : undefined,
        isTab(item) ? SelectionType.TAB : SelectionType.WINDOW
      )
    "
    @dblclick="itemDblClickAction()"
  >
    <span class="tree-item-overlay"></span>
    <span class="tree-item-underlay"></span>
    <span class="tree-item-hover-menu" @dblclick.stop>
      <span
        v-if="item.state === State.OPEN || item.state === State.DISCARDED"
        class="tree-item-hover-menu-save"
        @click="saveItemAction()"
      ></span>
      <span
        class="tree-item-hover-menu-close"
        @click="closeItemAction()"
      ></span>
    </span>
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
          v-for="i in Math.max(0, (props.item.indentLevel ?? 0) - 1)"
          :key="i"
          class="tree-item-indent-line indent-line-vertical"
        ></div>
        <div class="tree-item-indent-line indent-line-connector"></div>
        <div
          v-if="!(isWindow(item) || item.isParent)"
          class="tree-item-indent-line indent-line-end"
        ></div>
      </div>
      <div class="tree-item-action">
        <div
          v-if="isWindow(item) || item.isParent"
          class="tree-item-action-button"
          @click.stop="toggleCollapsedItem()"
          @dblclick.stop
        >
          <svg class="collapse-arrow" :class="{ collapsed: item.collapsed }">
            <use :xlink:href="'#chevron-right'" />
          </svg>
        </div>
        <div v-else class="tree-item-action-spacer"></div>
      </div>
      <div
        v-if="item.collapsed"
        class="child-count"
        :class="{ 'tree-item-child-active': childrenOpen }"
        @click="toggleCollapsedItem()"
        @dblclick.stop
      >
        {{ childCount }}
      </div>
      <img
        class="tree-item-favicon"
        :src="
          isTab(item)
            ? item.loadingStatus === 'loading' && item.state === State.OPEN
              ? TAB_LOADING
              : props.faviconService.getFavicon(item.url)
            : '/icon/16.png'
        "
      />
      <div class="tree-item-spacer"></div>
    </div>
    <div class="tree-item-content">
      <template v-if="isWindow(props.item)">
        <div
          class="tree-item-title"
          :class="{
            'tree-item-text-open': props.item.state === State.OPEN,
            'tree-item-text-saved': props.item.state === State.SAVED,
            'tree-item-text-discarded': props.item.state === State.DISCARDED,
            'tree-item-text-active': props.item.active === true,
          }"
        >
          Window id {{ props.item.id }} Window UID
          {{ props.item.uid }}
        </div>
      </template>
      <template v-else-if="isTab(props.item)">
        <div
          class="tree-item-title"
          :class="{
            'tree-item-text-open': props.item.state === State.OPEN,
            'tree-item-text-saved': props.item.state === State.SAVED,
            'tree-item-text-discarded': props.item.state === State.DISCARDED,
            'tree-item-text-active': props.item.active === true,
          }"
        >
          {{ props.item.title }}
        </div>
      </template>
    </div>
  </div>
</template>

<style scoped>
.tree-item {
  align-items: center;
  position: relative;
  display: grid;
  grid-template-areas: 'prepend content append';
  grid-template-columns: max-content 1fr auto;
  outline: none;
  max-width: 100%;
  padding: 1px 16px;
  padding-inline-start: calc(var(--indent-padding));
  text-decoration: none;
  box-sizing: border-box;
  min-height: 20px;

  background: transparent;
  color: inherit;
  padding-inline: 16px;
  padding-inline-start: calc(
    16px + (var(--prepend-width, 16px) * (var(--indent-level, 0)))
  ) !important;
}

*,
*::before,
*::after {
  box-sizing: border-box;
}

.tree-item-overlay {
  border-radius: inherit;
  bottom: 0;
  left: 0;
  opacity: 0;
  pointer-events: none;
  position: absolute;
  right: 0;
  top: 0;
}

.tree-item-hover-menu {
  pointer-events: none;
  position: absolute;
  display: inline-block;
  height: 18px;
  right: 0px;
  padding-right: 4px;
  background: rgba(75, 75, 75, 0.5);
  background-clip: border-box, border-box, content-box;
  z-index: 1;
  visibility: hidden;
}

.tree-item-hover-menu-close {
  pointer-events: auto;
  cursor: pointer;
  display: inline-block;
  align-items: center;
  width: 16px;
  height: 100%;
  margin-left: 4px;
  background: transparent url('/icon/16.png') no-repeat;
}

.tree-item-hover-menu-save {
  pointer-events: auto;
  cursor: pointer;
  display: inline-block;
  align-items: center;
  width: 16px;
  height: 100%;
  margin-left: 4px;
  background: transparent url('/icon/16.png') no-repeat;
}

.tree-item:hover .tree-item-hover-menu {
  visibility: visible;
}

.tree-item-underlay {
  position: absolute;
}

.tree-item:not(.tree-item-selected):hover > .tree-item-overlay {
  background: var(--list-item-hover-background);
  opacity: 1;
}

.tree-item:not(.tree-item-active-latest-tab) > .tree-item-overlay::before {
  display: none;
  content: none;
}

.tree-item-selected > .tree-item-overlay {
  background: var(--list-item-selected-background, rgba(0, 102, 255, 0.12));
  opacity: 1;
}

.tree-item-active-latest-tab > .tree-item-overlay::before {
  display: block;
  content: '';
  position: absolute;
  top: 0;
  left: 0;
  right: 0;
  bottom: -1px;
  border: 1px solid transparent;
  border-image: linear-gradient(
      to right,
      var(--list-item-focused-border-color-gradient-1),
      var(--list-item-focused-border-color-gradient-2),
      var(--list-item-focused-border-color-gradient-3),
      var(--list-item-focused-border-color-gradient-4)
    )
    5;
  pointer-events: none;
  z-index: 1;
  opacity: 1;
}

.tree-item-active-latest-tab > .tree-item-overlay {
  opacity: 1;
}

.tree-item-indent-line,
.tree-item-indent-line::before {
  border: 0px solid var(--list-indent-guide-stroke);
}
.tree-item-content {
  align-self: center;
  grid-area: content;
  overflow: hidden;
  min-width: 40px;
}

.tree-item-prepend {
  align-items: center;
  align-self: center;
  display: flex;
  grid-area: prepend;
  height: 100%;
  width: 48px;
}

.tree-item-indent-lines {
  position: absolute;
  inset-inline-start: 0;
  height: 100%;
  display: grid;
  padding-inline-start: 8px;
  padding-block: 0;
  grid-template-columns: repeat(var(--indent-parts, 1), var(--prepend-width));
  opacity: 0.4;
  pointer-events: none;
}

.tree-item-action-button {
  cursor: pointer;
}

.tree-item-action-spacer {
  width: 18px;
}

.tree-item-action {
  margin-inline-end: 8px;
  margin-inline-start: -7px;

  align-self: center;
  display: flex;
  align-items: center;
}

.collapse-arrow {
  display: inline-block;
  width: 12px;
  height: 12px;
  cursor: pointer;
  user-select: none;
  transition: transform 0.2s linear;
  margin-right: 5px;
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
.indent-line-connector {
  border-inline-start-width: 1px;
  height: 100%;
  width: calc(50% + 1px);
  justify-self: end;
}

.indent-line-connector {
  position: relative;
}
.indent-line-end {
  border-bottom-width: 1px;
  height: calc(50% + 1px);
  margin-inline-start: 0;
  margin-inline-end: 0;
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

.tree-item-text-open {
  color: var(--list-item-open-foreground);
}

.tree-item-text-saved {
  color: var(--list-item-saved-foreground);
}

.tree-item-text-discarded {
  color: var(--list-item-discarded-foreground);
}

.tree-item-text-active {
  color: var(--list-item-active-foreground) !important;
}

.child-count {
  color: var(--text-color-primary);
  font-size: var(--font-size-xxs);
  min-height: 15px;
  font-family: var(--font-family-session-tree);
  position: absolute;
  z-index: 0;
  padding-right: 0px;
  margin-left: 2px;
  cursor: pointer;
  user-select: none;
  bottom: -5px;
}

.tree-item-child-active {
  color: var(--list-item-child-open-foreground) !important;
}

.tree-item {
  user-select: none;
}

/* Drag-over visual indicators */
.tree-item.drag-over-above::before {
  content: '';
  position: absolute;
  left: calc(16px + var(--prepend-width, 16px) * (var(--indent-level, 0) + 1));
  right: 8px;
  height: 2px;
  top: -1px;
  background: var(--drag-and-drop-foreground);
  z-index: 20;
  border-radius: 2px;
}

.tree-item.drag-over-below::after {
  content: '';
  position: absolute;
  left: calc(16px + var(--prepend-width, 16px) * (var(--indent-level, 0) + 1));
  right: 8px;
  height: 2px;
  bottom: -1px;
  background: var(--drag-and-drop-foreground);
  z-index: 20;
  border-radius: 2px;
}

.tree-item.drag-over-mid,
.tree-item.drag-over-above,
.tree-item.drag-over-below {
  background: var(--drag-and-drop-hover);
}

.tree-item.drag-over-mid {
  background: var(--drag-and-drop-background);
}
</style>
