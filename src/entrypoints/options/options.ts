import { Settings } from '@/services/settings'
import { createApp } from 'vue'
import Options from './options.vue'

async function init() {
  await Settings.loadSettingsFromStorage()
  Settings.setupSettingsUpdatedListener()

  createApp(Options).mount('#options-root')
}
init()
