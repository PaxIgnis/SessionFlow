import { localizeDocument } from '@/services/i18n'
import { createApp } from 'vue'
import SessionTree from './SessionTree.vue'

createApp(SessionTree).mount('#sessiontree')

localizeDocument()
