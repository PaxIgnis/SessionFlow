import { afterEach, describe, expect, it, vi } from 'vitest'
import en from '../../../src/locales/en.json'
import de from '../../../src/locales/de.json'
import fr from '../../../src/locales/fr.json'
import {
  formatList,
  formatNumber,
  getDisplayLocale,
  i18n,
} from '../../../src/services/i18n'
import { localizedImportWarning } from '../../../src/services/localized-import-warnings'
import { setTestLocale, testI18n } from '../../helpers/i18n'

afterEach(() => {
  setTestLocale('en')
  vi.restoreAllMocks()
})

describe('localization', () => {
  it('keeps catalogs alphabetically ordered', () => {
    expect(Object.keys(en)).toEqual(Object.keys(en).sort())
    expect(Object.keys(de)).toEqual(Object.keys(de).sort())
    expect(Object.keys(fr)).toEqual(Object.keys(fr).sort())
  })
  it('uses Firefox terminology and grammatical singular messages', () => {
    setTestLocale('de')
    expect(i18n.t('containers')).toBe('Tab-Umgebungen')
    expect(i18n.t('containerDetail', ['Arbeit'])).toBe('Tab-Umgebung: Arbeit')
    expect(i18n.t('deleteSummary', [i18n.t('countTab', 1)])).toBe(
      'Folgendes wird gelöscht: 1 Tab.',
    )
    expect(i18n.t('snapshotScheduleEmpty', [i18n.t('countHour', 1)])).toContain(
      'im Abstand von 1 Stunde',
    )
    expect(i18n.t('snapshotScheduleEmpty', [i18n.t('countHour', 2)])).toContain(
      'im Abstand von 2 Stunden',
    )
  })
  it('keeps German keys, plural forms and placeholders aligned with English', () => {
    expect(Object.keys(de).sort()).toEqual(Object.keys(en).sort())
    for (const key of Object.keys(en) as (keyof typeof en)[]) {
      const english = en[key]
      const german = de[key]
      expect(typeof german, key).toBe(typeof english)
      const variants: Record<string, string> =
        typeof english === 'string' ? { message: english } : english
      const translated: Record<string, string> =
        typeof german === 'string' ? { message: german } : german
      expect(Object.keys(translated), key).toEqual(Object.keys(variants))
      for (const [form, message] of Object.entries(variants)) {
        const translation = translated[form]
        expect(translation.trim().length, key).toBeGreaterThan(0)
        expect(translation.match(/\$\d/g)?.sort() ?? [], key).toEqual(
          message.match(/\$\d/g)?.sort() ?? [],
        )
      }
    }
  })
  it.each(['de', 'de-DE', 'de-AT'])('uses German for %s', (locale) => {
    setTestLocale(locale)
    expect(getDisplayLocale()).toBe('de')
    expect(i18n.t('settings')).toBe('Einstellungen')
    expect(i18n.t('countTab', 1)).toBe('1 Tab')
    expect(i18n.t('countTab', 2)).toBe('2 Tabs')
    expect(i18n.t('deleteSummary', [formatList(['1 Tab', '2 Notizen'])])).toBe(
      'Folgendes wird gelöscht: 1 Tab und 2 Notizen.',
    )
  })
  it('falls back to English for unsupported languages', () => {
    setTestLocale('es-ES')
    expect(getDisplayLocale()).toBe('en')
    expect(i18n.t('settings')).toBe('Settings')
    expect(i18n.t('countTab', 0)).toBe('0 tabs')
  })
  it('localizes stored import warnings without changing the stored message', () => {
    setTestLocale('de')
    const warning = {
      code: 'groups-as-notes' as const,
      count: 2,
      message: 'Original warning',
    }
    expect(localizedImportWarning('tabs-outliner', warning)).toBe(
      'Gruppen aus Tabs Outliner wurden in Notiz-Zweige umgewandelt.',
    )
    expect(warning.message).toBe('Original warning')
  })
})

it.each([
  ['en', '1,234.50'],
  ['de-DE', '1.234,50'],
  ['es-ES', '1,234.50'],
  ['fr-FR', '1\u202f234,50'],
])('formats numbers using the selected catalog for %s', (locale, expected) => {
  setTestLocale(locale)
  expect(formatNumber(1234.5, { minimumFractionDigits: 2 })).toBe(expected)
})

it('uses numeric plural selection with a localized displayed count', () => {
  setTestLocale('de')
  expect(i18n.t('countTab', 1234, [formatNumber(1234)])).toBe('1.234 Tabs')
  expect(i18n.t('countTab', 1, [formatNumber(1)])).toBe('1 Tab')
})

it('localizes snapshot validation failures', async () => {
  setTestLocale('de')
  const { validateSessionSnapshotPayload } =
    await import('../../../src/services/session-snapshot-codec')
  expect(() =>
    validateSessionSnapshotPayload({ schemaVersion: 1, items: null }),
  ).toThrow('Die Elemente der Sitzungsmomentaufnahme sind ungültig.')
})

it.each(['', 'invalid_locale', '   '])(
  'survives missing or invalid locale metadata: %j',
  (metadata) => {
    const lookup = testI18n.getMessage.bind(testI18n)
    vi.spyOn(testI18n, 'getMessage').mockImplementation((key, substitutions) =>
      key === 'localeCode' ? metadata : lookup(key, substitutions),
    )
    expect(getDisplayLocale()).toBe('en')
    expect(formatNumber(1234.5)).toBe('1,234.5')
    expect(formatList(['one', 'two'])).toBe('one and two')
  },
)

it('keeps every French key and placeholder aligned with English, including zero forms', () => {
  expect(Object.keys(fr)).toEqual(Object.keys(en))
  for (const key of Object.keys(en) as (keyof typeof en)[]) {
    const source = en[key]
    const translated = fr[key]
    expect(typeof translated, key).toBe(typeof source)
    const sourceForms: Record<string, string> =
      typeof source === 'string' ? { message: source } : source
    const forms: Record<string, string> =
      typeof translated === 'string' ? { message: translated } : translated
    expect(Object.keys(forms), key).toEqual(
      typeof source === 'string' ? ['message'] : ['0', '1', 'n'],
    )
    for (const [form, text] of Object.entries(forms)) {
      expect(text.trim().length, key).toBeGreaterThan(0)
      expect(text.match(/\$\d/g)?.sort() ?? [], key).toEqual(
        (sourceForms[form] ?? sourceForms['1']).match(/\$\d/g)?.sort() ?? [],
      )
    }
  }
})

it.each(['fr', 'fr-FR', 'fr-CA', 'fr-BE'])(
  'selects French for %s',
  (locale) => {
    setTestLocale(locale)
    expect(getDisplayLocale()).toBe('fr')
    expect(i18n.t('settings')).toBe('Paramètres')
    expect(i18n.t('containers')).toBe('Conteneurs')
    expect(i18n.t('countTab', 0)).toBe('0 onglet')
    expect(i18n.t('countTab', 1)).toBe('1 onglet')
    expect(i18n.t('countTab', 2)).toBe('2 onglets')
    expect(i18n.t('countTab', 1234, [formatNumber(1234)])).toBe(
      '1\u202f234 onglets',
    )
    expect(formatList(['1 fenêtre', '2 onglets'])).toBe(
      '1 fenêtre et 2 onglets',
    )
  },
)
