import { afterEach, describe, expect, it, vi } from 'vitest'
import { initializeKeyboardCommands } from '@/services/background-keyboard'
import { Tree } from '@/services/background-tree'
import { SessionSnapshots } from '@/services/background-session-snapshots'
import { installFakeBrowser, flushMicrotasks } from '../../helpers/fake-browser'

afterEach(() => vi.restoreAllMocks())

describe('Firefox keyboard commands', () => {
  it('creates a manual snapshot after startup without an open tree page', async () => {
    const fake = installFakeBrowser()
    const capture = vi
      .spyOn(SessionSnapshots, 'capture')
      .mockResolvedValue({ id: 'snapshot' } as never)
    let ready!: () => void
    initializeKeyboardCommands(
      new Promise<void>((resolve) => {
        ready = resolve
      }),
    )
    fake.commands.onCommand.emit('shortcutSnapshot')
    await flushMicrotasks()
    expect(capture).not.toHaveBeenCalled()
    ready()
    await flushMicrotasks()
    expect(capture).toHaveBeenCalledExactlyOnceWith('manual')
    expect(fake.runtime.sendMessage).toHaveBeenCalledWith({
      action: 'keyboard-notification',
      message: 'Snapshot created.',
    })
  })
  it('reports snapshot failure without claiming success', async () => {
    const fake = installFakeBrowser()
    vi.spyOn(console, 'error').mockImplementation(() => undefined)
    vi.spyOn(SessionSnapshots, 'capture').mockRejectedValue(
      new Error('storage full'),
    )
    initializeKeyboardCommands(Promise.resolve())
    fake.commands.onCommand.emit('shortcutSnapshot')
    await flushMicrotasks()
    expect(fake.runtime.sendMessage).toHaveBeenCalledWith({
      action: 'keyboard-notification',
      message: 'The keyboard action could not be completed.',
    })
  })
  it('waits for background initialization before opening or focusing the tree', async () => {
    const fake = installFakeBrowser()
    const open = vi.spyOn(Tree, 'openSessionTree').mockResolvedValue(undefined)
    let ready!: () => void
    initializeKeyboardCommands(
      new Promise<void>((resolve) => {
        ready = resolve
      }),
    )
    fake.commands.onCommand.emit('open-session-tree')
    await flushMicrotasks()
    expect(open).not.toHaveBeenCalled()
    ready()
    await flushMicrotasks()
    expect(open).toHaveBeenCalledOnce()
  })
  it('opens settings independently of tree initialization and ignores unknown commands', () => {
    const fake = installFakeBrowser()
    initializeKeyboardCommands(new Promise<void>(() => {}))
    fake.commands.onCommand.emit('open-settings')
    fake.commands.onCommand.emit('unknown')
    expect(fake.runtime.openOptionsPage).toHaveBeenCalledOnce()
  })
})
