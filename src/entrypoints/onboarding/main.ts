import { createApp } from 'vue'
import { localizeDocument } from '@/services/i18n'
import '@/styles/variables.css'
import './style.css'
import Introduction from './Introduction.vue'

createApp(Introduction).mount('#introduction')
localizeDocument()
