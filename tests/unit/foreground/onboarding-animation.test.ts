import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  demoDropHighlight,
  demoPause,
  exampleDragPreview,
  moveDemoPointer,
} from '@/services/onboarding-animation'
import type { OnboardingExampleItem } from '@/types/onboarding-demo'

afterEach(() => {
  vi.useRealTimers()
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
})

describe('onboarding pointer animation', () => {
  const rect = {
    left: 40,
    right: 240,
    top: 100,
    bottom: 130,
    height: 30,
  } as DOMRect
  it.each([
    [39, 115, undefined],
    [241, 115, undefined],
    [100, 99, undefined],
    [100, 131, undefined],
    [100, 104, 'above'],
    [100, 115, 'mid'],
    [100, 126, 'below'],
  ])(
    'highlights only the actual hovered region at (%s, %s)',
    (x, y, expected) => {
      expect(demoDropHighlight({ x, y }, rect)).toBe(expected)
    },
  )
  it('settles movement at its destination before subsequent steps can run', async () => {
    let frame: FrameRequestCallback = () => {}
    vi.stubGlobal('requestAnimationFrame', (callback: FrameRequestCallback) => {
      frame = callback
      return 1
    })
    vi.stubGlobal('cancelAnimationFrame', vi.fn())
    const start = performance.now()
    vi.spyOn(performance, 'now').mockReturnValue(start)
    const update = vi.fn()
    const moving = moveDemoPointer(
      { x: 0, y: 0 },
      { x: 80, y: 40 },
      100,
      update,
      new AbortController().signal,
    )
    frame(start + 50)
    expect(update).toHaveBeenLastCalledWith({ x: 40, y: 20 })
    frame(start + 100)
    expect(update).toHaveBeenLastCalledWith({ x: 80, y: 40 })
    expect(await moving).toBe(true)
  })
  it('cancels movement and waiting when the user leaves an example', async () => {
    vi.useFakeTimers()
    const cancel = vi.fn()
    vi.stubGlobal('requestAnimationFrame', () => 42)
    vi.stubGlobal('cancelAnimationFrame', cancel)
    const controller = new AbortController()
    const moving = moveDemoPointer(
      { x: 0, y: 0 },
      { x: 80, y: 40 },
      100,
      vi.fn(),
      controller.signal,
    )
    const waiting = demoPause(500, controller.signal)
    controller.abort()
    expect(await moving).toBe(false)
    expect(await waiting).toBe(false)
    expect(cancel).toHaveBeenCalledWith(42)
    expect(vi.getTimerCount()).toBe(0)
  })
  it('builds the real window drag preview without changing sample data', () => {
    const items: OnboardingExampleItem[] = [
      { id: 'window', kind: 'window', title: 'Research', indentLevel: 0 },
      {
        id: 'tab',
        kind: 'tab',
        title: 'Reference',
        url: 'https://example.org/',
        indentLevel: 1,
      },
      { id: 'other-window', kind: 'window', title: 'Planning', indentLevel: 0 },
      { id: 'other-tab', kind: 'tab', title: 'Overview', indentLevel: 1 },
    ]
    const original = structuredClone(items)
    const preview = exampleDragPreview(items[0], items)
    expect(preview.title).toBe('Research')
    expect(preview.metadata).toContain('1 tab')
    expect(exampleDragPreview(items[1], items).body).toEqual([
      'https://example.org/',
    ])
    expect(items).toEqual(original)
    const multiple = exampleDragPreview(items[1], items, ['tab', 'other-tab'])
    expect(multiple.title).toBe('2 tabs')
    expect(multiple.body).toEqual([
      'https://example.org/',
      'https://example.org/reference',
    ])
    expect(items).toEqual(original)
  })
})
