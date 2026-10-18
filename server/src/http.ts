/** Small request and response helpers for the Worker's own endpoints. */
import type { ApiErrorCode, ApiErrorResponse } from './protocol'

/** Headers on every API response (auth included). Static assets are left to the platform. */
export const API_SECURITY_HEADERS: Readonly<Record<string, string>> = {
  'X-Content-Type-Options': 'nosniff',
  'Referrer-Policy': 'same-origin',
}

/** A JSON response that is never cached, with the API security headers. */
export function json(body: unknown, status = 200, headers: HeadersInit = {}): Response {
  const response = Response.json(body, { status, headers })
  response.headers.set('Cache-Control', 'no-store')
  for (const [name, value] of Object.entries(API_SECURITY_HEADERS)) {
    response.headers.set(name, value)
  }
  return response
}

/** An error from our own endpoints: `{ "error": code }`. */
export function apiError(status: number, error: ApiErrorCode, headers: HeadersInit = {}): Response {
  const body: ApiErrorResponse = { error }
  return json(body, status, headers)
}

/** 405 for a known path requested with a method it does not serve. */
export function methodNotAllowed(allow: string): Response {
  return apiError(405, 'bad-request', { Allow: allow })
}

/**
 * `response` with the API security headers added, on a copy (headers of fetched responses are
 * immutable). Upgrade responses (101) are returned unchanged.
 */
export function withApiHeaders(response: Response): Response {
  if (response.status === 101) return response
  const copy = new Response(response.body, response)
  for (const [name, value] of Object.entries(API_SECURITY_HEADERS)) {
    copy.headers.set(name, value)
  }
  return copy
}

/** Whether `request` asks for a WebSocket upgrade. */
export function isWebSocketUpgrade(request: Request): boolean {
  return request.headers.get('Upgrade')?.toLowerCase() === 'websocket'
}
