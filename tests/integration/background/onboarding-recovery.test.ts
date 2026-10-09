import { beforeEach, describe, expect, it, vi } from 'vitest'
import {
  initializePrivateWindowOnboarding,
  resumeIntroductionAfterPrivateAccessChange,
} from '@/services/background-private-window-onboarding'
import { Tree } from '@/services/background-tree'
import { Settings } from '@/services/settings'
import { DEFAULT_SETTINGS } from '@/defaults/settings'
import { FaviconRefresh } from '@/services/favicon-refresh'
import { SessionSnapshots } from '@/services/background-session-snapshots'
import {
  ONBOARDING_STORAGE_KEY,
  type OnboardingRecord,
} from '@/types/onboarding'
import { installFakeBrowser } from '../../helpers/fake-browser'

vi.mock('@/services/favicon-refresh', () => ({
  FaviconRefresh: {
    handleSettingsUpdated: vi.fn().mockResolvedValue(undefined),
  },
}))
vi.mock('@/services/background-session-snapshots', () => ({
  SessionSnapshots: {
    handleSettingsUpdated: vi.fn().mockResolvedValue(undefined),
  },
}))

function setup(record?: OnboardingRecord) {
  const fake = installFakeBrowser()
  const storage: Record<string, unknown> = {
    settings: structuredClone(DEFAULT_SETTINGS),
    [ONBOARDING_STORAGE_KEY]: record,
  }
  fake.storage.local.get.mockImplementation(async () =>
    structuredClone(storage),
  )
  fake.storage.local.set.mockImplementation(async (patch) => {
    Object.assign(storage, structuredClone(patch))
  })
  fake.extension.isAllowedIncognitoAccess!.mockResolvedValue(true)
  return { fake, storage }
}

function pending(): OnboardingRecord {
  return {
    status: 'pending',
    version: 1,
    welcomeStep: 2,
    destination: 'import',
    tip: 5,
    featureId: 'organize',
    privateAccessResume: { allowed: false, expiresAt: Date.now() + 60_000 },
  }
}

describe('onboarding permission reload recovery', () => {
  beforeEach(() => {
    vi.restoreAllMocks()
  })

  it('resumes once after access is granted, preserving progress and preferences', async () => {
    const record = pending()
    const { fake, storage } = setup(record)
    await resumeIntroductionAfterPrivateAccessChange()
    expect(fake.tabs.create).toHaveBeenCalledWith({
      url: 'moz-extension://test-id/onboarding.html',
    })
    const { privateAccessResume: _marker, ...progress } = record
    expect(storage[ONBOARDING_STORAGE_KEY]).toEqual(progress)
    expect(storage.settings).toEqual(DEFAULT_SETTINGS)
    await resumeIntroductionAfterPrivateAccessChange()
    expect(fake.tabs.create).toHaveBeenCalledOnce()
  })

  it.each([
    { ...pending(), status: 'completed' as const },
    { ...pending(), welcomeStep: 3 },
    { ...pending(), version: 0 },
    { ...pending(), privateAccessResume: undefined },
    {
      ...pending(),
      privateAccessResume: { allowed: false as const, expiresAt: 1 },
    },
  ])('does not reopen an ineligible introduction: %j', async (record) => {
    const { fake } = setup(record)
    await resumeIntroductionAfterPrivateAccessChange()
    expect(fake.tabs.create).not.toHaveBeenCalled()
    expect(fake.tabs.update).not.toHaveBeenCalled()
  })

  it('does not reopen on an ordinary restart without a permission change', async () => {
    const { fake } = setup(pending())
    fake.extension.isAllowedIncognitoAccess!.mockResolvedValue(false)
    await resumeIntroductionAfterPrivateAccessChange()
    expect(fake.tabs.create).not.toHaveBeenCalled()
    expect(fake.storage.local.set).not.toHaveBeenCalled()
  })

  it('reuses an existing introduction, removing replay mode and focusing its window', async () => {
    const { fake } = setup(pending())
    fake.tabs.query.mockResolvedValue([
      {
        id: 9,
        windowId: 7,
        url: 'moz-extension://test-id/onboarding.html?replay',
      },
    ])
    await resumeIntroductionAfterPrivateAccessChange()
    expect(fake.tabs.create).not.toHaveBeenCalled()
    expect(fake.tabs.update).toHaveBeenCalledWith(9, {
      url: 'moz-extension://test-id/onboarding.html',
      active: true,
    })
    expect(fake.windows.update).toHaveBeenCalledWith(7, { focused: true })
  })

  it('retains the recovery marker for retry if opening the tab fails', async () => {
    const record = pending()
    const { fake, storage } = setup(record)
    fake.tabs.create.mockRejectedValueOnce(new Error('tab unavailable'))
    await expect(resumeIntroductionAfterPrivateAccessChange()).rejects.toThrow(
      'tab unavailable',
    )
    expect(storage[ONBOARDING_STORAGE_KEY]).toEqual(record)
    await resumeIntroductionAfterPrivateAccessChange()
    expect(fake.tabs.create).toHaveBeenCalledTimes(2)
  })

  it('does not reopen if the user finishes while the permission check is pending', async () => {
    const { fake, storage } = setup(pending())
    fake.extension.isAllowedIncognitoAccess!.mockImplementation(async () => {
      storage[ONBOARDING_STORAGE_KEY] = { status: 'completed', version: 1 }
      return true
    })
    await resumeIntroductionAfterPrivateAccessChange()
    expect(fake.tabs.create).not.toHaveBeenCalled()
  })
})

describe('immediate onboarding settings updates', () => {
  beforeEach(() => {
    vi.restoreAllMocks()
  })

  it.each([true, false])(
    'applies retention %s without finishing or navigating',
    async (retention) => {
      const record = { ...pending(), privateAccessResume: undefined }
      const { fake, storage } = setup(record)
      storage.settings = {
        ...DEFAULT_SETTINGS,
        retainPrivateWindows: !retention,
        includePrivateWindowsInSessionSnapshots: !retention,
        cachePrivateTabFavicons: !retention,
      }
      await Settings.loadSettingsFromStorage()
      const saveTree = vi
        .spyOn(Tree, 'saveSessionTreeToStorage')
        .mockResolvedValue(undefined)
      const openTree = vi
        .spyOn(Tree, 'openSessionTree')
        .mockResolvedValue(undefined)
      initializePrivateWindowOnboarding()
      await fake.runtime.onMessage.listeners[0]({
        action: 'onboarding',
        command: 'set-retention',
        retainPrivateWindows: retention,
      })
      expect(storage.settings).toMatchObject({
        retainPrivateWindows: retention,
        includePrivateWindowsInSessionSnapshots: retention,
        cachePrivateTabFavicons: retention,
      })
      expect(saveTree).toHaveBeenCalledOnce()
      expect(FaviconRefresh.handleSettingsUpdated).toHaveBeenCalled()
      expect(SessionSnapshots.handleSettingsUpdated).toHaveBeenCalled()
      expect(storage[ONBOARDING_STORAGE_KEY]).toEqual(record)
      expect(openTree).not.toHaveBeenCalled()
      expect(fake.tabs.create).not.toHaveBeenCalled()
    },
  )

  it.each([true, false])(
    'saves startup choice %s without finishing, navigating, or changing privacy settings',
    async (openSessionTreeOnStartup) => {
      const record = { ...pending(), privateAccessResume: undefined }
      const { fake, storage } = setup(record)
      storage.settings = {
        ...DEFAULT_SETTINGS,
        openSessionTreeOnStartup: !openSessionTreeOnStartup,
      }
      await Settings.loadSettingsFromStorage()
      const openTree = vi
        .spyOn(Tree, 'openSessionTree')
        .mockResolvedValue(undefined)
      initializePrivateWindowOnboarding()
      await fake.runtime.onMessage.listeners[0]({
        action: 'onboarding',
        command: 'set-startup',
        openSessionTreeOnStartup,
      })
      expect(storage.settings).toEqual({
        ...DEFAULT_SETTINGS,
        openSessionTreeOnStartup,
      })
      expect(storage[ONBOARDING_STORAGE_KEY]).toEqual(record)
      expect(openTree).not.toHaveBeenCalled()
      expect(fake.tabs.create).not.toHaveBeenCalled()
      expect(fake.runtime.sendMessage).toHaveBeenCalledWith({
        type: 'settingsUpdated',
      })
    },
  )

  it.each(['set-retention', 'set-startup'])(
    'rejects a missing choice for %s without completing onboarding',
    (command) => {
      const { fake } = setup()
      initializePrivateWindowOnboarding()
      expect(
        fake.runtime.onMessage.listeners[0]({
          action: 'onboarding',
          command,
        }),
      ).toBeUndefined()
      expect(fake.storage.local.set).not.toHaveBeenCalled()
    },
  )

  it.each([
    ['set-retention', 'retainPrivateWindows'],
    ['set-startup', 'openSessionTreeOnStartup'],
  ] as const)(
    'reports a failed %s save and allows the same choice to be retried',
    async (command, setting) => {
      const { fake, storage } = setup()
      await Settings.loadSettingsFromStorage()
      vi.spyOn(Tree, 'saveSessionTreeToStorage').mockResolvedValue(undefined)
      initializePrivateWindowOnboarding()
      fake.storage.local.set.mockRejectedValueOnce(
        new Error('storage unavailable'),
      )
      const message = {
        action: 'onboarding',
        command,
        [setting]: true,
      }
      await expect(
        fake.runtime.onMessage.listeners[0](message),
      ).rejects.toThrow()
      expect(Settings.values[setting]).toBe(false)
      await fake.runtime.onMessage.listeners[0](message)
      expect(storage.settings).toMatchObject({ [setting]: true })
    },
  )
})
