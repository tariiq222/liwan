import type { H3Event } from 'h3'
import { tenantRequest } from './tenantRequest'

type AcceptConfig = { customerCommercialPublicOrigin?: string }

function fail(statusCode: number, code: string, message: string): never {
  throw createError({ statusCode, data: { code, message } })
}

/** Same-origin + JSON-only check for the public (session-less) invitation accept route. */
export function assertPublicMutationOrigin(event: H3Event, config: AcceptConfig): void {
  const contentType = getHeader(event, 'content-type')?.split(';', 1)[0]?.trim().toLowerCase()
  if (contentType !== 'application/json') fail(415, 'unsupported_media_type', 'JSON requests are required')
  const site = getHeader(event, 'sec-fetch-site')
  if (site && site !== 'same-origin') fail(403, 'cross_site_request', 'Cross-site request rejected')
  const bound = tenantRequest(event)
  let expected: URL
  try { expected = new URL(bound ? `https://${bound.host.toLowerCase()}` : (config.customerCommercialPublicOrigin ?? '')) } catch { return fail(503, 'unavailable', 'Service unavailable') }
  const origin = getHeader(event, 'origin')
  if (!origin || origin !== expected.origin) fail(403, 'cross_site_request', 'Request origin rejected')
}

// Outcomes the control plane answers identically for every token, or reaches only with a valid
// one: an unknown, expired or used token is one generic 400 there, and its password-policy check
// does not depend on the token. Passing these through therefore creates no token oracle.
// pickAcceptBody below caps the password at the control plane's 256 characters first.
const ACCEPT_OUTCOMES: Record<string, { status: number; message: string }> = {
  password_rejected: { status: 422, message: 'Password rejected' },
  account_unavailable: { status: 409, message: 'Account unavailable' },
  in_progress: { status: 409, message: 'Acceptance in progress' },
}

/** The control-plane outcome to pass through for a valid token, or null for every other failure. */
export function acceptOutcome(status: number, code: unknown): { status: number; code: string; message: string } | null {
  const outcome = typeof code === 'string' ? ACCEPT_OUTCOMES[code] : undefined
  return outcome && outcome.status === status ? { code: code as string, ...outcome } : null
}

/** Strips every field except token and password; returns null when either is not a non-empty string. */
export function pickAcceptBody(body: unknown): { token: string; password: string } | null {
  if (body === null || typeof body !== 'object' || Array.isArray(body)) return null
  const { token, password } = body as Record<string, unknown>
  if (typeof token !== 'string' || typeof password !== 'string' || !token || !password) return null
  if (token.length > 512 || password.length > 256) return null
  return { token, password }
}

/** Strips every field except token; returns null when it is not a non-empty string of bounded length. */
export function pickCheckBody(body: unknown): { token: string } | null {
  if (body === null || typeof body !== 'object' || Array.isArray(body)) return null
  const { token } = body as Record<string, unknown>
  if (typeof token !== 'string' || !token || token.length > 512) return null
  return { token }
}
