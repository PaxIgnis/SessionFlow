import { beforeEach, describe, expect, it, vi } from 'vitest'
import {
  readTabUid,
  readWindowUid,
  TAB_UID_SESSION_KEY,
  WINDOW_UID_SESSION_KEY,
  writeTabUid,
  writeWindowUid,
} from '@/services/background-session-identity'
import { installFakeBrowser } from '../../helpers/fake-browser'

describe('Firefox session identity values', () => {
  beforeEach(() => {
    installFakeBrowser()
  })

  it('reads valid versioned tab and window UIDs', async () => {
    vi.mocked(browser.sessions.getTabValue).mockResolvedValue({
      version: 1,
      uid: 'tab-1',
    })
    vi.mocked(browser.sessions.getWindowValue).mockResolvedValue({
      version: 1,
      uid: 'window-1',
    })

    await expect(readTabUid(10)).resolves.toBe('tab-1')
    await expect(readWindowUid(20)).resolves.toBe('window-1')
    expect(browser.sessions.getTabValue).toHaveBeenCalledWith(
      10,
      TAB_UID_SESSION_KEY,
    )
    expect(browser.sessions.getWindowValue).toHaveBeenCalledWith(
      20,
      WINDOW_UID_SESSION_KEY,
    )
  })

  it.each([
    undefined,
    null,
    [],
    'tab-1',
    { version: 2, uid: 'tab-1' },
    { version: 1, uid: '' },
    { version: 1, uid: 10 },
  ])('ignores malformed identity value %#', async (value) => {
    vi.mocked(browser.sessions.getTabValue).mockResolvedValue(
      value as unknown as string | object | undefined,
    )

    await expect(readTabUid(10)).resolves.toBeUndefined()
  })

  it('writes versioned identities', async () => {
    await writeTabUid(10, 'tab-1' as UID)
    await writeWindowUid(20, 'window-1' as UID)

    expect(browser.sessions.setTabValue).toHaveBeenCalledWith(
      10,
      TAB_UID_SESSION_KEY,
      { version: 1, uid: 'tab-1' },
    )
    expect(browser.sessions.setWindowValue).toHaveBeenCalledWith(
      20,
      WINDOW_UID_SESSION_KEY,
      { version: 1, uid: 'window-1' },
    )
  })

  it('logs API failures and resolves safely', async () => {
    const error = new Error('sessions API unavailable')
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {})
    vi.mocked(browser.sessions.getTabValue).mockRejectedValue(error)
    vi.mocked(browser.sessions.setWindowValue).mockRejectedValue(error)

    await expect(readTabUid(10)).resolves.toBeUndefined()
    await expect(writeWindowUid(20, 'window-1' as UID)).resolves.toBeUndefined()
    expect(consoleError).toHaveBeenCalledWith(
      'Failed to read Session Flow tab identity:',
      error,
    )
    expect(consoleError).toHaveBeenCalledWith(
      'Failed to write Session Flow window identity:',
      error,
    )
  })
})
