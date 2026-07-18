import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

describe('Firefox sessions manifest permission', () => {
  it('declares the sessions permission used for restored-item identity', () => {
    const source = readFileSync(
      new URL('../../../wxt.config.ts', import.meta.url),
      'utf8',
    )
    const permissions = source.match(/permissions:\s*\[([\s\S]*?)\]/)?.[1]

    expect(permissions).toContain("'sessions'")
  })

  it('uses an add-on ID that Firefox permits for sessions storage', () => {
    const source = readFileSync(
      new URL('../../../wxt.config.ts', import.meta.url),
      'utf8',
    )
    const addonId = source.match(/\bid:\s*'([^']+)'/)?.[1]

    expect(addonId).toBeDefined()
    expect(addonId).not.toMatch(/@temporary-addon$/)
  })
})
