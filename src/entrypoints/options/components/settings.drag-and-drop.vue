<script lang="ts" setup>
import ToggleButton from '@/components/ToggleButton.vue'
import { Settings } from '@/services/settings'
import { OPTIONS } from '@/types/settings'
import { STRINGS } from '@/types/strings'
</script>

<template>
  <section id="settings_drag_and_drop" class="content-panel-section">
    <h2>{{ STRINGS.settings_drag_and_drop }}</h2>
    <ToggleButton
      label="Enable Drag And Drop"
      v-model="Settings.values.enableDragAndDrop"
      :options="OPTIONS.boolean"
      @update="Settings.saveSettingsToStorage()"
    />
    <ToggleButton
      class="dependent-element"
      label="Enable Drop from External Sources"
      v-model="Settings.values.enableDropFromExternalSources"
      :options="OPTIONS.boolean"
      :disabled="!Settings.values.enableDragAndDrop"
      @update="Settings.saveSettingsToStorage()"
    />
    <ToggleButton
      class="dependent-element"
      label="On Drag, Include Selected Items with Dragged Item"
      v-model="Settings.values.includeSelectedItemsWithDraggedItem"
      :options="OPTIONS.boolean"
      :disabled="!Settings.values.enableDragAndDrop"
      @update="Settings.saveSettingsToStorage()"
    />
    <ToggleButton
      class="dependent-element"
      label="On Drag, Include Children of Selected Items"
      v-model="Settings.values.includeChildrenOfSelectedItems"
      :options="OPTIONS.includeChildrenOfSelectedItems"
      :disabled="!Settings.values.enableDragAndDrop"
      @update="Settings.saveSettingsToStorage()"
    />
  </section>
</template>

<style scoped>
.dependent-element {
  opacity: var(--child-opacity, 1);
  pointer-events: var(--child-events, auto);
}

.dependent-element:has(input:disabled),
.dependent-element:has(button:disabled) {
  --child-opacity: 0.5;
  --child-events: none;
}
</style>
