/**
 * Internationalization (spec › Internationalization): reactive messages (`m`), the active locale
 * and its resolution from the language setting. See `locale.svelte.ts` and `messages.svelte.ts`.
 * The localized names of core enum values that only the settings dialog lists (keyboard actions,
 * import errors) are in `labels.ts`, imported from there, so they load with the dialog.
 */
export {
  BASE_LOCALE,
  LOCALES,
  LOCALE_NAMES,
  applyLocaleSetting,
  browserLanguages,
  isLocale,
  localeState,
  matchLanguage,
  resolveLocale,
  setAppLocale,
  type LanguageSource,
  type Locale,
  type LocaleSetting,
} from './locale.svelte'
export { m, type MessageKey, type Messages } from './messages.svelte'
