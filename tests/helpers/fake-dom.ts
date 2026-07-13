interface FakeClassList {
  add: (...classes: string[]) => void
  remove: (...classes: string[]) => void
  contains: (className: string) => boolean
}

export interface FakeDragTarget {
  classList: FakeClassList
  style: {
    getPropertyValue: (name: string) => string
    removeProperty: (name: string) => string
    setProperty: (name: string, value: string) => void
  }
  closest: (selector: string) => FakeDragTarget | null
  getAttribute: (name: string) => string | null
  getBoundingClientRect: () => { top: number; height: number }
}

export function installFakeDocument(
  elements: FakeDragTarget[] = [],
): () => void {
  const originalDocument = globalThis.document
  const fakeDocument = {
    querySelectorAll: (selector: string) => {
      const classNames = Array.from(
        selector.matchAll(/\.([\w-]+)/g),
        (match) => match[1],
      )
      return elements.filter((element) =>
        classNames.some((className) => element.classList.contains(className)),
      )
    },
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
  type: 'tab' | 'window' | 'note' | 'separator' | 'tree-end'
  classes?: string[]
  top?: number
  height?: number
}): FakeDragTarget {
  const classes = new Set<string>()
  options.classes?.forEach((className) => classes.add(className))
  const styles = new Map<string, string>()
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
    style: {
      getPropertyValue: (name: string) => styles.get(name) ?? '',
      removeProperty: (name: string) => {
        const previousValue = styles.get(name) ?? ''
        styles.delete(name)
        return previousValue
      },
      setProperty: (name: string, value: string) => {
        styles.set(name, value)
      },
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
  data?: Record<string, string>
  types?: string[]
  mozItems?: unknown[]
  throwOnGetData?: boolean
}): DragEvent {
  const rect = options.target.getBoundingClientRect()
  const data = options.data ?? {}
  const types = options.types ?? Object.keys(data)
  return {
    target: options.target,
    clientY: rect.top + rect.height * options.yRatio,
    dataTransfer: {
      dropEffect: 'none',
      types,
      getData: (type: string) => {
        if (options.throwOnGetData)
          throw new DOMException('Protected drag data')
        return data[type] ?? ''
      },
      mozItemCount: options.mozItems?.length ?? 0,
      mozGetDataAt: (_type: string, index: number) => options.mozItems?.[index],
    },
  } as unknown as DragEvent
}
