<script lang="ts" setup>
import { TAB_LOADING } from '@/defaults/favicons'
import { ContextMenu } from '@/services/context-menu'
import { DragAndDrop } from '@/services/drag-and-drop'
import { collectDraggedItemsWithIncludedChildren } from '@/services/drag-and-drop-actions'
import { FaviconService } from '@/services/favicons'
import * as Messages from '@/services/foreground-messages'
import { SessionTree } from '@/services/foreground-tree'
import { Selection } from '@/services/selection'
import { Settings } from '@/services/settings'
import { countTreeItemDescendants } from '@/services/tree-utils'
import { ContextMenuType } from '@/types/context-menu'
import {
  DragInfo,
  DragType,
  Note,
  SelectionType,
  Separator,
  State,
  Tab,
  TreeItem,
  TreeItemType,
  Window,
} from '@/types/session-tree'
import { computed } from 'vue'

const props = defineProps<{
  item: TreeItem
  faviconService: FaviconService
}>()

function onDragStart(e: DragEvent) {
  if (!Settings.values.enableDragAndDrop) return
  let items: TreeItem[] = []

  // determine which items to drag based on settings
  if (Settings.values.includeSelectedItemsWithDraggedItem) {
    // collect dragged items info
    items = props.item.selected
      ? Selection.selectedItems.value.map((selectedItem) => selectedItem.item)
      : Selection.getSelectedItems(getType(props.item))
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
        }),
      )
    }
    items = Selection.getSelectedItems(getType(props.item))
  } else {
    // only drag the single item
    items = [props.item]
  }
  items = collectDraggedItemsWithIncludedChildren(
    items,
    getType(props.item),
    Settings.values.includeChildrenOfSelectedItems,
    SessionTree.windowsByUid,
  )

  console.debug('Final dragged items:', items)

  const dragInfo: DragInfo = {
    dragType: getDragType(props.item),
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
        if (!isTab(item)) continue
        uris.push(item.url)
        uris.push(`# ${item.title}`)
        urls.push(`<a href="${item.url}">${item.title}</a>`)
        plain.push(item.url)
      }
    } else if (isWindow(props.item)) {
      for (const item of items) {
        if (!isWindow(item)) continue
        const title = item.title ? item.title : `Window id ${item.id}`
        urls.push(`<span>${title}</span>`)
        plain.push(title)
      }
    } else if (isNote(props.item)) {
      for (const item of items) {
        plain.push(isNote(item) ? item.text : item.uid)
      }
    } else if (isSeparator(props.item)) {
      plain.push('Separator')
    }

    // set native drag data
    e.dataTransfer.setData(
      'application/x-sessionflow-draganddrop',
      JSON.stringify(dragInfo),
    )
    e.dataTransfer.setData('text/x-moz-url', uris.join('\r\n'))
    if (isTab(props.item))
      e.dataTransfer.setData('text/uri-list', uris.join('\r\n'))
    e.dataTransfer.setData('text/html', urls.join('\r\n'))
    e.dataTransfer.setData('text/plain', plain.join('\r\n'))

    // prepare and set drag image
    try {
      // update preview text/title for the drag image
      let title = ''
      let body = [] as string[]
      if (dragInfo.items && dragInfo.items.length > 0) {
        const item = dragInfo.items[0]

        if (isTab(item)) {
          if (dragInfo.items.length === 1) {
            title = (item as Tab).title || `Tab id ${(item as Tab).id}`
            body = [(item as Tab).url || '']
          } else {
            title = `${dragInfo.items.length} tabs`
            body = dragInfo.items
              .map((i) => (i as Tab).url || '')
              .filter(Boolean)
              .slice(0, 15)
          }
        } else if (isWindow(item)) {
          if (dragInfo.items.length === 1) {
            title = item.title || `Window id ${item.id}`
            body = [`Including ${item.children.length} items`]
          } else {
            title = `${dragInfo.items.length} windows`
            body = dragInfo.items
              .map((i) => (isWindow(i) ? i.title || `Window id ${i.id}` : ''))
              .filter(Boolean)
              .slice(0, 15)
          }
        } else if (isNote(item)) {
          title = isNote(item) ? item.text : 'Note'
          body = []
        } else {
          title = 'Separator'
          body = []
        }
      }

      const padding = 8
      const lineHeight = 18
      const titleFont = 'bold 14px system-ui'
      const bodyFont = '14px system-ui'

      // measure and cap text width to 300 CSS pixels, draw with ellipsis if needed
      const canvas = document.createElement('canvas')
      const ctx = canvas.getContext('2d')!
      ctx.font = titleFont
      const measuredTitle = ctx.measureText(title).width
      let measuredMax = measuredTitle
      ctx.font = bodyFont
      for (const line of body) {
        const measuredSubtitle = ctx.measureText(line).width
        measuredMax = Math.max(measuredMax, measuredSubtitle)
      }

      const MAX_TEXT_WIDTH = 284 // CSS pixels
      const textWidth = Math.min(measuredMax, MAX_TEXT_WIDTH)

      canvas.width = Math.ceil(textWidth + padding * 2)
      canvas.height = Math.ceil(
        lineHeight * (body && body.length > 0 ? body.length + 1 : 1) + padding,
      )

      // draw background and border
      ctx.fillStyle = '#fff'
      ctx.fillRect(0, 0, canvas.width, canvas.height)

      ctx.fillStyle = '#111' // title color
      ctx.font = titleFont
      ctx.textBaseline = 'top'
      DragAndDrop.drawTextEllipsisOnCanvas(
        ctx,
        title,
        padding,
        padding,
        textWidth,
      )
      ctx.font = bodyFont
      if (body && body.length > 0) {
        for (let i = 0; i < body.length; i++) {
          ctx.fillStyle = '#555'
          DragAndDrop.drawTextEllipsisOnCanvas(
            ctx,
            body[i],
            padding,
            padding + lineHeight * (i + 1),
            textWidth,
          )
        }
      }

      e.dataTransfer.setDragImage(canvas, -10, -10)
    } catch (error) {
      console.error(
        'onDragStart: Error preparing and setting drag image:',
        error,
      )
    }
  }
}

function isWindow(item: TreeItem): item is Window {
  return item.type === TreeItemType.WINDOW
}

function isTab(item: TreeItem): item is Tab {
  return item.type === TreeItemType.TAB
}

function isNote(item: TreeItem): item is Note {
  return item.type === TreeItemType.NOTE
}

function isSeparator(item: TreeItem): item is Separator {
  return item.type === TreeItemType.SEPARATOR
}

function getType(item: TreeItem): SelectionType {
  if (isWindow(item)) return SelectionType.WINDOW
  if (isTab(item)) return SelectionType.TAB
  if (isNote(item)) return SelectionType.NOTE
  return SelectionType.SEPARATOR
}

function getDragType(item: TreeItem): DragType {
  if (isWindow(item)) return DragType.WINDOW
  if (isTab(item)) return DragType.TAB
  if (isNote(item)) return DragType.NOTE
  return DragType.SEPARATOR
}

function getDragAndDropType(item: TreeItem): string {
  if (isWindow(item)) return 'window'
  if (isTab(item)) return 'tab'
  if (isNote(item)) return 'note'
  return 'separator'
}

/*
 * Toggles the collapsed state of a window or tab item.
 */
function toggleCollapsedItem() {
  if (isWindow(props.item)) {
    Messages.toggleCollapseWindow(props.item.uid)
  } else if (isTab(props.item)) {
    Messages.toggleCollapseTab(props.item.uid)
  } else if (isNote(props.item)) {
    Messages.toggleCollapseNote(props.item.uid)
  }
}

/*
 * Computed property to track the number of child tabs for a window or tab item.
 */
const childCount = computed(() => {
  if (isWindow(props.item)) {
    return countTreeItemDescendants(props.item)
  } else if (isNote(props.item)) {
    return countTreeItemDescendants(props.item, getContainingList(props.item))
  } else if (isTab(props.item)) {
    return countTreeItemDescendants(props.item, getContainingList(props.item))
  }
  return 0
})

function getContainingList(item: TreeItem): TreeItem[] {
  if ((isTab(item) || isNote(item) || isSeparator(item)) && item.windowUid) {
    return SessionTree.windowsByUid.get(item.windowUid)?.children ?? []
  }
  return SessionTree.reactiveItems.value as TreeItem[]
}

function shouldShowVerticalIndentLine(indentLevel: number): boolean {
  if (Settings.values.showIndentLinesWithoutChildren) return true

  const currentIndent = props.item.indentLevel ?? 0
  if (indentLevel >= currentIndent) return false
  const { containingList, itemUid } = getIndentLineScanContext(indentLevel)
  const itemIndex = containingList.findIndex((item) => item.uid === itemUid)
  if (itemIndex === -1) return false

  for (let i = itemIndex + 1; i < containingList.length; i++) {
    const candidate = containingList[i]
    if (candidate.isVisible === false) continue

    const candidateIndent = candidate.indentLevel ?? 0
    if (candidateIndent < indentLevel) return false
    if (candidateIndent === indentLevel) return true
  }

  return false
}

function getIndentLineScanContext(indentLevel: number): {
  containingList: TreeItem[]
  itemUid: TreeItem['uid']
} {
  if (
    (isTab(props.item) || isNote(props.item) || isSeparator(props.item)) &&
    props.item.windowUid
  ) {
    const containingWindow = SessionTree.windowsByUid.get(props.item.windowUid)
    if (
      containingWindow &&
      indentLevel <= (containingWindow.indentLevel ?? 0)
    ) {
      return {
        containingList: SessionTree.reactiveItems.value as TreeItem[],
        itemUid: containingWindow.uid,
      }
    }
  }

  return {
    containingList: getContainingList(props.item),
    itemUid: props.item.uid,
  }
}

function hasFollowingDirectSibling(): boolean {
  const currentIndent = props.item.indentLevel ?? 0
  const containingList = getContainingList(props.item)
  const itemIndex = containingList.findIndex(
    (item) => item.uid === props.item.uid,
  )
  if (itemIndex === -1) return false

  for (let i = itemIndex + 1; i < containingList.length; i++) {
    const candidate = containingList[i]
    if (candidate.isVisible === false) continue

    const candidateIndent = candidate.indentLevel ?? 0
    if (candidateIndent < currentIndent) return false
    if (candidateIndent === currentIndent)
      return candidate.parentUid === props.item.parentUid
  }

  return false
}

function itemDblClickAction() {
  if (isWindow(props.item)) {
    Messages.windowDoubleClick(props.item.uid, props.item.id, props.item.state)
  } else if (isTab(props.item)) {
    const window = SessionTree.windowsByUid.get((props.item as Tab).windowUid)
    if (!window) {
      console.warn(
        'Could not find parent window for tab double-click action',
        props.item,
      )
      return
    }
    Messages.tabDoubleClick(
      props.item.id,
      window.id,
      props.item.uid,
      props.item.windowUid,
      props.item.state,
      props.item.url,
    )
  } else if (isNote(props.item)) {
    import('@/services/modal-state').then(({ openEditNoteModal }) =>
      openEditNoteModal(props.item as Note),
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
  } else if (isNote(props.item)) {
    Messages.removeNote(props.item.uid)
  } else if (isSeparator(props.item)) {
    Messages.removeSeparator(props.item.uid)
  }
}

/**
 * Computed property to determine if the item has any open children in the browser.
 */
const childrenOpen = computed(() => {
  if (isWindow(props.item)) {
    return props.item.children.some(
      (tab) =>
        isTab(tab) &&
        (tab.state === State.OPEN || tab.state === State.DISCARDED),
    )
  } else if (isNote(props.item)) {
    return flatDescendantsHaveOpenTab(props.item)
  } else if (isTab(props.item)) {
    return flatDescendantsHaveOpenTab(props.item)
  }
  return false
})

const tabGroupIndicator = computed(() => {
  if (!isTab(props.item) || !props.item.tabGroup) return undefined
  if (Settings.values.tabGroupColorIndicator === 'hidden') return undefined

  return {
    color: `var(--tab-group-color-${props.item.tabGroup.color})`,
    position: Settings.values.tabGroupColorIndicator,
    title: props.item.tabGroup.title?.trim() || 'Unnamed tab group',
  }
})

const tabHoverDetails = computed(() => {
  if (!isTab(props.item)) return undefined

  const details: string[] = []
  if (Settings.values.showTabTitleOnHover) {
    details.push(`Title: ${props.item.title}`)
  }
  if (Settings.values.showTabUrlOnHover) {
    details.push(`URL: ${props.item.url}`)
  }
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

  return details.length > 0 ? details.join('\n') : undefined
})

function flatDescendantsHaveOpenTab(item: TreeItem): boolean {
  const list = getContainingList(item)
  const parentIndex = list.findIndex((child) => child.uid === item.uid)
  if (parentIndex === -1) return false

  const parentIndent = item.indentLevel ?? 0
  for (let i = parentIndex + 1; i < list.length; i++) {
    const tab = list[i]
    const indent = tab.indentLevel ?? 0
    if (indent <= parentIndent) break
    if (
      isTab(tab) &&
      (tab.state === State.OPEN || tab.state === State.DISCARDED)
    )
      return true
  }
  return false
}
</script>

<template>
  <div
    class="tree-item drag-and-drop-target"
    draggable="true"
    @dragstart="onDragStart"
    :drag-and-drop-id="String(item.uid)"
    :drag-and-drop-type="getDragAndDropType(item)"
    :class="[
      'indentLevel-' + (item.indentLevel ?? 0),
      {
        'tree-item-selected': item.selected === true,
        'tree-item-active':
          (isTab(item) || isWindow(item)) && item.active === true,
        'tree-item-active-latest-tab':
          isTab(item) &&
          item.active === true &&
          SessionTree.windowsByUid.get((item as Tab).windowUid)?.active ===
            true,
        'tree-item-note': isNote(item),
        'tree-item-separator': isSeparator(item),
      },
    ]"
    :style="{
      '--indent-level': item.indentLevel ?? 0,
    }"
    :title="tabHoverDetails"
    @click.stop="Selection.selectItem(item, getType(item), $event)"
    @contextmenu.stop="
      ContextMenu.handleContextMenuClick(
        isTab(item)
          ? ContextMenuType.Tab
          : isWindow(item)
            ? ContextMenuType.Window
            : isNote(item)
              ? ContextMenuType.Note
              : ContextMenuType.Separator,
        $event,
        isWindow(item) ? item : undefined,
        isTab(item) ? item : undefined,
        isNote(item) ? item : undefined,
        isSeparator(item) ? item : undefined,
        getType(item),
      )
    "
    @dblclick="itemDblClickAction()"
  >
    <span class="tree-item-overlay"></span>
    <span class="tree-item-underlay"></span>
    <span
      v-if="tabGroupIndicator"
      class="tree-item-tab-group-indicator"
      :class="`tree-item-tab-group-indicator-${tabGroupIndicator.position}`"
      :style="{ backgroundColor: tabGroupIndicator.color }"
      :title="tabGroupIndicator.title"
      :aria-label="tabGroupIndicator.title"
    ></span>
    <span
      class="tree-item-hover-menu"
      @dblclick.stop
    >
      <span
        v-if="
          (isTab(item) || isWindow(item)) &&
          (item.state === State.OPEN || item.state === State.DISCARDED)
        "
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
              !hasFollowingDirectSibling(),
          }"
        ></div>
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
          <svg
            class="collapse-arrow"
            :class="{ collapsed: item.collapsed }"
          >
            <use :xlink:href="'#chevron-right'" />
          </svg>
        </div>
        <div
          v-else
          class="tree-item-action-spacer"
        ></div>
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
      <svg
        v-if="isTab(item) && item.pinned"
        class="tree-item-pinned"
      >
        <use :xlink:href="'#pinned'" />
      </svg>
      <img
        v-if="isTab(item) || isWindow(item)"
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
          {{ props.item.title || 'Window' }}
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
          <template v-if="props.item.customLabel">
            <span class="tree-item-custom-label">{{
              props.item.customLabel
            }}</span>
            <span class="tree-item-custom-label-separator"> ~ </span>
          </template>
          <span>{{ props.item.title }}</span>
        </div>
      </template>
      <template v-else-if="isNote(props.item)">
        <div class="tree-item-title tree-item-note-text">
          {{ props.item.text }}
        </div>
      </template>
      <template v-else-if="isSeparator(props.item)">
        <div
          class="tree-item-separator-line"
          aria-label="Separator"
        ></div>
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
  max-height: 18px;
}

.tree-item-prepend {
  align-items: center;
  align-self: center;
  display: flex;
  grid-area: prepend;
  height: 100%;
  width: 48px;
}

.tree-item-note .tree-item-prepend {
  width: 20px;
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
  margin-inline-start: 0;
  margin-inline-end: 0;
  width: calc(40% + 1px);
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

.tree-item-pinned {
  position: absolute;
  margin-left: 8px;
  display: inline-block;
  width: 10px;
  height: 10px;
  cursor: pointer;
  user-select: none;
  fill: var(--pin-icon-foreground);
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

.tree-item-custom-label {
  color: var(--list-item-custom-label-foreground);
}

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

.tree-item-note-text {
  color: var(--note-text-foreground);
}

.tree-item-separator.indentLevel-0 {
  padding-inline: 0 !important;
}

.tree-item-separator .tree-item-prepend {
  min-width: 0;
  overflow: visible;
  width: 0;
}

.tree-item-separator .tree-item-action,
.tree-item-separator .tree-item-spacer {
  display: none;
}

.tree-item-separator .tree-item-content {
  align-self: stretch;
  max-height: none;
}

.tree-item-separator-line {
  border: 0px solid var(--list-indent-guide-stroke);
  border-bottom-width: 1px;
  height: calc(50% + 1px);
  opacity: 0.4;
  position: relative;
  z-index: 1;
  width: 100%;
}
</style>
