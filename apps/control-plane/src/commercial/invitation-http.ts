import { z } from 'zod'
import type { Pool } from 'pg'
import { CommercialHttpError } from './lifecycle.js'
import { parseBody, need, type CommercialInput } from './http.js'
import { acceptInvitation, isInvitationUsable, issueInvitation, InvitationError, MIN_PASSWORD_LENGTH, MAX_TOKEN_LENGTH, type SetPassword } from './invitations.js'

const DEFAULT_TTL = 72 * 3600

/** Setter/acceptance failure -> [public code, HTTP status]. Anything not listed is a generic 503. */
const INVITATION_ERRORS: Record<string, [string, number]> = {
  invalid: ['invalid_invitation', 400],
  password_policy: ['password_rejected', 422],
  user_missing: ['account_unavailable', 409],
  user_inactive: ['account_unavailable', 409],
  database_invalid: ['account_unavailable', 409],
  busy: ['in_progress', 409],
}

/** Public: POST /v1/invitations/check {token} -> {usable}. Read-only, one constant shape for unknown, malformed, expired, used and revoked tokens, so it reveals nothing accept would not. */
async function invitationCheck(pool: Pool, raw: string) {
  let token: unknown
  try { token = (JSON.parse(raw) as { token?: unknown }).token } catch { token = null }
  return { status: 200, data: { usable: await isInvitationUsable(pool, token) } }
}

/** Public: POST /v1/invitations/accept {token,password}. No vendor auth. An unknown, expired or used token is one generic 400 (no token oracle); only a valid token can reach the 409/422/503 effect outcomes. Caller should rate-limit by IP. Returns null when route does not match. */
export async function invitationPublicHttp(pool: Pool, i: { method: string; pathname: string; raw: string; setPassword?: SetPassword }) {
  if (i.pathname !== '/v1/invitations/accept' && i.pathname !== '/v1/invitations/check') return null
  if (i.method !== 'POST') throw new CommercialHttpError('not_found', 404)
  if (i.pathname === '/v1/invitations/check') return invitationCheck(pool, i.raw)
  let body: { token: string; password: string }
  try { body = parseBody(i.raw, z.strictObject({ token: z.string().min(20).max(MAX_TOKEN_LENGTH), password: z.string().min(MIN_PASSWORD_LENGTH) })) }
  catch { throw new CommercialHttpError('invalid_invitation', 400) }
  try { await acceptInvitation(pool, { ...body, setPassword: i.setPassword }) }
  catch (e) {
    if (!(e instanceof InvitationError)) throw e
    const mapped = INVITATION_ERRORS[e.code]
    if (mapped) throw new CommercialHttpError(mapped[0], mapped[1])
    throw new CommercialHttpError('unavailable', 503)
  }
  return { status: 200, data: { ok: true } }
}

/** Vendor: POST /v1/commercial/customers/:id/invitations (vendor.subscriptions.manage). Requires an applied first fulfillment. */
export async function invitationVendorHttp(pool: Pool, input: CommercialInput) {
  const m = /^\/v1\/commercial\/customers\/([^/]+)\/invitations$/.exec(input.pathname)
  if (!m) return null
  if (input.method !== 'POST') throw new CommercialHttpError('not_found', 404)
  need(input, 'vendor.subscriptions.manage')
  if (!z.uuid().safeParse(m[1]).success) throw new CommercialHttpError('not_found', 404)
  const body = parseBody(input.raw || '{}', z.strictObject({ ttl_seconds: z.number().int().min(300).max(7 * 86400).optional() }))
  const r = await pool.query(
    `SELECT s.tenant_id, s.applied_revision_id, c.admin_login FROM customers c JOIN subscriptions s ON s.customer_id=c.id WHERE c.id=$1`, [m[1]])
  const row = r.rows[0]
  if (!row) throw new CommercialHttpError('not_found', 404)
  if (!row.tenant_id || !row.applied_revision_id) throw new CommercialHttpError('not_ready', 409)
  if (!row.admin_login) throw new CommercialHttpError('invalid', 422, 'admin_login')
  const inv = await issueInvitation(pool, { customer_id: m[1], tenant_id: row.tenant_id, admin_login: row.admin_login, ttl_seconds: body.ttl_seconds ?? DEFAULT_TTL })
  return { status: 202, data: { id: inv.id, expires_at: inv.expires_at.toISOString(), delivery_status: 'queued' } }
}

export async function invitationHttp(pool: Pool, input: CommercialInput & { setPassword?: SetPassword }) {
  return (await invitationPublicHttp(pool, input)) ?? (await invitationVendorHttp(pool, input))
}
