<script lang="ts" setup>
import IconChevronRight from '@/assets/chevron-right.svg'
import IconPinned from '@/assets/pinned.svg'
import ContainerRecoveryModal from '@/components/ContainerRecoveryModal.vue'
import EditTextModal from '@/components/EditTextModal.vue'
import SessionTreeNotification from '@/components/SessionTreeNotification.vue'
import SessionTreeToolbar from '@/components/SessionTreeToolbar.vue'
import TreeItem from '@/components/TreeItem.vue'
import { DragAndDrop } from '@/services/drag-and-drop'
import { Favicons } from '@/services/favicons'
import * as Messages from '@/services/foreground-messages'
import { SessionTree } from '@/services/foreground-tree'
import { closeModal, ModalState } from '@/services/modal-state'
import {
  disconnectTreePort,
  onTreeDeltaPort,
  subscribeTreePort,
} from '@/services/runtime-port-service'
import { Selection } from '@/services/selection'
import * as ToolbarActions from '@/services/session-tree-toolbar-actions'
import { Settings } from '@/services/settings'
import '@/styles/variables.css'
import type { ContainerRecoveryStrategy } from '@/types/messages'
import { TreeItem as SessionTreeItem, TreeItemType } from '@/types/session-tree'
import { computed, onBeforeUnmount, onMounted, ref } from 'vue'

let unsubscribeFromTreeDelta: (() => void) | undefined
let removeRuntimeListener: (() => void) | undefined
let isSessionTreeUnmounted = false

const wait = (ms: number) =>
  new Promise<void>((resolve) => setTimeout(resolve, ms))

async function subscribeTreePortWithRetry() {
  while (!isSessionTreeUnmounted) {
    try {
      return await subscribeTreePort()
    } catch (error) {
      console.error('Failed to subscribe to tree port, retrying...', error)
      await wait(250)
    }
  }
  return []
}

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
  disconnectTreePort()
  faviconService.saveCacheToStorage()
}

const faviconService = Favicons
const faviconRevision = ref(0)
const containerRecoveryPending = ref(false)
const containerRecoveryActive = computed(
  () => ModalState.active?.kind === 'containerRecovery',
)

const visibleTreeItems = computed<SessionTreeItem[]>(() => {
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

// On component mount
onMounted(async () => {
  console.log('Mounted')
  await Settings.loadSettingsFromStorage()
  Settings.setupSettingsUpdatedListener()

  await faviconService.init().then(async () => {
    const openTabs = await window.browser.tabs.query({})
    faviconService.warmCacheFromTabs(openTabs)
  })

  const initialSnapshot = await subscribeTreePortWithRetry()
  if (isSessionTreeUnmounted) {
    return
  }
  SessionTree.replaceSessionTree(initialSnapshot)
  unsubscribeFromTreeDelta = onTreeDeltaPort((delta) => {
    SessionTree.applyDelta(delta)
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
          const tabLike = message.tab as { url?: string } | undefined
          void faviconService
            .updateFavicon(message.favIconUrl, undefined, tabLike?.url)
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
  unsubscribeFromTreeDelta?.()
  removeRuntimeListener?.()
  disconnectTreePort()
})

// Handler functions

function onClick() {
  Selection.clearSelection()
}

function handleEditWindowTitleConfirm(newTitle: string) {
  if (ModalState.active?.kind === 'editWindowTitle') {
    Messages.updateWindowTitle(
      ModalState.active.window.uid,
      newTitle.slice(0, 150),
    )
  }
  closeModal()
}

function handleEditWindowTitleCancel() {
  closeModal()
}

function handleEditCustomLabelConfirm(label: string) {
  if (ModalState.active?.kind === 'editCustomLabel') {
    const sanitized = label.slice(0, 150).trim()
    Messages.updateCustomLabel(
      ModalState.active.uid,
      sanitized.length > 0 ? sanitized : undefined,
    )
  }
  closeModal()
}

function handleEditNoteConfirm(text: string) {
  if (ModalState.active?.kind === 'editNote') {
    Messages.updateNoteText(ModalState.active.note.uid, text.slice(0, 500))
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
      :inert="containerRecoveryActive"
      :aria-hidden="containerRecoveryActive"
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

      <template
        v-for="item in visibleTreeItems"
        :key="item.uid"
      >
        <TreeItem
          :item="item"
          :favicon-service="faviconService"
          :favicon-revision="faviconRevision"
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
      :inert="containerRecoveryActive"
      :aria-hidden="containerRecoveryActive"
    />

    <SessionTreeToolbar
      :inert="containerRecoveryActive"
      :aria-hidden="containerRecoveryActive"
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
      placeholder="Enter window title"
      @confirm="handleEditWindowTitleConfirm"
      @cancel="handleEditWindowTitleCancel"
    />

    <EditTextModal
      v-if="ModalState.active?.kind === 'editCustomLabel'"
      title="Edit Custom Label"
      :initial-value="ModalState.active.customLabel || ''"
      placeholder="Enter custom label"
      @confirm="handleEditCustomLabelConfirm"
      @cancel="handleEditCustomLabelCancel"
    />

    <EditTextModal
      v-if="ModalState.active?.kind === 'editNote'"
      title="Edit Note"
      :initial-value="ModalState.active.note.text"
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
  background-color: var(--background-color-secondary);
}

.sessiontree-content {
  flex: 1 1 auto;
  min-height: 0;
  overflow-x: hidden;
  overflow-y: auto;
}

.tree-end-drop-target {
  position: relative;
  min-height: calc(95vh - 42px);
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
    16px + var(--prepend-width, 16px) * (var(--drop-indent-level, 0) + 1)
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
