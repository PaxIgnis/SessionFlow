import { toRaw } from 'vue'
import { IDBFactory } from 'fake-indexeddb'

Object.defineProperty(globalThis, 'toRaw', {
  configurable: true,
  value: toRaw,
})

Object.defineProperty(globalThis, 'indexedDB', {
  configurable: true,
  value: new IDBFactory(),
})
