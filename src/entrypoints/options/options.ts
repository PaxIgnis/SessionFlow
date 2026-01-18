import { Settings } from '@/services/settings'
import { createApp } from 'vue'
import Options from './options.vue'

async function init() {
  await Settings.loadSettingsFromStorage()

  createApp(Options).mount('#options-root')
}
init()
