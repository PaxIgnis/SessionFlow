import en from '../../src/locales/en.json'
type Catalog = Record<string, string | Record<string, string>>
const catalogs = Object.fromEntries(
  Object.entries(
    import.meta.glob<Catalog>('../../src/locales/*.json', {
      eager: true,
      import: 'default',
    }),
  ).map(([path, catalog]) => [
    path
      .split('/')
      .at(-1)!
      .replace('.json', '')
      .replaceAll('_', '-')
      .toLowerCase(),
    catalog,
  ]),
)

let locale = 'en'

export function setTestLocale(value: string): void {
  locale = value
}

// Model native message lookup; the real WXT wrapper still handles plural forms.
export const testI18n = {
  getUILanguage: () => locale,
  getMessage(key: string, substitutions: string[] = []): string {
    const normalized = locale.toLowerCase().replaceAll('_', '-')
    const value =
      catalogs[normalized]?.[key] ??
      catalogs[normalized.split('-')[0]]?.[key] ??
      en[key as keyof typeof en]
    if (!value) return ''
    const message =
      typeof value === 'string' ? value : Object.values(value).join(' | ')
    return message.replace(
      /\$(\d)/g,
      (_, index: string) => substitutions[Number(index) - 1] ?? '',
    )
  },
}

export const browser = { i18n: testI18n }
