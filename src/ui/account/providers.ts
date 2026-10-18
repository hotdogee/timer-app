/**
 * The OAuth providers' names on the sign-in buttons ("Continue with Google"). Brand names read the
 * same in every language, so they are not messages; the sentence around them is.
 */
import { m } from '../../i18n'
import type { Provider } from '../../sync/protocol'

/** Each provider's brand name. */
export const PROVIDER_NAMES: Readonly<Record<Provider, string>> = Object.freeze({
  google: 'Google',
  github: 'GitHub',
  apple: 'Apple',
})

/** "Continue with Google", in the active locale. */
export function continueWithLabel(provider: Provider): string {
  return m.account_continue_with({ provider: PROVIDER_NAMES[provider] })
}
