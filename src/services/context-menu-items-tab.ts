import { i18n } from '@/services/i18n'
import * as Messages from '@/services/foreground-messages'
import { openModal } from '@/services/modal-state'
import { Selection } from '@/services/selection'
import { SessionTree } from '@/services/foreground-tree'
import { containerMenuIcon } from '@/services/container-menu-icons'
import {
  collectContextMenuActionItems,
  type ContextMenuDescendantScope,
} from '@/services/selection-actions'
import { Settings } from '@/services/settings'
import { ContextMenuItem } from '@/types/context-menu'
import { State, type Tab, TreeItemType } from '@/types/session-tree'

export const contextMenuItemsTab: Record<string, () => ContextMenuItem> = {
  setContainer: () => {
    const selectedTabs = Selection.getSelectedTabs()
    const tabs = selectedTabs.filter(
      (tab) => SessionTree.windowsByUid.get(tab.windowUid)?.incognito === false,
    )
    return {
      id: 'setContainer',
      label: i18n.t('setContainer'),
      enabled: tabs.length > 0 || selectedTabs.some((tab) => tab.container),
      submenu: [
        {
          id: 'noContainer',
          label: i18n.t('noContainer'),
          enabled: selectedTabs.some((tab) => tab.container),
          action: () =>
            Messages.setTabsContainer(
              selectedTabs.filter((tab) => tab.container).map((tab) => tab.uid),
            ),
        },
      ],
      loadSubmenu: async () => {
        if (!tabs.length) return []
        try {
          const containers = await browser.contextualIdentities.query({})
          const choices = await Promise.all(
            containers.map(async (container) => ({
              id: `container-${container.cookieStoreId}`,
              label: container.name,
              icons: { '16': await containerMenuIcon(container) },
              action: () =>
                Messages.setTabsContainer(
                  tabs.map((tab) => tab.uid),
                  container.cookieStoreId,
                ),
            })),
          )
          return [
            { id: 'afterNoContainer', label: '', type: 'separator' },
            ...choices,
            ...(choices.length
              ? [
                  {
                    id: 'beforeNewContainer',
                    label: '',
                    type: 'separator' as const,
                  },
                ]
              : []),
            {
              id: 'newContainer',
              label: i18n.t('newContainer'),
              action: () =>
                openModal({
                  kind: 'createContainer',
                  tabUids: tabs.map((tab) => tab.uid),
                }),
            },
          ]
        } catch {
          // Clearing saved metadata remains available with containers disabled.
          return []
        }
      },
    }
  },

  openTab: () => {
    const tabs = selectedTabsForScope(
      Settings.values.contextMenuOpenDescendants,
    )
    return {
      id: 'openTab',
      label: i18n.t('open'),
      icon: 'open',
      enabled: tabs.some((tab) => tab.state === State.SAVED),
      action: () => Messages.openTabs(tabs),
    }
  },

  reloadTab: () => {
    const tabs = selectedTabsForScope(
      Settings.values.contextMenuReloadDescendants,
    )
    return {
      id: 'reloadTab',
      label: i18n.t('reload'),
      icon: 'reload',
      enabled: tabs.some(isOpenTab),
      action: () => Messages.reloadTabs(tabs),
    }
  },

  saveTab: () => {
    const tabs = selectedTabsForScope(
      Settings.values.contextMenuSaveDescendants,
    )
    return {
      id: 'saveTab',
      label: i18n.t('save'),
      icon: 'save',
      enabled: tabs.some(isOpenTab),
      action: () => Messages.saveTabs(tabs),
    }
  },

  pinTab: () => {
    const tabs = selectedTabsForScope(Settings.values.contextMenuPinDescendants)
    return {
      id: 'pinTab',
      label: i18n.t('pin'),
      icon: 'pin',
      enabled: tabs.some((tab) => !tab.pinned),
      action: () => Messages.pinTabs(tabs),
    }
  },

  unpinTab: () => {
    const tabs = selectedTabsForScope(Settings.values.contextMenuPinDescendants)
    return {
      id: 'unpinTab',
      label: i18n.t('unpin'),
      icon: 'unpin',
      enabled: tabs.some((tab) => tab.pinned),
      action: () => Messages.unpinTabs(tabs),
    }
  },

  editLabel: () => {
    return {
      id: 'editLabel',
      label: i18n.t('editLabel'),
      icon: 'edit',
      enabled: onlySingleTabSelected(),
      action: () => {
        const selectedTabs = Selection.getSelectedTabs()
        if (selectedTabs.length === 1) {
          openModal({
            kind: 'editCustomLabel',
            uid: selectedTabs[0].uid,
            customLabel: selectedTabs[0].customLabel,
          })
        }
      },
    }
  },
}

function selectedTabsForScope(scope: ContextMenuDescendantScope): Tab[] {
  return collectContextMenuActionItems(
    Selection.selectedItems.value.map((selected) => selected.item),
    scope,
  ).filter((item): item is Tab => item.type === TreeItemType.TAB)
}

function isOpenTab(tab: Tab): boolean {
  return tab.state === State.OPEN || tab.state === State.DISCARDED
}

function onlySingleTabSelected(): boolean {
  const selectedTabs = Selection.getSelectedTabs()
  return selectedTabs.length === 1
}
