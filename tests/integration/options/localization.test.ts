import { afterEach, describe, expect, it } from 'vitest'
import { createSSRApp } from 'vue'
import { renderToString } from 'vue/server-renderer'
import DeleteTreeItemsModal from '@/components/DeleteTreeItemsModal.vue'
import SessionTreeToolbar from '@/components/SessionTreeToolbar.vue'
import ContainerRecoveryModal from '@/components/ContainerRecoveryModal.vue'
import { setTestLocale } from '../../helpers/i18n'

afterEach(() => setTestLocale('en'))

describe('German presentation', () => {
  it('translates complete deletion sentences and accessible toolbar labels', async () => {
    setTestLocale('de')
    const dialog = await renderToString(
      createSSRApp(DeleteTreeItemsModal, {
        counts: { windows: 1, tabs: 1234, notes: 1, separators: 0 },
      }),
    )
    expect(dialog).toContain(
      'Folgendes wird gelöscht: 1 Fenster, 1.234 Tabs und 1 Notiz.',
    )
    expect(dialog).toContain('Ausgewählte Elemente löschen')
    expect(dialog).toContain('Abbrechen')
    const toolbar = await renderToString(createSSRApp(SessionTreeToolbar))
    expect(toolbar).toContain('aria-label="Einstellungen"')
    expect(toolbar).toContain('title="Neuer Tab"')
    expect(toolbar).not.toContain('New tab')
  })
  it('preserves user-provided container names', async () => {
    setTestLocale('de')
    const dialog = await renderToString(
      createSSRApp(ContainerRecoveryModal, {
        containers: [
          {
            cookieStoreId: 'missing',
            name: 'My personal container',
            colorCode: '#123456',
            color: 'blue',
            icon: 'briefcase',
          },
        ],
      }),
    )
    expect(dialog).toContain('Tab-Umgebung existiert nicht mehr')
    expect(dialog).toContain('My personal container')
    expect(dialog).toContain('Ohne Tab-Umgebung öffnen')
  })
})

it('localizes settings storage failures while preserving the underlying error', async () => {
  setTestLocale('de')
  const { installFakeBrowser } = await import('../../helpers/fake-browser')
  const { vi } = await import('vitest')
  installFakeBrowser()
  vi.mocked(browser.storage.local.get).mockRejectedValueOnce(
    new Error('QUOTA_TEST'),
  )
  const { saveSettingsToStorage } = await import('@/services/settings-actions')
  await expect(saveSettingsToStorage()).rejects.toThrow(
    'Die aktuellen Einstellungen konnten vor dem Speichern nicht gelesen werden: Error: QUOTA_TEST',
  )
})

it('keeps console-only settings diagnostics in English with a German UI', async () => {
  setTestLocale('de')
  const { normalizeSettings } = await import('@/services/settings-actions')
  const errors: string[] = []
  normalizeSettings(
    { unknownSetting: true, enableDragAndDrop: 'invalid' },
    (_, error) => errors.push(error.message),
  )
  expect(errors).toEqual([
    'Invalid settings key: unknownSetting',
    'Invalid type for enableDragAndDrop: expected boolean, got string',
  ])
})

it('renders French deletion summaries and accessible toolbar labels', async () => {
  setTestLocale('fr-FR')
  const dialog = await renderToString(
    createSSRApp(DeleteTreeItemsModal, {
      counts: { windows: 1, tabs: 1234, notes: 1, separators: 0 },
    }),
  )
  expect(dialog).toContain(
    'Les éléments suivants seront supprimés : 1 fenêtre, 1\u202f234 onglets et 1 note.',
  )
  expect(dialog).toContain('Annuler')
  const toolbar = await renderToString(createSSRApp(SessionTreeToolbar))
  expect(toolbar).toContain('aria-label="Paramètres"')
  expect(toolbar).toContain('title="Nouvel onglet"')
})
