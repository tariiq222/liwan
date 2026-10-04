import { z } from 'zod'
import type { Pool } from 'pg'
import { CommercialHttpError } from './lifecycle.js'
import { parseBody, need, type CommercialInput } from './http.js'
import { acceptInvitation, issueInvitation, InvitationError, MIN_PASSWORD_LENGTH, type SetPassword } from './invitations.js'

const DEFAULT_TTL = 72 * 3600

/** Public: POST /v1/invitations/accept {token,password}. No vendor auth. All failures are one generic 400 (no token oracle). Caller should rate-limit by IP. Returns null when route does not match. */
export async function invitationPublicHttp(pool: Pool, i: { method: string; pathname: string; raw: string; setPassword?: SetPassword }) {
  if (i.pathname !== '/v1/invitations/accept') return null
  if (i.method !== 'POST') throw new CommercialHttpError('not_found', 404)
  let body: { token: string; password: string }
  try { body = parseBody(i.raw, z.strictObject({ token: z.string().min(20).max(200), password: z.string().min(MIN_PASSWORD_LENGTH).max(256) })) }
  catch { throw new CommercialHttpError('invalid_invitation', 400) }
  try { await acceptInvitation(pool, { ...body, setPassword: i.setPassword }) }
  catch (e) {
    if (e instanceof InvitationError && e.code === 'password_setter_unavailable') throw new CommercialHttpError('unavailable', 503)
    if (e instanceof InvitationError) throw new CommercialHttpError('invalid_invitation', 400)
    throw e
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
