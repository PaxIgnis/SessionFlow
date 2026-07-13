import { vi } from 'vitest'

type Listener<T extends unknown[]> = (...args: T) => void

class FakeEvent<T extends unknown[]> {
  listeners: Array<Listener<T>> = []

  addListener = (listener: Listener<T>) => {
    this.listeners.push(listener)
  }

  removeListener = (listener: Listener<T>) => {
    this.listeners = this.listeners.filter((current) => current !== listener)
  }

  emit(...args: T): void {
    for (const listener of [...this.listeners]) {
      listener(...args)
    }
  }
}

class FakePort {
  onMessage = new FakeEvent<[object]>()
  onDisconnect = new FakeEvent<[]>()
  peer?: FakePort
  disconnected = false

  constructor(public name: string) {}

  postMessage(message: object): void {
    if (this.disconnected) return
    queueMicrotask(() => {
      this.peer?.onMessage.emit(message)
    })
  }

  disconnect(): void {
    if (this.disconnected) return
    this.disconnected = true
    this.onDisconnect.emit()
    if (this.peer && !this.peer.disconnected) {
      this.peer.disconnected = true
      this.peer.onDisconnect.emit()
    }
  }
}

export interface FakeBrowser {
  alarms: {
    onAlarm: FakeEvent<[browser.alarms.Alarm]>
    clear: ReturnType<typeof vi.fn>
    create: ReturnType<typeof vi.fn>
  }
  browserAction: {
    onClicked: FakeEvent<[]>
    setBadgeText: ReturnType<typeof vi.fn>
    setTitle: ReturnType<typeof vi.fn>
  }
  runtime: {
    onConnect: FakeEvent<[FakePort]>
    onInstalled: FakeEvent<[]>
    onMessage: FakeEvent<[Record<string, unknown>]>
    onStartup: FakeEvent<[]>
    connect: ReturnType<typeof vi.fn>
    sendMessage: ReturnType<typeof vi.fn>
    getURL: ReturnType<typeof vi.fn>
  }
  tabs: {
    onActivated: FakeEvent<[browser.tabs._OnActivatedActiveInfo]>
    onAttached: FakeEvent<[number, browser.tabs._OnAttachedAttachInfo]>
    onCreated: FakeEvent<[browser.tabs.Tab]>
    onDetached: FakeEvent<[number, browser.tabs._OnDetachedDetachInfo]>
    onMoved: FakeEvent<[number, browser.tabs._OnMovedMoveInfo]>
    onRemoved: FakeEvent<[number, browser.tabs._OnRemovedRemoveInfo]>
    onUpdated: FakeEvent<
      [number, browser.tabs._OnUpdatedChangeInfo, browser.tabs.Tab]
    >
    move: ReturnType<typeof vi.fn>
    get: ReturnType<typeof vi.fn>
    query: ReturnType<typeof vi.fn>
    remove: ReturnType<typeof vi.fn>
    duplicate: ReturnType<typeof vi.fn>
    reload: ReturnType<typeof vi.fn>
    create: ReturnType<typeof vi.fn>
    group: ReturnType<typeof vi.fn>
    ungroup: ReturnType<typeof vi.fn>
    update: ReturnType<typeof vi.fn>
  }
  tabGroups: {
    onCreated: FakeEvent<[browser.tabGroups.TabGroup]>
    onMoved: FakeEvent<[browser.tabGroups.TabGroup]>
    onRemoved: FakeEvent<
      [browser.tabGroups.TabGroup, browser.tabGroups._RemoveInfo]
    >
    onUpdated: FakeEvent<[browser.tabGroups.TabGroup]>
    get: ReturnType<typeof vi.fn>
    query: ReturnType<typeof vi.fn>
    update: ReturnType<typeof vi.fn>
  }
  windows: {
    onCreated: FakeEvent<[browser.windows.Window]>
    onFocusChanged: FakeEvent<[number]>
    onRemoved: FakeEvent<[number]>
    get: ReturnType<typeof vi.fn>
    getAll: ReturnType<typeof vi.fn>
    create: ReturnType<typeof vi.fn>
    remove: ReturnType<typeof vi.fn>
    update: ReturnType<typeof vi.fn>
  }
  storage: {
    local: {
      get: ReturnType<typeof vi.fn>
      set: ReturnType<typeof vi.fn>
    }
  }
  permissions: {
    contains: ReturnType<typeof vi.fn>
    request: ReturnType<typeof vi.fn>
  }
  menus: {
    onHidden: FakeEvent<[]>
    overrideContext: ReturnType<typeof vi.fn>
    removeAll: ReturnType<typeof vi.fn>
    create: ReturnType<typeof vi.fn>
  }
  extension: {
    getViews: ReturnType<typeof vi.fn>
  }
  __ports: {
    clients: FakePort[]
    servers: FakePort[]
  }
}

export function installFakeBrowser(): FakeBrowser {
  const onConnect = new FakeEvent<[FakePort]>()
  const browser: FakeBrowser = {
    alarms: {
      onAlarm: new FakeEvent<[browser.alarms.Alarm]>(),
      clear: vi.fn().mockResolvedValue(true),
      create: vi.fn().mockResolvedValue(undefined),
    },
    browserAction: {
      onClicked: new FakeEvent<[]>(),
      setBadgeText: vi.fn().mockResolvedValue(undefined),
      setTitle: vi.fn().mockResolvedValue(undefined),
    },
    runtime: {
      onConnect,
      onInstalled: new FakeEvent<[]>(),
      onMessage: new FakeEvent<[Record<string, unknown>]>(),
      onStartup: new FakeEvent<[]>(),
      connect: vi.fn((options?: { name?: string }) => {
        const name = options?.name ?? ''
        const client = new FakePort(name)
        const server = new FakePort(name)
        client.peer = server
        server.peer = client
        browser.__ports.clients.push(client)
        browser.__ports.servers.push(server)
        queueMicrotask(() => {
          onConnect.emit(server)
        })
        return client
      }),
      sendMessage: vi.fn().mockResolvedValue(undefined),
      getURL: vi.fn((path: string) => `moz-extension://test-id${path}`),
    },
    tabs: {
      onActivated: new FakeEvent<[browser.tabs._OnActivatedActiveInfo]>(),
      onAttached: new FakeEvent<[number, browser.tabs._OnAttachedAttachInfo]>(),
      onCreated: new FakeEvent<[browser.tabs.Tab]>(),
      onDetached: new FakeEvent<[number, browser.tabs._OnDetachedDetachInfo]>(),
      onMoved: new FakeEvent<[number, browser.tabs._OnMovedMoveInfo]>(),
      onRemoved: new FakeEvent<[number, browser.tabs._OnRemovedRemoveInfo]>(),
      onUpdated: new FakeEvent<
        [number, browser.tabs._OnUpdatedChangeInfo, browser.tabs.Tab]
      >(),
      move: vi.fn().mockResolvedValue({ id: 1 }),
      get: vi.fn().mockResolvedValue({ id: 1 }),
      query: vi.fn().mockResolvedValue([]),
      remove: vi.fn().mockResolvedValue(undefined),
      duplicate: vi.fn().mockResolvedValue({ id: 2 }),
      reload: vi.fn().mockResolvedValue(undefined),
      create: vi.fn().mockResolvedValue({ id: 3 }),
      group: vi.fn().mockResolvedValue(1),
      ungroup: vi.fn().mockResolvedValue(undefined),
      update: vi.fn().mockResolvedValue({ id: 1 }),
    },
    tabGroups: {
      onCreated: new FakeEvent<[browser.tabGroups.TabGroup]>(),
      onMoved: new FakeEvent<[browser.tabGroups.TabGroup]>(),
      onRemoved: new FakeEvent<
        [browser.tabGroups.TabGroup, browser.tabGroups._RemoveInfo]
      >(),
      onUpdated: new FakeEvent<[browser.tabGroups.TabGroup]>(),
      get: vi.fn(),
      query: vi.fn().mockResolvedValue([]),
      update: vi.fn(),
    },
    windows: {
      onCreated: new FakeEvent<[browser.windows.Window]>(),
      onFocusChanged: new FakeEvent<[number]>(),
      onRemoved: new FakeEvent<[number]>(),
      get: vi.fn().mockResolvedValue({ id: 1, tabs: [] }),
      getAll: vi.fn().mockResolvedValue([]),
      create: vi.fn().mockResolvedValue({ id: 2, tabs: [{ id: 1 }] }),
      remove: vi.fn().mockResolvedValue(undefined),
      update: vi.fn().mockResolvedValue({ id: 1 }),
    },
    storage: {
      local: {
        get: vi.fn().mockResolvedValue({}),
        set: vi.fn().mockResolvedValue(undefined),
      },
    },
    permissions: {
      contains: vi.fn().mockResolvedValue(false),
      request: vi.fn().mockResolvedValue(false),
    },
    menus: {
      onHidden: new FakeEvent<[]>(),
      overrideContext: vi.fn(),
      removeAll: vi.fn().mockResolvedValue(undefined),
      create: vi.fn(),
    },
    extension: {
      getViews: vi.fn().mockReturnValue([]),
    },
    __ports: {
      clients: [],
      servers: [],
    },
  }

  vi.stubGlobal('browser', browser)
  vi.stubGlobal('window', { browser })
  return browser
}

export async function flushMicrotasks(): Promise<void> {
  await Promise.resolve()
  await Promise.resolve()
}
