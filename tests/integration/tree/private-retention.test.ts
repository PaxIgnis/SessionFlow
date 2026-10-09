import { beforeEach, describe, expect, it } from 'vitest'
import { Tree } from '@/services/background-tree'
import { Settings } from '@/services/settings'
import { DEFAULT_SETTINGS } from '@/defaults/settings'
import { normalizeSettings } from '@/services/settings-actions'
import { projectStoredSessionTree } from '@/services/session-tree-storage'
import { createWindow, createTab, resetTree } from '../../helpers/tree-fixtures'
import { expectTreeInvariants } from '../../helpers/tree-invariants'
import { installFakeBrowser } from '../../helpers/fake-browser'

beforeEach(() => {
  resetTree()
  Object.assign(Settings.values, structuredClone(DEFAULT_SETTINGS))
})

describe('private-data retention', () => {
  it.each([false, true])(
    'preserves implicit legacy defaults, but keeps new-install retention off (new install: %s)',
    async (freshInstall) => {
      const fake = installFakeBrowser()
      fake.storage.local.get.mockImplementation(async (keys) =>
        keys === 'settings'
          ? {}
          : {
              sessionTree: [{ uid: 'existing-window' }],
              privateWindowOnboarding: {
                status: 'pending',
                ...(freshInstall ? { version: 1 } : {}),
              },
            },
      )
      await Settings.loadSettingsFromStorage()
      expect(Settings.values.retainPrivateWindows).toBe(!freshInstall)
      expect(Settings.values.includePrivateWindowsInSessionSnapshots).toBe(
        !freshInstall,
      )
      expect(Settings.values.cachePrivateTabFavicons).toBe(!freshInstall)
      if (freshInstall) expect(fake.storage.local.set).not.toHaveBeenCalled()
      else
        expect(fake.storage.local.set).toHaveBeenCalledWith({
          settings: expect.objectContaining({ retainPrivateWindows: true }),
        })
    },
  )
  it('uses opt-in defaults for new users and preserves explicit legacy preferences', () => {
    expect(normalizeSettings(undefined)).toMatchObject({
      retainPrivateWindows: false,
      includePrivateWindowsInSessionSnapshots: false,
      cachePrivateTabFavicons: false,
    })
    expect(normalizeSettings({ cachePrivateTabFavicons: false })).toMatchObject(
      {
        retainPrivateWindows: true,
        includePrivateWindowsInSessionSnapshots: true,
        cachePrivateTabFavicons: false,
      },
    )
    expect(normalizeSettings({ retainPrivateWindows: false })).toMatchObject({
      retainPrivateWindows: false,
      includePrivateWindowsInSessionSnapshots: false,
      cachePrivateTabFavicons: false,
    })
  })

  it('filters private windows without mutating the live tree or leaving orphan parents', () => {
    const privateWindow = createWindow(
      'private' as UID,
      [createTab('private-tab' as UID)],
      { incognito: true },
    )
    const normalWindow = createWindow('normal' as UID, [
      createTab('normal-tab' as UID),
    ])
    Tree.recomputeSessionTree(false)
    const before = structuredClone(Tree.Items)
    const stored = projectStoredSessionTree(
      [privateWindow, { ...normalWindow, parentUid: privateWindow.uid }],
      false,
    )
    expect(stored).toHaveLength(1)
    expect(stored[0].uid).toBe(normalWindow.uid)
    expect(stored[0].parentUid).toBeUndefined()
    expect(JSON.stringify(stored)).not.toContain('private-tab')
    expect(Tree.Items).toEqual(before)
    expectTreeInvariants()
  })

  it.each([false, true])(
    'applies retention %s to normal saves and snapshot-restore appends',
    async (retain) => {
      const fake = installFakeBrowser()
      Settings.values.retainPrivateWindows = retain
      createWindow('private' as UID, [createTab('private-tab' as UID)], {
        incognito: true,
      })
      createWindow('normal' as UID)
      await Tree.saveSessionTreeToStorage()
      expect(fake.storage.local.set).toHaveBeenLastCalledWith({
        sessionTree: expect.arrayContaining([
          expect.objectContaining({ uid: 'normal' }),
        ]),
      })
      const first = fake.storage.local.set.mock.calls.at(-1)![0]
        .sessionTree as unknown[]
      expect(first).toHaveLength(retain ? 2 : 1)
      const current = structuredClone(Tree.Items)
      const restored = {
        ...structuredClone(Tree.windowsByUid.get('private' as UID)!),
        uid: 'restored' as UID,
        children: [],
      }
      await Tree.appendTreeItemsAfterPersist([restored], current)
      const appended = fake.storage.local.set.mock.calls.at(-1)![0]
        .sessionTree as unknown[]
      expect(appended).toHaveLength(retain ? 3 : 1)
      expect(Tree.Items).toHaveLength(3)
      expectTreeInvariants()
    },
  )
})
