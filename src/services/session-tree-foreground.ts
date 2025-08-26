import { ref } from 'vue'
import { Window } from '@/types/session-tree'

export const SessionTree = {
  reactiveWindowsList: ref<Window[]>([]),
}
