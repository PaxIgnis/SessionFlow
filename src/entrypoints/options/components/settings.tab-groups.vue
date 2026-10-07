<script lang="ts" setup>
import { i18n } from '@/services/i18n'
import ToggleButton from '@/components/ToggleButton.vue'
import { Settings } from '@/services/settings'
import { OPTIONS } from '@/types/settings'
</script>

<template>
  <section
    id="settings_tab_groups"
    class="content-panel-section section"
  >
    <h2 class="section-title">{{ i18n.t('tabGroups') }}</h2>
    <div class="section-body rows">
      <ToggleButton
        :label="i18n.t('groupATabDroppedNextToAGroup')"
        :description="
          i18n.t('chooseWhetherBothNeighboursMustBelongToTheSameGroup')
        "
        v-model="Settings.values.tabGroupDropBehavior"
        :options="OPTIONS.tabGroupDropBehavior"
        @update="Settings.saveSettingsToStorage()"
      />
      <ToggleButton
        :label="i18n.t('colorIndicator')"
        v-model="Settings.values.tabGroupColorIndicator"
        :options="OPTIONS.tabGroupColorIndicator"
        @update="Settings.saveSettingsToStorage()"
      />
      <ToggleButton
        :label="i18n.t('saveTabsWhenTheirGroupIsRemoved')"
        :description="i18n.t('includesRemovingAGroupByClosingItsLastTab')"
        v-model="Settings.values.saveTabsWhenTabGroupDeleted"
        :options="OPTIONS.boolean"
        @update="Settings.saveSettingsToStorage()"
      />
    </div>
  </section>
</template>
