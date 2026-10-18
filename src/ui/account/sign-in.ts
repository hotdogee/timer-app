/**
 * The sign-in form's input rules: what counts as an email address worth sending a code to, and
 * the digits of a typed or pasted code. Pure.
 */
import { OTP_EXPIRES_IN_SECONDS, OTP_LENGTH } from '../../sync/protocol'

/**
 * Whether `text` looks like an email address: something, `@`, a domain with a dot, no spaces. The
 * server checks properly; this only catches slips before a code is requested.
 */
export function isEmailAddress(text: string): boolean {
  return /^[^\s@]+@[^\s@.]+(?:\.[^\s@.]+)+$/.test(text.trim())
}

/** The digits of a typed or pasted code (`'123 456'`, `'123-456'`), at most {@link OTP_LENGTH}. */
export function codeDigits(text: string): string {
  return text.replace(/\D/g, '').slice(0, OTP_LENGTH)
}

/** Whether `code` is a whole code: exactly {@link OTP_LENGTH} digits. */
export function isCompleteCode(code: string): boolean {
  return code.length === OTP_LENGTH && /^\d+$/.test(code)
}

/** Minutes an emailed code stays valid, for the "expires in" hint. */
export const CODE_LIFETIME_MINUTES = Math.round(OTP_EXPIRES_IN_SECONDS / 60)

/** Digits in an emailed code. */
export const CODE_LENGTH = OTP_LENGTH
