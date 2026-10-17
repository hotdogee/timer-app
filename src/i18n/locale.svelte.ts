/**
 * The app's language (spec › Internationalization): which locale the UI speaks, how the `'auto'`
 * setting maps the browser's languages onto the three launch locales, and the one place that
 * switches it.
 *
 * `localeState.current` is reactive, and it is what Paraglide's `getLocale()` returns: every
 * compiled message reads it (see `messages.svelte.ts`), so any template, `$derived` or effect that
 * shows a message follows a switch without a reload. `setAppLocale` is the only writer; it also
 * sets Paraglide's own global (strategy `globalVariable`) and `<html lang>`. The document direction
 * stays `ltr`: no launch language is right-to-left.
 */
import { untrack } from 'svelte'

import type { settings } from '../core'
import { baseLocale, locales, overwriteGetLocale, setLocale } from '../paraglide/runtime.js'

/** A UI language: `'en'`, `'zh-TW'` or `'ja'` (the same union as the settings' `Locale`). */
export type Locale = settings.Locale

/** The language setting: a locale, or `'auto'` to follow the browser. */
export type LocaleSetting = Locale | 'auto'

/** The locale used when nothing else applies (`'en'`). */
export const BASE_LOCALE: Locale = baseLocale

/** Every UI locale, in the order the language setting lists them. */
export const LOCALES: readonly Locale[] = locales

/**
 * Each locale's name in its own language, for the language setting. Endonyms do not change with
 * the UI language, so they are not messages.
 */
export const LOCALE_NAMES: Readonly<Record<Locale, string>> = Object.freeze({
  en: 'English',
  'zh-TW': '繁體中文',
  ja: '日本語',
})

/** Whether `value` is one of the UI locales, spelled exactly (`'zh-TW'`, not `'zh-tw'`). */
export function isLocale(value: unknown): value is Locale {
  return typeof value === 'string' && (LOCALES as readonly string[]).includes(value)
}

/** Script subtags that mark Chinese as Traditional or Simplified. */
const HANT = 'hant'
const HANS = 'hans'

/** Regions whose Chinese is Traditional when no script is given. */
const TRADITIONAL_REGIONS: ReadonlySet<string> = new Set(['tw', 'hk', 'mo'])

/**
 * The launch locale for one BCP 47 language tag, or `null` when none fits. Case and `_` separators
 * are tolerated. Japanese → `ja`; English → `en`; Chinese in Traditional script (`zh-Hant`, any
 * region) or, without a script, in Taiwan, Hong Kong or Macau → `zh-TW`. Simplified Chinese and
 * every other language give `null`. Only the language, script and region subtags count: an
 * extension (`-u-…`) or private use (`-x-…`) part is ignored.
 */
export function matchLanguage(tag: string): Locale | null {
  if (typeof tag !== 'string') return null
  const [language = '', ...subtags] = tag.trim().toLowerCase().replaceAll('_', '-').split('-')
  if (language === 'ja') return 'ja'
  if (language === 'en') return 'en'
  if (language !== 'zh') return null
  let script: string | undefined
  let region: string | undefined
  for (const subtag of subtags) {
    // A singleton starts an extension or private use: nothing after it is a script or region.
    if (subtag.length <= 1) break
    if (script === undefined && region === undefined && /^[a-z]{4}$/.test(subtag)) {
      script = subtag
    } else if (region === undefined && /^(?:[a-z]{2}|[0-9]{3})$/.test(subtag)) {
      region = subtag
    }
  }
  if (script === HANT) return 'zh-TW'
  if (script === HANS) return null
  return region !== undefined && TRADITIONAL_REGIONS.has(region) ? 'zh-TW' : null
}

/**
 * The locale to use: an explicit `setting` wins; `'auto'` (or anything that is not a locale) takes
 * the first of `languages` (the browser's preference list, `navigator.languages`) that
 * {@link matchLanguage} maps, and falls back to English.
 */
export function resolveLocale(
  setting: LocaleSetting,
  languages: readonly string[] | undefined,
): Locale {
  if (isLocale(setting)) return setting
  for (const tag of languages ?? []) {
    const locale = matchLanguage(tag)
    if (locale !== null) return locale
  }
  return BASE_LOCALE
}

/** The parts of `Navigator` that {@link browserLanguages} reads. */
export interface LanguageSource {
  readonly languages?: readonly string[] | undefined
  readonly language?: string | undefined
}

/**
 * The browser's preferred languages, most preferred first: `navigator.languages`, else
 * `navigator.language`, else none (outside a browser).
 */
export function browserLanguages(
  source: LanguageSource | undefined = typeof navigator === 'undefined' ? undefined : navigator,
): readonly string[] {
  const list = source?.languages
  if (list !== undefined && list.length > 0) return list
  const one = source?.language
  return typeof one === 'string' && one !== '' ? [one] : []
}

let current = $state<Locale>(BASE_LOCALE)

/** The active UI locale. `current` is reactive. */
export const localeState: { readonly current: Locale } = {
  get current() {
    return current
  },
}

// Every compiled message picks its locale with `getLocale()` (unless given one): make that read
// the reactive state, so whatever calls a message depends on the locale.
overwriteGetLocale(() => current)

/**
 * Switches the UI to `locale` without a reload: Paraglide's locale, `<html lang>` and
 * `localeState` (which re-renders every message). Something that is not a locale switches to
 * English. Safe outside a browser (no document: only the state changes).
 */
export function setAppLocale(locale: Locale): void {
  const next = isLocale(locale) ? locale : BASE_LOCALE
  // Paraglide's setLocale reads getLocale(); keep that read out of a calling effect's dependencies.
  untrack(() => {
    void setLocale(next, { reload: false })
  })
  if (typeof document !== 'undefined') document.documentElement.lang = next
  current = next
}

/**
 * Applies the language setting: resolves it against `languages` (the browser's, by default) and
 * switches to the result, which it returns. Call it before mounting and whenever the setting
 * changes.
 */
export function applyLocaleSetting(
  setting: LocaleSetting,
  languages: readonly string[] = browserLanguages(),
): Locale {
  const locale = resolveLocale(setting, languages)
  setAppLocale(locale)
  return locale
}
