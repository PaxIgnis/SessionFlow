<script lang="ts" setup>
import ToggleButton from '@/components/ToggleButton.vue'
import { Settings } from '@/services/settings'
import { OPTIONS } from '@/types/settings'
import { STRINGS } from '@/types/strings'
</script>

<template>
  <section
    id="settings_drag_and_drop"
    class="content-panel-section section"
  >
    <div class="section-head">
      <div class="section-head-text">
        <h2 class="section-title">{{ STRINGS.settings_drag_and_drop }}</h2>
        <p class="section-intro">
          Rearrange the tree by dragging items within it. Turn this off to lock
          the tree's shape.
        </p>
      </div>
      <ToggleButton
        class="section-master"
        label="Enable drag and drop"
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
          label="Hold Alt while dragging to copy"
          v-model="Settings.values.enableCopyOnDragAndDrop"
          :options="OPTIONS.boolean"
          :disabled="!Settings.values.enableDragAndDrop"
          @update="Settings.saveSettingsToStorage()"
        />
        <ToggleButton
          label="Accept drops from other apps"
          description="Links dragged from outside Firefox become saved tabs."
          v-model="Settings.values.enableDropFromExternalSources"
          :options="OPTIONS.boolean"
          :disabled="!Settings.values.enableDragAndDrop"
          @update="Settings.saveSettingsToStorage()"
        />
        <ToggleButton
          label="Drag the whole selection, not just the grabbed item"
          v-model="Settings.values.includeSelectedItemsWithDraggedItem"
          :options="OPTIONS.boolean"
          :disabled="!Settings.values.enableDragAndDrop"
          @update="Settings.saveSettingsToStorage()"
        />
        <ToggleButton
          label="Include children of selected items"
          v-model="Settings.values.includeChildrenOfSelectedItems"
          :options="OPTIONS.includeChildrenOfSelectedItems"
          :disabled="!Settings.values.enableDragAndDrop"
          @update="Settings.saveSettingsToStorage()"
        />
        <ToggleButton
          label="Keep hierarchy on drop"
          description="Dropped items keep their parent-child relationships instead of flattening."
          v-model="Settings.values.tryToMaintainHierarchyOfDraggedItems"
          :options="OPTIONS.boolean"
          :disabled="
            !Settings.values.enableDragAndDrop ||
            Settings.values.includeChildrenOfSelectedItems === 'never'
          "
          @update="Settings.saveSettingsToStorage()"
        />
        <ToggleButton
          label="Keep collapsed state on drop"
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
          label="Allow dropping onto descendants"
          v-model="Settings.values.allowDropOntoDescendantItems"
          :options="OPTIONS.boolean"
          :disabled="!Settings.values.enableDragAndDrop"
          @update="Settings.saveSettingsToStorage()"
        />
      </div>
    </div>
  </section>
</template>
