<script lang="ts" setup>
import IconChevronRight from '@/assets/chevron-right.svg'
import IconPinned from '@/assets/pinned.svg'
import ContainerRecoveryModal from '@/components/ContainerRecoveryModal.vue'
import DeleteTreeItemsModal from '@/components/DeleteTreeItemsModal.vue'
import EditTextModal from '@/components/EditTextModal.vue'
import SessionTreeNotification from '@/components/SessionTreeNotification.vue'
import SessionTreeToolbar from '@/components/SessionTreeToolbar.vue'
import TreeItem from '@/components/TreeItem.vue'
import { ContextMenu } from '@/services/context-menu'
import { DragAndDrop } from '@/services/drag-and-drop'
import { Favicons } from '@/services/favicons'
import * as Messages from '@/services/foreground-messages'
import { SessionTree } from '@/services/foreground-tree'
import { closeModal, ModalState } from '@/services/modal-state'
import { subscribeTreeUpdates } from '@/services/runtime-port-service'
import { Selection } from '@/services/selection'
import * as ToolbarActions from '@/services/session-tree-toolbar-actions'
import { Settings } from '@/services/settings'
import {
  buildIndentGuideStates,
  createTreeItemTally,
  formatStateBreakdown,
  formatTallyLine,
  formatTallyLines,
  tallyTreeItem,
  type TreeItemIndentGuideState,
} from '@/services/tree-utils'
import { normalizeEditTextValue } from '@/services/utils'
import '@/styles/variables.css'
import { ContextMenuType } from '@/types/context-menu'
import type { ContainerRecoveryStrategy } from '@/types/messages'
import {
  State,
  TreeItem as SessionTreeItem,
  TreeItemType,
} from '@/types/session-tree'
import { computed, onBeforeUnmount, onMounted, ref } from 'vue'

let unsubscribeFromTreeUpdates: (() => void) | undefined
let removeRuntimeListener: (() => void) | undefined
let removeContextMenuListener: (() => void) | undefined
let isSessionTreeUnmounted = false

// Save Session Tree Window location and size before closing.
window.onbeforeunload = () => {
  const bounds = {
    width: window.outerWidth,
    height: window.outerHeight,
    left: window.screenLeft,
    top: window.screenTop,
  }
  localStorage.setItem('sessionTreeWindowConfig', JSON.stringify(bounds))

  Selection.clearSelection()
  Messages.deselectAllItems()

  console.log('Unloading')
  unsubscribeFromTreeUpdates?.()
  faviconService.saveCacheToStorage()
}

const faviconService = Favicons
const faviconRevision = ref(0)
const containerRecoveryPending = ref(false)
const deleteTreeItemsPending = ref(false)
const blockingModalActive = computed(
  () =>
    ModalState.active?.kind === 'containerRecovery' ||
    ModalState.active?.kind === 'deleteTreeItems',
)

// Persisted here rather than in Settings: this is view state for one window,
// not a preference worth syncing.
const ROOT_COLLAPSED_KEY = 'sessionTreeRootCollapsed'
const rootCollapsed = ref(localStorage.getItem(ROOT_COLLAPSED_KEY) === 'true')

function toggleRootCollapsed() {
  rootCollapsed.value = !rootCollapsed.value
  localStorage.setItem(ROOT_COLLAPSED_KEY, String(rootCollapsed.value))
}

/*
 * Tallies every tab in the tree by session state. This is what makes
 * collapsing the root worth doing: the whole session in one row.
 */
const treeComposition = computed(() => {
  const tally = createTreeItemTally()

  for (const item of SessionTree.reactiveItems.value as SessionTreeItem[]) {
    if (item.type !== TreeItemType.WINDOW) continue
    for (const child of item.children) tallyTreeItem(tally, child)
  }

  // Summed from the three drawn states rather than tally.tabs, so the number
  // always matches what the bar beside it accounts for.
  const breakdown = formatStateBreakdown(tally)
  return {
    open: tally.open,
    unloaded: tally.unloaded,
    saved: tally.saved,
    total: tally.open + tally.unloaded + tally.saved,
    title: breakdown || 'No tabs',
  }
})

/*
 * The same summary a window row gives, one level up. Items parked at the root
 * are counted alongside the ones inside windows: the row stands for the whole
 * session, so its tally has to as well.
 */
const sessionHoverDetails = computed(() => {
  const tally = createTreeItemTally()
  let windowsOpen = 0
  let windowsSaved = 0
  let windows = 0

  for (const item of SessionTree.reactiveItems.value as SessionTreeItem[]) {
    if (item.type !== TreeItemType.WINDOW) {
      tallyTreeItem(tally, item)
      continue
    }
    windows++
    if (item.state === State.OPEN) windowsOpen++
    else if (item.state === State.SAVED) windowsSaved++
    for (const child of item.children) tallyTreeItem(tally, child)
  }

  return [
    'Session',
    formatTallyLine(
      'Windows',
      windows,
      formatStateBreakdown({
        open: windowsOpen,
        unloaded: 0,
        saved: windowsSaved,
      }),
    ),
    ...formatTallyLines(tally),
  ].join('\n')
})

const visibleTreeItems = computed<SessionTreeItem[]>(() => {
  if (rootCollapsed.value) return []
  const items: SessionTreeItem[] = []
  const appendVisibleList = (list: SessionTreeItem[]) => {
    list.forEach((item) => {
      if (item.parentUid === undefined || item.isVisible !== false) {
        appendVisible(item)
      }
    })
  }
  const appendVisible = (item: SessionTreeItem) => {
    if (item.isVisible !== false) {
      items.push(item)
      if (!item.collapsed && item.type === TreeItemType.WINDOW) {
        appendVisibleList(item.children)
      }
    }
  }
  appendVisibleList(SessionTree.reactiveItems.value as SessionTreeItem[])
  return items
})

const indentGuideStates = computed(() => {
  const topLevelItems = SessionTree.reactiveItems.value as SessionTreeItem[]
  const topLevelStates = buildIndentGuideStates(topLevelItems)
  const states = new Map<SessionTreeItem['uid'], TreeItemIndentGuideState>(
    topLevelStates,
  )

  for (const item of topLevelItems) {
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

// On component mount
onMounted(async () => {
  console.log('Mounted')
  await Settings.loadSettingsFromStorage()
  Settings.setupSettingsUpdatedListener()
  removeContextMenuListener = ContextMenu.setupContextMenuLifecycle()

  await faviconService.init().then(async () => {
    const openTabs = await window.browser.tabs.query({})
    faviconService.warmCacheFromTabs(openTabs)
  })

  if (isSessionTreeUnmounted) {
    return
  }
  unsubscribeFromTreeUpdates = subscribeTreeUpdates({
    replaceTree: (items) => SessionTree.replaceSessionTree(items),
    applyDelta: (delta) => SessionTree.applyDelta(delta),
    onError: (error) => {
      console.error('Session tree synchronization error', error)
    },
  })

  // Listen for messages from the background script
  const faviconListener = (message: {
    type?: string
    favIconUrl?: string
    pageUrl?: string
    tab?: unknown
  }) => {
    switch (message.type) {
      case 'FAVICON_UPDATED':
        console.log('FaviconUpdated message received')
        if (message.favIconUrl) {
          void faviconService
            .updateFavicon(message.favIconUrl, message.tab as browser.tabs.Tab)
            .then(() => {
              faviconRevision.value += 1
            })
        }
        break
      case 'FAVICON_CLEARED':
        if (message.pageUrl) {
          faviconService.markPageWithoutFavicon(message.pageUrl)
          faviconRevision.value += 1
        }
        break
      case 'FAVICON_CACHE_UPDATED':
        void faviconService.reloadCacheFromStorage().then(() => {
          faviconRevision.value += 1
        })
        break
      default:
      // console.warn('Unknown message type:', message.type)
    }
  }
  window.browser.runtime.onMessage.addListener(faviconListener)
  removeRuntimeListener = () => {
    window.browser.runtime.onMessage.removeListener(faviconListener)
  }

  const currentWindow = await window.browser.windows.getCurrent()
  if (typeof currentWindow.id === 'number') {
    Messages.registerSessionTreeWindow(currentWindow.id)
  }
})

// reset sessionTree to non-ref object to avoid zombie dead object
onBeforeUnmount(() => {
  isSessionTreeUnmounted = true
  console.log('Unmounted')
  unsubscribeFromTreeUpdates?.()
  removeRuntimeListener?.()
  removeContextMenuListener?.()
})

// Handler functions

function onClick() {
  Selection.clearSelection()
}

function openPanelContextMenu(event: MouseEvent) {
  ContextMenu.handleContextMenuClick(ContextMenuType.Panel, event)
}

function handleEditWindowTitleConfirm(newTitle: string) {
  if (ModalState.active?.kind === 'editWindowTitle') {
    Messages.updateWindowTitle(
      ModalState.active.window.uid,
      normalizeEditTextValue('window-title', newTitle) ?? '',
    )
  }
  closeModal()
}

function handleEditWindowTitleCancel() {
  closeModal()
}

function handleEditCustomLabelConfirm(label: string) {
  if (ModalState.active?.kind === 'editCustomLabel') {
    Messages.updateCustomLabel(
      ModalState.active.uid,
      normalizeEditTextValue('custom-label', label),
    )
  }
  closeModal()
}

function handleEditNoteConfirm(text: string) {
  if (ModalState.active?.kind === 'editNote') {
    Messages.updateNoteText(
      ModalState.active.note.uid,
      normalizeEditTextValue('note', text) ?? '',
    )
  }
  closeModal()
}

function handleEditNoteCancel() {
  closeModal()
}

function handleEditCustomLabelCancel() {
  closeModal()
}

async function handleContainerRecovery(strategy: ContainerRecoveryStrategy) {
  if (containerRecoveryPending.value) return
  containerRecoveryPending.value = true
  try {
    await Messages.resolveContainerRecoveryModal(strategy)
  } finally {
    containerRecoveryPending.value = false
  }
}

async function handleDeleteTreeItemsConfirm(): Promise<void> {
  if (
    deleteTreeItemsPending.value ||
    ModalState.active?.kind !== 'deleteTreeItems'
  ) {
    return
  }
  const itemUids = [...ModalState.active.itemUids]
  deleteTreeItemsPending.value = true
  try {
    await Messages.deleteTreeItems(itemUids)
  } finally {
    closeModal()
    Selection.clearSelection()
    deleteTreeItemsPending.value = false
  }
}

function runToolbarAction(action: () => void | Promise<void>): void {
  Selection.clearSelection()
  Promise.resolve(action()).catch((error) => {
    console.error('Session tree toolbar action failed:', error)
  })
}
</script>

<template>
  <div
    class="sessiontree"
    @contextmenu.prevent
    @click="onClick"
  >
    <div
      class="sessiontree-content"
      tabindex="-1"
      :inert="blockingModalActive"
      :aria-hidden="blockingModalActive"
      @contextmenu.stop="openPanelContextMenu"
      @dragend="DragAndDrop.onDragEnd"
      @dragenter.stop.prevent="DragAndDrop.onDragEnter"
      @dragleave="DragAndDrop.onDragLeave"
      @dragover.stop.prevent="DragAndDrop.onDragMove"
      @drop.stop.prevent="DragAndDrop.onDrop"
    >
      <div
        class="hiddenAssets"
        style="display: none"
      >
        <svg>
          <use :xlink:href="`#${IconChevronRight}`" />
          <use :xlink:href="`#${IconPinned}`" />
        </svg>
      </div>

      <div
        class="session-root"
        :title="sessionHoverDetails"
      >
        <div
          class="session-root-toggle"
          role="button"
          tabindex="0"
          :aria-expanded="!rootCollapsed"
          :aria-label="
            rootCollapsed ? 'Expand all windows' : 'Collapse all windows'
          "
          :title="rootCollapsed ? 'Expand all windows' : 'Collapse all windows'"
          @click.stop="toggleRootCollapsed()"
          @keydown.enter.prevent="toggleRootCollapsed()"
          @keydown.space.prevent="toggleRootCollapsed()"
        >
          <svg
            class="session-root-arrow"
            :class="{ collapsed: rootCollapsed }"
          >
            <use :xlink:href="'#chevron-right'" />
          </svg>
        </div>
        <span class="session-root-label">Session</span>
        <div class="session-root-meta">
          <span
            class="session-root-composition"
            role="img"
            :aria-label="treeComposition.title"
          >
            <i
              v-if="treeComposition.open"
              class="session-root-composition-open"
              :style="{ flexGrow: treeComposition.open }"
            ></i>
            <i
              v-if="treeComposition.unloaded"
              class="session-root-composition-unloaded"
              :style="{ flexGrow: treeComposition.unloaded }"
            ></i>
            <i
              v-if="treeComposition.saved"
              class="session-root-composition-saved"
              :style="{ flexGrow: treeComposition.saved }"
            ></i>
          </span>
          <span class="session-root-count">{{ treeComposition.total }}</span>
        </div>
      </div>

      <template
        v-for="item in visibleTreeItems"
        :key="item.uid"
      >
        <TreeItem
          :item="item"
          :favicon-service="faviconService"
          :favicon-revision="faviconRevision"
          :indent-guide-state="indentGuideStates.get(item.uid)"
        />
      </template>

      <div
        class="tree-end-drop-target drag-and-drop-target"
        drag-and-drop-id="tree-end"
        drag-and-drop-type="tree-end"
        aria-hidden="true"
      ></div>
    </div>

    <SessionTreeNotification
      :inert="blockingModalActive"
      :aria-hidden="blockingModalActive"
    />

    <SessionTreeToolbar
      :inert="blockingModalActive"
      :aria-hidden="blockingModalActive"
      @add-note="runToolbarAction(ToolbarActions.addRootNote)"
      @add-separator="runToolbarAction(ToolbarActions.addRootSeparator)"
      @new-window="runToolbarAction(ToolbarActions.createNewWindow)"
      @new-tab="runToolbarAction(ToolbarActions.createNewTab)"
      @open-settings="runToolbarAction(ToolbarActions.openSettings)"
    />

    <EditTextModal
      v-if="ModalState.active?.kind === 'editWindowTitle'"
      title="Edit Window Title"
      :initial-value="ModalState.active.window.title || ''"
      :max-length="150"
      placeholder="Enter window title"
      @confirm="handleEditWindowTitleConfirm"
      @cancel="handleEditWindowTitleCancel"
    />

    <EditTextModal
      v-if="ModalState.active?.kind === 'editCustomLabel'"
      title="Edit Custom Label"
      :initial-value="ModalState.active.customLabel || ''"
      :max-length="150"
      placeholder="Enter custom label"
      @confirm="handleEditCustomLabelConfirm"
      @cancel="handleEditCustomLabelCancel"
    />

    <EditTextModal
      v-if="ModalState.active?.kind === 'editNote'"
      title="Edit Note"
      :initial-value="ModalState.active.note.text"
      :max-length="500"
      multiline
      placeholder="Enter note text"
      @confirm="handleEditNoteConfirm"
      @cancel="handleEditNoteCancel"
    />

    <ContainerRecoveryModal
      v-if="ModalState.active?.kind === 'containerRecovery'"
      :containers="ModalState.active.missingContainers"
      :pending="containerRecoveryPending"
      @recreate="handleContainerRecovery('recreate')"
      @without-container="handleContainerRecovery('without-container')"
      @cancel="closeModal()"
    />

    <DeleteTreeItemsModal
      v-if="ModalState.active?.kind === 'deleteTreeItems'"
      :counts="ModalState.active.counts"
      :pending="deleteTreeItemsPending"
      @confirm="handleDeleteTreeItemsConfirm"
      @cancel="closeModal()"
    />
  </div>
</template>

<style scoped>
.sessiontree {
  display: flex;
  flex-direction: column;
  min-width: 200px;
  width: 100%;
  overflow-x: hidden;
  overflow-y: hidden;
  height: 100vh;
  position: relative;
  margin: 0;
  background-color: var(--tree-background);
}

/* The one row every top-level item hangs from. Collapsing it reduces the
   whole session to a single line and its composition bar. */
.session-root {
  align-items: center;
  background-color: var(--tree-background);
  border-bottom: 1px solid var(--tree-edge);
  display: flex;
  position: sticky;
  top: 0;
  z-index: 25;
  gap: 5px;
  margin-bottom: 4px;
  min-height: 24px;
  padding: 0 16px 2px 8px;
}

.session-root-toggle {
  align-items: center;
  cursor: pointer;
  display: flex;
  flex: 0 0 12px;
  height: 12px;
  justify-content: center;
}

.session-root-toggle:focus-visible {
  outline: 2px solid var(--state-live);
  outline-offset: 2px;
}

.session-root-arrow {
  height: 12px;
  stroke: var(--list-icon-foreground);
  transform: rotate(90deg);
  transition: transform 0.2s linear;
  width: 12px;
}

.session-root-arrow.collapsed {
  transform: rotate(0deg);
}

.session-root-label {
  color: var(--list-item-discarded-foreground);
  font-family: var(--font-mono);
  font-size: var(--font-size-xxs);
  letter-spacing: 0.12em;
  text-transform: uppercase;
}

.session-root-meta {
  align-items: center;
  display: flex;
  gap: 7px;
  margin-inline-start: auto;
}

.session-root-composition {
  background: rgba(255, 255, 255, 0.06);
  border-radius: 2px;
  display: flex;
  gap: 1px;
  height: 3px;
  overflow: hidden;
  width: 56px;
}

.session-root-composition-open {
  background: var(--state-live);
}

.session-root-composition-unloaded {
  background: color-mix(in srgb, var(--state-live) 45%, transparent);
}

.session-root-composition-saved {
  background: color-mix(in srgb, var(--state-rest) 62%, transparent);
}

.session-root-count {
  color: var(--list-item-discarded-foreground);
  font-family: var(--font-mono);
  font-size: var(--font-size-2xs);
  font-variant-numeric: tabular-nums;
  font-weight: 600;
  min-width: 17px;
  text-align: end;
}

.sessiontree-content {
  flex: 1 1 auto;
  min-height: 0;
  overflow-x: hidden;
  overflow-y: auto;
}

.tree-end-drop-target {
  position: relative;
  min-height: calc(95vh - 34px);
}
</style>

<style>
body {
  position: relative;
  width: 100%;
  height: 100%;
  overflow: hidden;
  padding: 0;
  margin: 0;
}

.tree-item.drag-over-tree-end::after,
.tree-end-drop-target.drag-over-tree-end::before {
  content: '';
  position: absolute;
  left: calc(
    16px + var(--tree-root-step) + var(--prepend-width, 16px) *
      (var(--drop-indent-level, 0) + 1)
  );
  right: 8px;
  height: 2px;
  background: var(--drag-and-drop-foreground);
  z-index: 20;
  border-radius: 2px;
}

.tree-item.drag-over-tree-end::after {
  bottom: -1px;
}

.tree-end-drop-target.drag-over-tree-end::before {
  top: -1px;
}
</style>
