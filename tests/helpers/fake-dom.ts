interface FakeClassList {
  add: (...classes: string[]) => void
  remove: (...classes: string[]) => void
  contains: (className: string) => boolean
}

export interface FakeDragTarget {
  classList: FakeClassList
  closest: (selector: string) => FakeDragTarget | null
  getAttribute: (name: string) => string | null
  getBoundingClientRect: () => { top: number; height: number }
}

export function installFakeDocument(): () => void {
  const originalDocument = globalThis.document
  const fakeDocument = {
    querySelectorAll: () => [],
  } as unknown as Document
  Object.defineProperty(globalThis, 'document', {
    configurable: true,
    value: fakeDocument,
  })
  return () => {
    Object.defineProperty(globalThis, 'document', {
      configurable: true,
      value: originalDocument,
    })
  }
}

export function createFakeDragTarget(options: {
  id: UID
  type: 'tab' | 'window' | 'note'
  top?: number
  height?: number
}): FakeDragTarget {
  const classes = new Set<string>()
  const target: FakeDragTarget = {
    classList: {
      add: (...classNames: string[]) => {
        classNames.forEach((className) => classes.add(className))
      },
      remove: (...classNames: string[]) => {
        classNames.forEach((className) => classes.delete(className))
      },
      contains: (className: string) => classes.has(className),
    },
    closest: (selector: string) =>
      selector === '.drag-and-drop-target' ? target : null,
    getAttribute: (name: string) => {
      if (name === 'drag-and-drop-id') return options.id
      if (name === 'drag-and-drop-type') return options.type
      return null
    },
    getBoundingClientRect: () => ({
      top: options.top ?? 0,
      height: options.height ?? 90,
    }),
  }
  return target
}

export function createFakeDragEvent(options: {
  target: FakeDragTarget
  yRatio: number
}): DragEvent {
  const rect = options.target.getBoundingClientRect()
  return {
    target: options.target,
    clientY: rect.top + rect.height * options.yRatio,
    dataTransfer: { dropEffect: 'none' },
  } as unknown as DragEvent
}
