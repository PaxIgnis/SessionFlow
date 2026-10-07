<script lang="ts" setup>
import { i18n } from '@/services/i18n'
import ToggleButton from '@/components/ToggleButton.vue'
import { Settings } from '@/services/settings'
import { OPTIONS } from '@/types/settings'
</script>

<template>
  <section
    id="settings_drag_and_drop"
    class="content-panel-section section"
  >
    <div class="section-head">
      <div class="section-head-text">
        <h2 class="section-title">{{ i18n.t('dragAndDrop') }}</h2>
        <p class="section-intro">
          {{ i18n.t('rearrangeTheTreeByDraggingItemsWithinItTurnThis') }}
        </p>
      </div>
      <ToggleButton
        class="section-master"
        :label="i18n.t('enableDragAndDrop')"
        v-model="Settings.values.enableDragAndDrop"
        :options="OPTIONS.boolean"
        @update="Settings.saveSettingsToStorage()"
      />
    </div>
    <div
      class="section-body"
      :data-disabled="!Settings.values.enableDragAndDrop"
      :inert="!Settings.values.enableDragAndDrop"
    >
      <div class="rows">
        <ToggleButton
          :label="i18n.t('holdAltWhileDraggingToCopy')"
          v-model="Settings.values.enableCopyOnDragAndDrop"
          :options="OPTIONS.boolean"
          :disabled="!Settings.values.enableDragAndDrop"
          @update="Settings.saveSettingsToStorage()"
        />
        <ToggleButton
          :label="i18n.t('acceptDropsFromOtherApps')"
          :description="i18n.t('linksDraggedFromOutsideFirefoxBecomeSavedTabs')"
          v-model="Settings.values.enableDropFromExternalSources"
          :options="OPTIONS.boolean"
          :disabled="!Settings.values.enableDragAndDrop"
          @update="Settings.saveSettingsToStorage()"
        />
        <ToggleButton
          :label="i18n.t('dragTheWholeSelectionNotJustTheGrabbedItem')"
          v-model="Settings.values.includeSelectedItemsWithDraggedItem"
          :options="OPTIONS.boolean"
          :disabled="!Settings.values.enableDragAndDrop"
          @update="Settings.saveSettingsToStorage()"
        />
        <ToggleButton
          :label="i18n.t('includeChildrenOfSelectedItems')"
          v-model="Settings.values.includeChildrenOfSelectedItems"
          :options="OPTIONS.includeChildrenOfSelectedItems"
          :disabled="!Settings.values.enableDragAndDrop"
          @update="Settings.saveSettingsToStorage()"
        />
        <ToggleButton
          :label="i18n.t('keepHierarchyOnDrop')"
          :description="
            i18n.t(
              'droppedItemsKeepTheirParentchildRelationshipsInsteadOfFlattening',
            )
          "
          v-model="Settings.values.tryToMaintainHierarchyOfDraggedItems"
          :options="OPTIONS.boolean"
          :disabled="
            !Settings.values.enableDragAndDrop ||
            Settings.values.includeChildrenOfSelectedItems === 'never'
          "
          @update="Settings.saveSettingsToStorage()"
        />
        <ToggleButton
          :label="i18n.t('keepCollapsedStateOnDrop')"
          v-model="Settings.values.tryToMaintainCollapsedStateOfDraggedItems"
          :options="OPTIONS.boolean"
          :disabled="
            !Settings.values.enableDragAndDrop ||
            Settings.values.includeChildrenOfSelectedItems === 'never' ||
            !Settings.values.tryToMaintainHierarchyOfDraggedItems
          "
          @update="Settings.saveSettingsToStorage()"
        />
        <ToggleButton
          :label="i18n.t('allowDroppingOntoDescendants')"
          v-model="Settings.values.allowDropOntoDescendantItems"
          :options="OPTIONS.boolean"
          :disabled="!Settings.values.enableDragAndDrop"
          @update="Settings.saveSettingsToStorage()"
        />
      </div>
    </div>
  </section>
</template>
