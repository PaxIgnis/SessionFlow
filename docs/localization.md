# Localization

Session Flow follows Firefox's interface language. English (`en`) is the
fallback. English (`en`), German (`de`), and French (`fr`) are supported.
There is no separate language setting in the extension.

Translations live in `src/locales/`.
Keep top-level keys alphabetically sorted, using the same
order. Leave plural variants in their numeric/`n` order. French count messages
use `0`, `1`, and `n` variants so zero takes the singular form.
Use `i18n.t('key')` from `@/services/i18n` in components and services. WXT
generates typed keys and native `_locales/*/messages.json` files at build time.
Run `pnpm exec wxt prepare` after adding keys to refresh generated types.

Add complete messages with `$1`, `$2`, etc. for values. For
counts, use `{ "1": "$1 item", "n": "$1 items" }` and pass the count to
`i18n.t(key, count, [formatNumber(count)])` so plural selection uses the raw
count and the displayed number uses locale-aware formatting. Use `formatNumber`
for displayed numbers and `formatList` for conjunctions. Never translate user notes, custom
names, URLs, or webpage titles. Persisted import warnings are translated for
display using their source and code, without rewriting saved snapshots.

Keep technical identifiers and user-created names unchanged.
Keep console-only diagnostics and internal recovery errors in English. Translate
errors that can reach a user notification or dialog; some shared errors also
appear in the console. Preserve diagnostic details returned by browser APIs.

To add a language, copy the English catalog, translate every entry and preserve
placeholders. Set its `localeCode` entry to the language's valid Intl locale tag
(for example, `de`). Firefox's catalog fallback then selects the formatting locale,
and the test helper discovers the catalog automatically. Extend the catalog tests.
The WXT module supports `1`/`n` or `0`/`1`/`n` selection. Languages requiring
other plural rules need a pluralization solution beyond the current module.

Run `pnpm test`, `pnpm run compile`, and `pnpm run build:firefox`. Check the
extension in Firefox with indended interface languages, including
settings, menus, dialog wrapping, private-window onboarding, and import/export.
