<script lang="ts" setup>
import { TAB_LOADING } from '@/defaults/favicons'
import { isKnownFirefoxContainerIcon } from '@/defaults/container-icons'
import { ContextMenu } from '@/services/context-menu'
import { getTreeItemContextMenuArgs } from '@/services/context-menu-actions'
import { DragAndDrop } from '@/services/drag-and-drop'
import {
  buildDragImagePreview,
  collectDraggedItemsWithIncludedChildren,
  collectSelectedDragItems,
  getDragImageTextWidth,
  populateInternalDragData,
} from '@/services/drag-and-drop-actions'
import { FaviconService } from '@/services/favicons'
import * as Messages from '@/services/foreground-messages'
import { SessionTree } from '@/services/foreground-tree'
import { Selection } from '@/services/selection'
import { Settings } from '@/services/settings'
import {
  countTreeItemDescendants,
  createTreeItemTally,
  formatStateBreakdown,
  formatTallyLines,
  tallyTreeItem,
  type TreeItemIndentGuideState,
} from '@/services/tree-utils'
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
  faviconRevision?: number
  indentGuideState?: TreeItemIndentGuideState
}>()

function getTabFavicon(tab: Tab): string {
  // Reading this prop makes background cache refreshes invalidate the image src.
  void props.faviconRevision
  return tab.loadingStatus === 'loading' && tab.state === State.OPEN
    ? TAB_LOADING
    : props.faviconService.getFavicon(
        tab.url,
        SessionTree.windowsByUid.get(tab.windowUid)?.incognito === true,
      )
}

function onDragStart(e: DragEvent) {
  if (!Settings.values.enableDragAndDrop) return
  let items: TreeItem[]

  items = collectSelectedDragItems(
    props.item,
    Selection.selectedItems.value.map((selectedItem) => selectedItem.item),
    Settings.values.includeSelectedItemsWithDraggedItem,
  )
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
    populateInternalDragData(e.dataTransfer, dragInfo)

    // prepare and set drag image
    try {
      const { title, metadata, body } = buildDragImagePreview(dragInfo.items)

      const padding = 8
      const lineHeight = 18
      const titleFont = 'bold 14px system-ui'
      const metadataFont = 'italic 13px system-ui'
      const bodyFont = '14px system-ui'

      // Measure with each drawing font and cap the complete canvas at 370px.
      const canvas = document.createElement('canvas')
      const ctx = canvas.getContext('2d')!
      ctx.font = titleFont
      const measuredTitle = ctx.measureText(title).width
      let measuredMax = measuredTitle
      if (metadata) {
        ctx.font = metadataFont
        measuredMax = Math.max(measuredMax, ctx.measureText(metadata).width)
      }
      ctx.font = bodyFont
      for (const line of body) {
        const measuredSubtitle = ctx.measureText(line).width
        measuredMax = Math.max(measuredMax, measuredSubtitle)
      }

      const textWidth = getDragImageTextWidth(measuredMax, padding)

      canvas.width = Math.ceil(textWidth + padding * 2)
      canvas.height = Math.ceil(
        lineHeight * (1 + (metadata ? 1 : 0) + body.length) + padding,
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
      if (metadata) {
        ctx.fillStyle = '#666'
        ctx.font = metadataFont
        DragAndDrop.drawTextEllipsisOnCanvas(
          ctx,
          metadata,
          padding,
          padding + lineHeight,
          textWidth,
        )
      }
      ctx.font = bodyFont
      if (body.length > 0) {
        for (let i = 0; i < body.length; i++) {
          ctx.fillStyle = '#555'
          DragAndDrop.drawTextEllipsisOnCanvas(
            ctx,
            body[i],
            padding,
            padding + lineHeight * (i + 1 + (metadata ? 1 : 0)),
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

function openItemContextMenu(event: MouseEvent): void {
  ContextMenu.handleContextMenuClick(
    ...getTreeItemContextMenuArgs(props.item, event),
  )
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

/*
 * Tallies a window's tabs by session state -- every tab it holds, at any
 * depth, since children is the window's flat descendant list. Drives the
 * composition bar, which answers "how much of this window is live" at a
 * glance -- the question a collapsed window cannot otherwise answer.
 */
const windowComposition = computed(() => {
  if (!isWindow(props.item)) return undefined

  const tally = createTreeItemTally()
  for (const child of props.item.children) tallyTreeItem(tally, child)

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

function getContainingList(item: TreeItem): TreeItem[] {
  if ((isTab(item) || isNote(item) || isSeparator(item)) && item.windowUid) {
    return SessionTree.windowsByUid.get(item.windowUid)?.children ?? []
  }
  return SessionTree.reactiveItems.value as TreeItem[]
}

function shouldShowVerticalIndentLine(indentLevel: number): boolean {
  if (Settings.values.showIndentLinesWithoutChildren) return true
  if (props.indentGuideState) {
    return props.indentGuideState.verticalLevels.includes(indentLevel)
  }

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
  if (props.indentGuideState) {
    return props.indentGuideState.hasFollowingDirectSibling
  }

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
  if (isWindow(props.item) || isTab(props.item)) {
    void Messages.treeItemDoubleClick(props.item)
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

/* Named for the context menu's "Delete", which this button mirrors. The
   underlying messages are still the close/remove ones -- the wording is what
   the user matches between the two surfaces, not the transport. */
function deleteItemAction() {
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

/*
 * Whether collapsing this row is what is keeping the focused tab off screen.
 * Otherwise a collapse can swallow the tab you are looking at and leave
 * nothing behind to say where it went.
 */
const hidesFocusedTab = computed(() => {
  if (props.item.collapsed !== true) return false
  if (isWindow(props.item)) return props.item.children.some(isFocusedTab)
  if (isNote(props.item) || isTab(props.item)) {
    return someFlatDescendantTab(props.item, isFocusedTab)
  }
  return false
})

/*
 * Whether unloaded and saved tabs get a dimmed favicon. The state mark and the
 * text treatment carry the same information either way, so turning this off
 * only drops the third cue -- it never leaves a state unlabelled.
 */
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
    ? `container-description-${props.item.uid}`
    : undefined,
)

const tabGroupDescriptionId = computed(() =>
  isTab(props.item) && props.item.tabGroup
    ? `tab-group-description-${props.item.uid}`
    : undefined,
)

const itemDescriptionIds = computed(() => {
  const ids = [
    containerDescriptionId.value,
    tabGroupDescriptionId.value,
  ].filter(Boolean)
  return ids.length > 0 ? ids.join(' ') : undefined
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
  if (props.item.container) {
    details.push(`Container: ${props.item.container.name}`)
  }

  return details.length > 0 ? details.join('\n') : undefined
})

const WINDOW_STATE_LABELS: Partial<Record<State, string>> = {
  [State.OPEN]: 'Open',
  [State.SAVED]: 'Saved',
  [State.DISCARDED]: 'Unloaded',
}

/*
 * A window row shows a bar and a number; the bar is a proportion and the number
 * is only tabs. Hovering spells both out and adds the items the bar has no
 * colour for, so nothing about a window is knowable only by expanding it.
 */
const windowHoverDetails = computed(() => {
  if (!isWindow(props.item)) return undefined

  const tally = createTreeItemTally()
  for (const child of props.item.children) tallyTreeItem(tally, child)

  const kind = props.item.incognito ? 'Private window' : 'Window'
  const name = props.item.title?.trim()
  const lines = [name ? `${kind}: ${name}` : kind]

  const state = WINDOW_STATE_LABELS[props.item.state]
  if (state) lines.push(`State: ${state}`)

  return [...lines, ...formatTallyLines(tally)].join('\n')
})

const itemHoverDetails = computed(() => {
  if (isWindow(props.item)) return windowHoverDetails.value
  return tabHoverDetails.value
})

function someFlatDescendantTab(
  item: TreeItem,
  predicate: (tab: Tab) => boolean,
): boolean {
  const list = getContainingList(item)
  const parentIndex = list.findIndex((child) => child.uid === item.uid)
  if (parentIndex === -1) return false

  const parentIndent = item.indentLevel ?? 0
  for (let i = parentIndex + 1; i < list.length; i++) {
    const descendant = list[i]
    const indent = descendant.indentLevel ?? 0
    if (indent <= parentIndent) break
    if (isTab(descendant) && predicate(descendant)) return true
  }
  return false
}

function flatDescendantsHaveOpenTab(item: TreeItem): boolean {
  return someFlatDescendantTab(
    item,
    (tab) => tab.state === State.OPEN || tab.state === State.DISCARDED,
  )
}

/* The one tab Firefox is actually showing: active in its window, and that
   window focused. Several tabs are "active" at once across windows, but only
   this one is the one you lose track of. */
function isFocusedTab(item: TreeItem): boolean {
  return (
    isTab(item) &&
    item.active === true &&
    SessionTree.windowsByUid.get(item.windowUid)?.active === true
  )
}
</script>

<template>
  <div
    class="tree-item drag-and-drop-target"
    tabindex="-1"
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
        'tree-item-active-latest-tab': isFocusedTab(item),
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
    :style="{
      '--indent-level': item.indentLevel ?? 0,
    }"
    :aria-describedby="itemDescriptionIds"
    :title="itemHoverDetails"
    @click.stop="Selection.selectItem(item, getType(item), $event)"
    @contextmenu.stop="openItemContextMenu"
    @dblclick="itemDblClickAction()"
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
      @dblclick.stop
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
      :style="{
        '--container-color': containerDisplay.metadata.colorCode,
      }"
      aria-hidden="true"
    ></span>
    <span
      class="tree-item-hover-menu"
      @dblclick.stop
    >
      <button
        v-if="
          (isTab(item) || isWindow(item)) &&
          (item.state === State.OPEN || item.state === State.DISCARDED)
        "
        class="tree-item-hover-menu-button"
        type="button"
        aria-label="Save"
        title="Save"
        @click.stop="saveItemAction()"
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
        aria-label="Delete"
        title="Delete"
        @click.stop="deleteItemAction()"
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
          :class="{
            'tree-item-action-button-counted':
              item.collapsed && !isWindow(item),
            'tree-item-action-button-hiding-focus': hidesFocusedTab,
          }"
          @click.stop="toggleCollapsedItem()"
          @dblclick.stop
        >
          <span
            v-if="item.collapsed && !isWindow(item)"
            class="child-count"
            :class="{ 'tree-item-child-active': childrenOpen }"
            @dblclick.stop
            >{{ childCount }}</span
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
      <span
        v-if="isTab(item)"
        class="tree-item-state-mark"
        :class="{
          'tree-item-state-mark-open': item.state === State.OPEN,
          'tree-item-state-mark-unloaded': item.state === State.DISCARDED,
          'tree-item-state-mark-saved': item.state === State.SAVED,
        }"
        aria-hidden="true"
        @dblclick.stop
      ></span>
      <span
        v-if="isTab(item)"
        class="tree-item-favicon-slot"
      >
        <img
          class="tree-item-favicon"
          :src="getTabFavicon(item)"
          @dblclick.stop
        />
        <svg
          v-if="isTab(item) && item.pinned"
          class="tree-item-pinned"
          aria-hidden="true"
        >
          <use :xlink:href="'#pinned'" />
        </svg>
      </span>
      <div class="tree-item-spacer"></div>
    </div>
    <div class="tree-item-content">
      <template v-if="isWindow(props.item)">
        <div
          class="tree-item-window-label"
          :class="{
            'tree-item-window-label-private': props.item.incognito,
            'tree-item-window-label-saved':
              props.item.state === State.SAVED && !props.item.incognito,
          }"
          :aria-label="
            props.item.incognito
              ? `Private window: ${props.item.title || 'Window'}`
              : props.item.title || 'Window'
          "
        >
          <img
            class="tree-item-favicon tree-item-window-favicon"
            :src="
              props.item.incognito
                ? '/icons/private-browsing.svg'
                : '/icon/16.png'
            "
            alt=""
            @dblclick.stop
          />
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
          <span
            v-if="props.item.incognito"
            class="tree-item-window-private-badge"
          >
            Private
          </span>
        </div>
      </template>
      <template v-else-if="isTab(props.item)">
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
    <div
      v-if="windowComposition"
      class="tree-item-window-meta"
      @dblclick.stop
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
    58px + var(--tree-root-step) +
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
  padding-inline-start: calc(var(--indent-padding));
  text-decoration: none;
  box-sizing: border-box;
  min-height: max(20px, calc(var(--font-size-xs) + 7px));

  --tree-item-backdrop: var(--tree-background);
  background: transparent;
  color: inherit;
  padding-inline: 16px;
  padding-inline-start: calc(
    16px + var(--tree-root-step) +
      (var(--prepend-width, 16px) * (var(--indent-level, 0)))
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

.tree-item:hover {
  --tree-item-backdrop: var(--list-item-hover-background);
}

.tree-item-selected,
.tree-item-selected:hover {
  --tree-item-backdrop: var(--list-item-selected-background);
}

/* Overlaid rather than inline: reserving this space would cost every row
   ~36px of title width permanently, for a control only the hovered row uses. */
.tree-item-hover-menu {
  align-items: center;
  background: var(--tree-item-backdrop);
  bottom: 1px;
  display: flex;
  gap: 1px;
  padding-inline-end: 14px;
  pointer-events: none;
  position: absolute;
  right: 0;
  top: 1px;
  visibility: hidden;
  z-index: 6;
}

/* Ramp so the title dissolves under the menu instead of being cut mid-glyph. */
.tree-item-hover-menu::before {
  background: linear-gradient(to right, transparent, var(--tree-item-backdrop));
  bottom: 0;
  content: '';
  inset-inline-start: -18px;
  position: absolute;
  top: 0;
  width: 18px;
}

.tree-item-hover-menu-button {
  align-items: center;
  background: none;
  border: 0;
  border-radius: 3px;
  color: var(--list-item-discarded-foreground);
  cursor: pointer;
  display: flex;
  height: 18px;
  justify-content: center;
  padding: 0;
  pointer-events: auto;
  width: 18px;
}

.tree-item-hover-menu-button:hover {
  background: rgba(255, 255, 255, 0.1);
  color: var(--list-item-active-foreground);
}

.tree-item-hover-menu-button:focus-visible {
  outline: 2px solid var(--state-live);
  outline-offset: -2px;
}

.tree-item-hover-menu-button svg {
  fill: none;
  height: 11px;
  stroke: currentColor;
  stroke-linecap: round;
  stroke-linejoin: round;
  stroke-width: 2;
  width: 11px;
}

.tree-item:hover .tree-item-hover-menu {
  visibility: visible;
}

/* The state mark. Shape says whether the browser still holds the tab, colour
   temperature says whether it is running or only kept. The title carries the
   same distinction in colour, so neither channel is load-bearing alone. */
.tree-item-state-mark {
  flex: 0 0 8px;
  height: 8px;
  margin-inline-end: 3px;
  width: 8px;
  position: relative;
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

/* Third redundant cue: a saved tab is not in the browser, so its identity
   goes grey. An unloaded one keeps its colour, just dimmed. */
.tree-item-state-unloaded .tree-item-favicon {
  opacity: 0.62;
}

.tree-item-state-saved .tree-item-favicon {
  filter: grayscale(1);
  opacity: 0.5;
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

/* One continuous rail down the left edge that every top-level item hangs
   from, so a root note or separator reads as part of the tree rather than
   floating beside it. Collapsing it collapses the whole session. */
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

.tree-item-indent-line,
.tree-item-indent-line::before {
  border: 0px solid var(--list-indent-guide-stroke);
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
  min-width: 42px;
}

.tree-item-window .tree-item-prepend {
  min-width: 24px;
}

.tree-item-note .tree-item-prepend {
  min-width: 20px;
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

.tree-item-action-button {
  align-items: center;
  cursor: pointer;
  /* Flex rather than inline flow: the twisty is an inline-block, and its line
     box would otherwise leave descender slack under the glyph for the focus
     rule to land in. */
  display: flex;
  position: relative;
}

/* A collapsed row that is hiding the focused tab borrows that tab's own two
   marks: its white title colour, over the four-stop gradient the active row
   wears as a border. Colour plus a rule, so the cue reads at 11px and does
   not rest on hue alone. */
.tree-item-action-button-hiding-focus .child-count,
.tree-item-action-button-hiding-focus .collapse-arrow {
  color: var(--list-item-active-foreground) !important;
  stroke: var(--list-item-active-foreground);
}

.tree-item-action-button-hiding-focus::after {
  background: linear-gradient(
    to right,
    var(--list-item-focused-border-color-gradient-1),
    var(--list-item-focused-border-color-gradient-2),
    var(--list-item-focused-border-color-gradient-3),
    var(--list-item-focused-border-color-gradient-4)
  );
  border-radius: 1px;
  bottom: -1px;
  content: '';
  height: 2px;
  inset-inline: 0;
  position: absolute;
}

/* While collapsed, the count holds the slot and the twisty hides behind it --
   until the pointer lands on the row, when they swap. Both occupy the same
   grid cell inside the fixed 16px slot, so the exchange moves nothing. */
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

/* A fixed slot shared by the twisty and the descendant count. Neither can
   widen it, so a collapsed row keeps the same icon and title positions as an
   expanded one and a scan down the tree stays on a straight line. */
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
  background: transparent;
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

/* Wraps the favicon so the pin can ride its corner. Positioned, so it stays
   above .tree-item-overlay, which paints the hover and selected backgrounds. */
.tree-item-favicon-slot {
  align-items: center;
  display: inline-flex;
  flex: 0 0 auto;
  justify-content: center;
  position: relative;
  z-index: 2;
}

/* A badge on the tab's own icon rather than a column of its own: pinning is a
   property of the tab, and pinned rows now line up with unpinned ones. The
   double dark shadow is a halo, so the mark survives a busy favicon. */
.tree-item-pinned {
  bottom: -4px;
  fill: var(--list-item-open-foreground);
  /* The pin is an outline glyph; at badge size its strokes need a hard dark
     rim to survive a busy favicon, and every row background is dark enough
     that one near-black halo works for rest, hover and selected alike. */
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

/* Takes the twisty's place while collapsed rather than sitting beside it. The
   fixed width keeps the slot honest; a rare three-digit count bleeds evenly to
   both sides instead of shoving the row. */
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

.tree-item {
  user-select: none;
}

/* Drag-over visual indicators */
.tree-item.drag-over-above::before {
  content: '';
  position: absolute;
  left: calc(
    16px + var(--tree-root-step) + var(--prepend-width, 16px) *
      (var(--indent-level, 0) + 1)
  );
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
  left: calc(
    16px + var(--tree-root-step) + var(--prepend-width, 16px) *
      (var(--indent-level, 0) + 1)
  );
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
