<script lang="ts" setup>
import ToggleButton from '@/components/ToggleButton.vue'
import { Settings } from '@/services/settings'
import { OPTIONS } from '@/types/settings'
import { STRINGS } from '@/types/strings'
</script>

<template>
  <section
    id="settings_context_menu"
    class="content-panel-section"
  >
    <h2>{{ STRINGS.settings_context_menu }}</h2>
    <h3 class="descendant-settings-heading">
      When to Apply Actions to Unselected Descendant Items:
    </h3>
    <ToggleButton
      class="child-setting"
      label="When Deleting"
      v-model="Settings.values.contextMenuDeleteDescendants"
      :options="OPTIONS.includeChildrenOfSelectedItems"
      @update="Settings.saveSettingsToStorage()"
    />
    <ToggleButton
      class="child-setting"
      label="When Duplicating"
      v-model="Settings.values.duplicateTreeItemDescendants"
      :options="OPTIONS.duplicateTreeItemDescendants"
      @update="Settings.saveSettingsToStorage()"
    />
    <ToggleButton
      class="child-setting"
      label="When Opening Saved Tabs"
      v-model="Settings.values.contextMenuOpenDescendants"
      :options="OPTIONS.includeChildrenOfSelectedItems"
      @update="Settings.saveSettingsToStorage()"
    />
    <ToggleButton
      class="child-setting"
      label="When Reloading Tabs"
      v-model="Settings.values.contextMenuReloadDescendants"
      :options="OPTIONS.includeChildrenOfSelectedItems"
      @update="Settings.saveSettingsToStorage()"
    />
    <ToggleButton
      class="child-setting"
      label="When Saving Tabs"
      v-model="Settings.values.contextMenuSaveDescendants"
      :options="OPTIONS.includeChildrenOfSelectedItems"
      @update="Settings.saveSettingsToStorage()"
    />
    <ToggleButton
      class="child-setting"
      label="When Pinning or Unpinning Tabs"
      v-model="Settings.values.contextMenuPinDescendants"
      :options="OPTIONS.includeChildrenOfSelectedItems"
      @update="Settings.saveSettingsToStorage()"
    />
    <ToggleButton
      class="child-setting"
      label="When Adjusting Indent"
      v-model="Settings.values.includeChildrenOfSelectedItemsWhenIndenting"
      :options="OPTIONS.includeChildrenOfSelectedItemsWhenIndenting"
      @update="Settings.saveSettingsToStorage()"
    />
  </section>
</template>

<style scoped>
.descendant-settings-heading {
  margin: 12px 0 0;
  color: var(--text-color-primary);
  font-size: var(--font-size-sm);
}

.child-setting {
  margin-left: 20px;
}
</style>
