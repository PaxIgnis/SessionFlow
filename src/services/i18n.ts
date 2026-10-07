import { i18n } from '#i18n'
import { browser } from 'wxt/browser'

export { i18n }

/** The browser selects messages, including regional and English fallback. */
export function getDisplayLocale(): string {
  const locale = (browser.i18n.getMessage as (key: string) => string)(
    'localeCode',
  ).trim()
  if (!locale) return 'en'
  try {
    return Intl.getCanonicalLocales(locale)[0] ?? 'en'
  } catch {
    return 'en'
  }
}

export function formatNumber(
  value: number,
  options?: Intl.NumberFormatOptions,
): string {
  return new Intl.NumberFormat(getDisplayLocale(), options).format(value)
}

export function formatList(items: string[]): string {
  return new Intl.ListFormat(getDisplayLocale(), {
    type: 'conjunction',
  }).format(items)
}

export function localizeDocument(): void {
  document.documentElement.lang = getDisplayLocale()
  for (const element of document.querySelectorAll<HTMLElement>('[data-i18n]')) {
    const key = element.dataset.i18n as Parameters<typeof i18n.t>[0]
    element.textContent = i18n.t(key)
  }
}
