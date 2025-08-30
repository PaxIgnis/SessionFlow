import { Window } from '@/types/session-tree'
import { ref } from 'vue'

export const SessionTree = {
  reactiveWindowsList: ref<Window[]>([]),
}
