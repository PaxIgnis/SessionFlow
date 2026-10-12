import { beforeEach, describe, expect, it, vi } from 'vitest'
import {
  defaultContainerChoices,
  supportedContainerChoices,
} from '@/services/container-choices'
import { installFakeBrowser } from '../helpers/fake-browser'

describe('Firefox container choices', () => {
  beforeEach(() => installFakeBrowser())
  it('provides supported defaults for older Firefox versions', async () => {
    const choices = await supportedContainerChoices()
    expect(choices).toEqual(defaultContainerChoices())
    expect(
      choices.colors.find(({ color }) => color === 'blue')?.colorCode,
    ).toBe('#37adff')
    expect(choices.icons).toContain('fingerprint')
    expect(choices.icons).not.toContain('bullhorn')
  })
  it('uses current Firefox choices and color codes when APIs are available', async () => {
    const colors = [{ color: 'violet', colorCode: '#9059ff' }]
    Object.assign(browser.contextualIdentities, {
      getSupportedColors: vi.fn().mockResolvedValue(colors),
      getSupportedIcons: vi
        .fn()
        .mockResolvedValue([
          { icon: 'fingerprint', iconUrl: 'resource://fingerprint.svg' },
        ]),
    })
    expect(await supportedContainerChoices()).toEqual({
      colors,
      icons: ['fingerprint'],
    })
  })
  it('retains defaults if supported-choice APIs fail or return no choices', async () => {
    Object.assign(browser.contextualIdentities, {
      getSupportedColors: vi.fn().mockRejectedValue(new Error('disabled')),
      getSupportedIcons: vi.fn().mockResolvedValue([]),
    })
    expect(await supportedContainerChoices()).toEqual(defaultContainerChoices())
  })
})
