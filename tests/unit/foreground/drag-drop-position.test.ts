import { describe, expect, it } from 'vitest'
import { getDropPosition } from '@/services/drag-and-drop-actions'
import { DropPosition } from '@/types/session-tree'

describe('drag drop position geometry', () => {
  it.each([
    { clientY: 42.999, expected: DropPosition.ABOVE },
    { clientY: 43, expected: DropPosition.MID },
    { clientY: 75.999, expected: DropPosition.MID },
    { clientY: 76, expected: DropPosition.MID },
    { clientY: 76.001, expected: DropPosition.BELOW },
  ])(
    'owns the exact thirds boundary at clientY $clientY',
    ({ clientY, expected }) => {
      expect(getDropPosition(clientY, { top: 10, height: 100 }, true)).toBe(
        expected,
      )
    },
  )

  it.each([
    { clientY: 59.999, expected: DropPosition.ABOVE },
    { clientY: 60, expected: DropPosition.BELOW },
  ])(
    'splits targets without a middle region at clientY $clientY',
    ({ clientY, expected }) => {
      expect(getDropPosition(clientY, { top: 10, height: 100 }, false)).toBe(
        expected,
      )
    },
  )

  it('supports fractional rectangles and coordinates', () => {
    expect(getDropPosition(20.5624, { top: 10.25, height: 31.25 }, true)).toBe(
      DropPosition.ABOVE,
    )
    expect(getDropPosition(20.5625, { top: 10.25, height: 31.25 }, true)).toBe(
      DropPosition.MID,
    )
  })

  it('uses a deterministic one-pixel fallback for a zero-height target', () => {
    expect(getDropPosition(25, { top: 25, height: 0 }, true)).toBe(
      DropPosition.ABOVE,
    )
    expect(getDropPosition(25.5, { top: 25, height: 0 }, true)).toBe(
      DropPosition.MID,
    )
    expect(getDropPosition(26, { top: 25, height: 0 }, true)).toBe(
      DropPosition.BELOW,
    )
  })
})
