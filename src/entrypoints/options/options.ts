import { createApp } from 'vue'
import Options from './options.vue'
import { Settings } from '@/services/settings'

async function init() {
  await Settings.loadSettingsFromStorage()

  createApp(Options).mount('#options-root')
}
init()
