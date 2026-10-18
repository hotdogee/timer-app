/**
 * Sends the emailed sign-in codes. With `RESEND_API_KEY` the code goes out through Resend's HTTP
 * API; without it nothing is mailed. In development the code is then written to the Worker console
 * and kept in memory for `GET /__dev/otp` (end-to-end tests read it there). In production a
 * missing key is a misconfiguration: the code requests are refused before a code is made
 * (`send-limit.ts`), and the mailer itself never logs a code or an address, since Workers Logs
 * keep what the console prints.
 *
 * The text is English only for now; server-side translations can follow the client's locales.
 */
import { isDevelopment, setting } from './config'
import { OTP_EXPIRES_IN_SECONDS } from './protocol'

/** Resend's send-email endpoint. */
export const RESEND_ENDPOINT = 'https://api.resend.com/emails'

/** Sender used when `EMAIL_FROM` is not set: Resend's test address, which only mails the owner. */
export const FALLBACK_FROM = 'Timer App <onboarding@resend.dev>'

export const CODE_EMAIL_SUBJECT = 'Your Timer App sign-in code'

export interface Mailer {
  /**
   * Sends `otp` to `email`. Resolves when done; delivery failures are logged, never thrown. Rejects
   * only when there is no way to deliver at all (production without `RESEND_API_KEY`).
   */
  sendCode(email: string, otp: string): Promise<void>
}

/** Development only: the last code "sent" to each address (lowercased) by the console mailer. */
const devCodes = new Map<string, string>()

function normalizeEmail(email: string): string {
  return email.trim().toLowerCase()
}

/**
 * The last code the console mailer produced for `email` in this isolate, or undefined. Only ever
 * filled in development (`APP_ENV=development` without `RESEND_API_KEY`).
 */
export function lastDevCode(email: string): string | undefined {
  return devCodes.get(normalizeEmail(email))
}

/** The plain-text and HTML bodies of the sign-in email. */
export function codeEmail(otp: string): { text: string; html: string } {
  const minutes = Math.round(OTP_EXPIRES_IN_SECONDS / 60)
  const text =
    `Your Timer App code: ${otp}. It expires in ${String(minutes)} minutes.\n\n` +
    `If you did not try to sign in, you can ignore this email.`
  const html =
    `<p>Your Timer App code:</p>` +
    `<p style="font-size:28px;font-weight:600;letter-spacing:4px">${otp}</p>` +
    `<p>It expires in ${String(minutes)} minutes.</p>` +
    `<p>If you did not try to sign in, you can ignore this email.</p>`
  return { text, html }
}

/** The mailer for this environment (see the module comment). */
export function createMailer(env: Env): Mailer {
  const apiKey = setting(env, 'RESEND_API_KEY')
  if (!apiKey) {
    if (!isDevelopment(env)) {
      return {
        sendCode() {
          // Never the code or the address: Workers Logs keep what the console prints.
          console.error('[mail] RESEND_API_KEY is not set; sign-in codes cannot be delivered.')
          return Promise.reject(new Error('No mailer is configured (RESEND_API_KEY).'))
        },
      }
    }
    return {
      sendCode(email, otp) {
        devCodes.set(normalizeEmail(email), otp)
        console.warn(`[mail] RESEND_API_KEY is not set; no email sent. Code for ${email}: ${otp}`)
        return Promise.resolve()
      },
    }
  }
  const from = setting(env, 'EMAIL_FROM') ?? FALLBACK_FROM
  return {
    async sendCode(email, otp) {
      const { text, html } = codeEmail(otp)
      try {
        const response = await fetch(RESEND_ENDPOINT, {
          method: 'POST',
          headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
          body: JSON.stringify({ from, to: [email], subject: CODE_EMAIL_SUBJECT, text, html }),
        })
        if (!response.ok) {
          const detail = (await response.text().catch(() => '')).slice(0, 500)
          console.error(
            `[mail] Resend did not send the code: HTTP ${String(response.status)} ${detail}`,
          )
        }
      } catch (error) {
        console.error(
          '[mail] Could not reach Resend:',
          error instanceof Error ? error.message : error,
        )
      }
    },
  }
}
