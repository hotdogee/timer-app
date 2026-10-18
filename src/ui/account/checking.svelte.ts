/**
 * How long the account UI says "Checking your account…" before offering sign-in anyway. The auth
 * state is `unknown` until the server first answers (a device with a saved account starts signed
 * in instead), so `unknown` that lasts means the server cannot be reached: the form then shows,
 * and trying it explains the problem. Normally the answer comes well within the wait.
 */

/** The wait, in milliseconds. */
export const CHECKING_PATIENCE_MS = 3000

/**
 * Whether `isUnknown()` has stayed true for `ms`; false again as soon as it turns false. Reactive.
 * Call it while a component initializes (it runs an effect).
 */
export function checkingPatience(
  isUnknown: () => boolean,
  ms: number = CHECKING_PATIENCE_MS,
): { readonly expired: boolean } {
  let expired = $state(false)
  $effect(() => {
    expired = false
    if (!isUnknown()) return
    const timer = setTimeout(() => {
      expired = true
    }, ms)
    return () => {
      clearTimeout(timer)
    }
  })
  return {
    get expired() {
      return expired
    },
  }
}
