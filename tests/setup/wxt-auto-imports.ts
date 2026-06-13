import { toRaw } from 'vue'

Object.defineProperty(globalThis, 'toRaw', {
  configurable: true,
  value: toRaw,
})
