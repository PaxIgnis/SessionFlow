<script lang="ts" setup>
import { i18n, formatNumber } from '@/services/i18n'
import { isKnownFirefoxContainerIcon } from '@/defaults/container-icons'
import { TAB_LOADING } from '@/defaults/favicons'
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
import {
  type FaviconService,
  firefoxInternalPageIconStyle,
  isFirefoxInternalPageIcon,
  onFaviconError,
} from '@/services/favicons'
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
    title: props.item.tabGroup.title?.trim() || i18n.t('unnamedTabGroup'),
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
    details.push(i18n.t('titleDetail', [props.item.title]))
  }
  if (Settings.values.showTabUrlOnHover) {
    details.push(i18n.t('urlDetail', [props.item.url]))
  }
  if (
    Settings.values.tabGroupInfoOnHover === 'always' ||
    (Settings.values.tabGroupInfoOnHover === 'grouped-only' &&
      props.item.tabGroup)
  ) {
    details.push(
      i18n.t('tabGroupDetail', [
        props.item.tabGroup?.title?.trim() ||
          (props.item.tabGroup ? i18n.t('unnamedTabGroup') : i18n.t('none')),
      ]),
    )
  }
  if (props.item.container) {
    details.push(i18n.t('containerDetail', [props.item.container.name]))
  }

  return details.length > 0 ? details.join('\n') : undefined
})

const WINDOW_STATE_LABELS: Partial<Record<State, string>> = {
  [State.OPEN]: i18n.t('openState'),
  [State.SAVED]: i18n.t('saved'),
  [State.DISCARDED]: i18n.t('unloaded'),
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

  const kind = props.item.incognito ? i18n.t('privateWindow') : i18n.t('window')
  const name = props.item.title?.trim()
  const lines = [name ? `${kind}: ${name}` : kind]

  const state = WINDOW_STATE_LABELS[props.item.state]
  if (state) lines.push(i18n.t('stateDetail', [state]))

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
      >{{ i18n.t('containerDetail', [containerDisplay.metadata.name]) }}
    </span>
    <span
      v-if="isTab(item) && item.tabGroup"
      :id="tabGroupDescriptionId"
      class="tree-item-tab-group-description"
      >{{
        i18n.t('tabGroupDetail', [
          item.tabGroup.title?.trim() || i18n.t('unnamedTabGroup'),
        ])
      }}
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
        :aria-label="i18n.t('save')"
        :title="i18n.t('save')"
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
        :aria-label="i18n.t('delete')"
        :title="i18n.t('delete')"
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
            >{{ formatNumber(childCount, { useGrouping: false }) }}</span
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
        <span
          v-if="isFirefoxInternalPageIcon(getTabFavicon(item))"
          class="tree-item-favicon tree-item-firefox-internal-page-icon"
          :style="firefoxInternalPageIconStyle(getTabFavicon(item))"
          aria-hidden="true"
          @dblclick.stop
        ></span>
        <img
          v-else
          class="tree-item-favicon"
          :src="getTabFavicon(item)"
          @dblclick.stop
          @error="onFaviconError"
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
              ? i18n.t('privateWindowDetail', [
                  props.item.title || i18n.t('window'),
                ])
              : props.item.title || i18n.t('window')
          "
        >
          <img
            v-if="props.item.incognito"
            class="tree-item-favicon tree-item-window-favicon"
            :src="'/icons/private-browsing.svg'"
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
            {{ props.item.title || i18n.t('window') }}
          </div>
          <span
            v-if="props.item.incognito"
            class="tree-item-window-private-badge"
            >{{ i18n.t('private') }}</span
          >
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
          :aria-label="i18n.t('separator')"
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
        >{{
          formatNumber(windowComposition.total, { useGrouping: false })
        }}</span
      >
    </div>
  </div>
</template>

<style scoped src="../styles/tree-item.css"></style>
