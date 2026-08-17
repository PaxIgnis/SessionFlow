<script lang="ts" setup>
import ToggleButton from '@/components/ToggleButton.vue'
import { Settings } from '@/services/settings'
import { OPTIONS } from '@/types/settings'
import { STRINGS } from '@/types/strings'
</script>

<template>
  <section
    id="settings_tab_groups"
    class="content-panel-section section"
  >
    <h2 class="section-title">{{ STRINGS.settings_tab_groups }}</h2>
    <div class="section-body rows">
      <ToggleButton
        label="Group a tab dropped next to a group"
        description="Choose whether both neighbours must belong to the same group, or any adjacent group is enough."
        v-model="Settings.values.tabGroupDropBehavior"
        :options="OPTIONS.tabGroupDropBehavior"
        @update="Settings.saveSettingsToStorage()"
      />
      <ToggleButton
        label="Color indicator"
        v-model="Settings.values.tabGroupColorIndicator"
        :options="OPTIONS.tabGroupColorIndicator"
        @update="Settings.saveSettingsToStorage()"
      />
      <ToggleButton
        label="Save tabs when their group is removed"
        description="Includes removing a group by closing its last tab."
        v-model="Settings.values.saveTabsWhenTabGroupDeleted"
        :options="OPTIONS.boolean"
        @update="Settings.saveSettingsToStorage()"
      />
    </div>
  </section>
</template>
