/**
 * The app's messages (`messages/*.json`, compiled by Paraglide into `src/paraglide/`), reactive:
 * `m.card_start()` returns the text in the active locale and, because every compiled message asks
 * Paraglide's `getLocale()`, which `locale.svelte.ts` points at `localeState.current`, a template,
 * `$derived` or effect that calls it re-runs when the locale changes. Nothing needs a reload or a
 * key on the locale.
 *
 * `m` is Paraglide's own namespace, not a copy: the bundler keeps only the messages the app uses
 * (and puts them in the chunk that uses them). Import it from here (or `src/i18n`), never from
 * `src/paraglide` directly, so the locale reader is installed first.
 *
 * Every user-facing string goes through `m` (aria-labels and announcements included). Call it
 * where the text is needed (in markup, a `$derived`, or at the moment a message is built), never
 * once at module load, or the text stays in the language of that moment. An explicit
 * `{ locale }` option still picks a locale, as with any Paraglide message.
 *
 * ```svelte
 * <script lang="ts">
 *   import { m } from '../i18n'
 * </script>
 * <Button label={m.card_start()} />
 * <p>{m.card_delete({ name: card.name })}</p>
 * ```
 */
// Installs the reactive locale reader before any message runs.
import './locale.svelte'

import { m } from '../paraglide/messages.js'

/** Every message function, by key, with Paraglide's typed inputs. */
export type Messages = typeof m

/** The message keys, e.g. `'card_start'`. */
export type MessageKey = keyof Messages

export { m }
