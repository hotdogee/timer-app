/**
 * Limits on mailing sign-in codes, on top of Better Auth's per-IP rate limits (which cannot see
 * the address): each address gets {@link CODE_EMAILS_PER_ADDRESS} an hour, whoever asks, so one
 * client cannot flood an inbox or keep resending a victim's code; and, with a real mailer, the
 * whole server sends at most `EMAIL_DAILY_LIMIT` a day (Resend's plan), so a flood cannot use up
 * the quota that everyone's sign-in depends on. Without a mailer outside development nothing can
 * be delivered, so a code request fails at once instead of waiting for an email that never comes.
 *
 * Counters live in D1 (`sendLimit`, migrations/0002_send_limits.sql), in fixed windows, one atomic
 * upsert per check. Addresses are stored as SHA-256 hashes, never in the clear.
 */
import { APIError } from 'better-auth/api'

import { isDevelopment, setting } from './config'

/** Code emails allowed per address and window. */
export const CODE_EMAILS_PER_ADDRESS = { windowSeconds: 60 * 60, max: 5 } as const

/** `EMAIL_DAILY_LIMIT` when unset: Resend's free plan sends 100 emails a day. */
export const DEFAULT_DAILY_CODE_EMAILS = 100

/** Counter rows older than this are deleted as new ones are written. */
const PRUNE_AFTER_MS = 2 * 24 * 60 * 60 * 1000

/** Error codes the gate answers with (Better Auth's `{ code, message }` body). */
export const SEND_LIMIT_ERROR_CODES = {
  /** 429: this address got too many codes lately. `X-Retry-After` says when to try again. */
  tooManyEmails: 'TOO_MANY_CODE_EMAILS',
  /** 503: codes cannot be emailed now (no mailer, or the day's quota is used up). */
  unavailable: 'EMAIL_UNAVAILABLE',
} as const

/** An address as Better Auth keys its codes: trimmed and lowercased. */
export function normalizeEmail(email: string): string {
  return email.trim().toLowerCase()
}

/** The counter key of an address: `email:<sha-256 hex>`. */
export async function addressKey(email: string): Promise<string> {
  const digest = await crypto.subtle.digest(
    'SHA-256',
    new TextEncoder().encode(normalizeEmail(email)),
  )
  const hex = [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, '0'))
  return `email:${hex.join('')}`
}

/** The counter key of a UTC day: `day:2026-10-18`. */
export function dayKey(now: number): string {
  return `day:${new Date(now).toISOString().slice(0, 10)}`
}

export interface Consumed {
  readonly allowed: boolean
  /** Seconds until the window ends; 0 when allowed. */
  readonly retryAfter: number
}

/**
 * Counts one use of `key` in a fixed window of `windowSeconds` that starts at its first use, and
 * says whether that use is within `max`. Atomic (one upsert); refused uses count too, which does
 * not stretch the window. Also prunes counters older than two days.
 */
export async function consume(
  db: D1Database,
  key: string,
  windowSeconds: number,
  max: number,
  now: number = Date.now(),
): Promise<Consumed> {
  const windowMs = windowSeconds * 1000
  const [counted] = await db.batch<{ count: number; windowStart: number }>([
    db
      .prepare(
        `insert into "sendLimit" ("key", "windowStart", "count") values (?1, ?2, 1)
         on conflict ("key") do update set
           "count" = case when "windowStart" <= ?2 - ?3 then 1 else "count" + 1 end,
           "windowStart" = case when "windowStart" <= ?2 - ?3 then ?2 else "windowStart" end
         returning "count", "windowStart"`,
      )
      .bind(key, now, windowMs),
    db.prepare('delete from "sendLimit" where "windowStart" < ?').bind(now - PRUNE_AFTER_MS),
  ])
  const row = counted?.results[0]
  if (!row || row.count <= max) return { allowed: true, retryAfter: 0 }
  return {
    allowed: false,
    retryAfter: Math.max(1, Math.ceil((row.windowStart + windowMs - now) / 1000)),
  }
}

/** The day's limit on code emails: `EMAIL_DAILY_LIMIT`, a positive whole number, or the default. */
export function dailyLimit(env: Env): number {
  const value = Number(setting(env, 'EMAIL_DAILY_LIMIT'))
  return Number.isInteger(value) && value > 0 ? value : DEFAULT_DAILY_CODE_EMAILS
}

function unavailable(): APIError {
  return new APIError('SERVICE_UNAVAILABLE', {
    code: SEND_LIMIT_ERROR_CODES.unavailable,
    message: 'Sign-in codes cannot be emailed right now.',
  })
}

/**
 * The check that runs before Better Auth makes and mails a sign-in code for `email`: throws an
 * `APIError` (503 without a way to deliver it or past the day's quota, 429 past the address's
 * limit) or resolves when the code may go out. With `RESEND_API_KEY` both limits apply; in
 * development without it (the console mailer) only the address limit does, so tests and local
 * runs are not capped by a quota they do not use.
 */
export function createCodeEmailGate(env: Env): (email: string) => Promise<void> {
  const mailer = setting(env, 'RESEND_API_KEY') !== undefined
  const development = isDevelopment(env)
  return async (email) => {
    if (!mailer && !development) throw unavailable()
    const address = await consume(
      env.DB,
      await addressKey(email),
      CODE_EMAILS_PER_ADDRESS.windowSeconds,
      CODE_EMAILS_PER_ADDRESS.max,
    )
    if (!address.allowed) {
      throw new APIError(
        'TOO_MANY_REQUESTS',
        {
          code: SEND_LIMIT_ERROR_CODES.tooManyEmails,
          message: 'Too many codes were sent to this address. Try again later.',
        },
        { 'X-Retry-After': String(address.retryAfter) },
      )
    }
    if (!mailer) return
    const now = Date.now()
    const day = await consume(env.DB, dayKey(now), 24 * 60 * 60, dailyLimit(env), now)
    if (!day.allowed) {
      console.error('[mail] The daily limit on sign-in code emails is reached (EMAIL_DAILY_LIMIT).')
      throw unavailable()
    }
  }
}
