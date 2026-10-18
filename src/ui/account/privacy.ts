/**
 * Where the privacy policy is published (spec › Sync › Obligations): the page `/privacy` of the
 * app's own site, which the build renders from `docs/privacy.md` (vite.config.ts › privacyPage)
 * and the Worker serves beside the app.
 */
import { apiOrigin } from '../../sync/api'

/** The privacy policy page's path on the app's site. */
export const PRIVACY_POLICY_PATH = '/privacy'

/**
 * The privacy policy's URL on the site at `origin` (the API's origin by default, which is the
 * site: the Worker serves both): relative on the web, where the page's own origin is that site,
 * and absolute in the desktop app, whose API origin is the production site.
 */
export function privacyPolicyUrl(origin: string = apiOrigin()): string {
  return origin + PRIVACY_POLICY_PATH
}

/** The privacy policy, for Settings › About and Account and the device approval page. */
export const PRIVACY_POLICY_URL = privacyPolicyUrl()
