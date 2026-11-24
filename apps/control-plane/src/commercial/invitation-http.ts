import { z } from 'zod'
import { isIP } from 'node:net'
import type { Pool } from 'pg'
import { CommercialHttpError } from './lifecycle.js'
import { assertCustomerNotRetiring } from './tenant-deletion-read.js'
import { parseBody, need, needStepUp, type CommercialInput } from './http.js'
import { verifyServiceRequest } from '@liwan/commercial-contracts/server'
import { controlTenantForSigned, isSignedTenantFormat } from './signed-tenant.js'
import { actorLabel } from '../admin-auth/grants.js'
import { acceptInvitation, isInvitationUsable, issueInvitation, DEFAULT_INVITATION_TTL_SECONDS, InvitationError, MIN_PASSWORD_LENGTH, MAX_TOKEN_LENGTH, type SetPassword } from './invitations.js'

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

/** The tenant a signed accept request is bound to, verified the same way the signed headers of the other public
 *  invitation routes are: the Nuxt server vouches for the workspace its host belongs to. The tenant is never taken
 *  from the body, so a visitor cannot aim the accept at another workspace. */
export const ACCEPT_PATH = '/v1/invitations/accept'
export type AcceptTenantContext = { tenant_id: string; client_address: string }
export async function verifiedAcceptTenant(pool: Pool, headers: Record<string, string | string[] | undefined>, service: { issuer?: string; key?: string }): Promise<AcceptTenantContext | null> {
  const tenant = headers['x-liwan-tenant']
  const ip = headers['x-liwan-client-ip']
  if (typeof tenant !== 'string' || !isSignedTenantFormat(tenant) || !service.issuer || !service.key) return null
  // The visitor address is part of the same signature: the route budgets one accept per visitor, and a
  // second signature over the same headers would need a second nonce and signature the protocol has no room for.
  if (typeof ip !== 'string' || !isIP(ip)) return null
  const signed = verifyServiceRequest({ method: 'POST', path: ACCEPT_PATH, body: `liwan-invitation-accept:${tenant}\n${ip}\n`, headers, key: service.key, anonymous: true })
  if (signed?.issuer !== service.issuer) return null
  // Only now, with the signature checked over the value exactly as sent, may it name a control tenant (a registry id goes through its enabled binding).
  const controlTenant = await controlTenantForSigned(pool, tenant)
  return controlTenant ? { tenant_id: controlTenant.toLowerCase(), client_address: ip } : null
}

/** Public: POST /v1/invitations/accept {token,password}. No vendor auth. The request must carry the signed workspace
 *  binding (`tenant`, from verifiedAcceptTenant): without it, or when it names another workspace than the token's,
 *  the answer is one generic 400 like an invalid token (no oracle). Caller should rate-limit by IP. Returns null when route does not match. */
export async function invitationPublicHttp(pool: Pool, i: { method: string; pathname: string; raw: string; setPassword?: SetPassword; tenant?: string }) {
  if (i.pathname !== '/v1/invitations/accept' && i.pathname !== '/v1/invitations/check') return null
  if (i.method !== 'POST') throw new CommercialHttpError('not_found', 404)
  if (i.pathname === '/v1/invitations/check') return invitationCheck(pool, i.raw)
  if (!i.tenant) throw new CommercialHttpError('invalid_invitation', 400)
  let body: { token: string; password: string }
  try { body = parseBody(i.raw, z.strictObject({ token: z.string().min(20).max(MAX_TOKEN_LENGTH), password: z.string().min(MIN_PASSWORD_LENGTH) })) }
  catch { throw new CommercialHttpError('invalid_invitation', 400) }
  try { await acceptInvitation(pool, { ...body, tenant_id: i.tenant, setPassword: i.setPassword }) }
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
  needStepUp(input)
  if (!z.uuid().safeParse(m[1]).success) throw new CommercialHttpError('not_found', 404)
  await assertCustomerNotRetiring(pool, m[1])
  const body = parseBody(input.raw || '{}', z.strictObject({ ttl_seconds: z.number().int().min(300).max(7 * 86400).optional() }))
  const r = await pool.query(
    `SELECT s.tenant_id, s.applied_revision_id, c.admin_login FROM customers c JOIN subscriptions s ON s.customer_id=c.id WHERE c.id=$1`, [m[1]])
  const row = r.rows[0]
  if (!row) throw new CommercialHttpError('not_found', 404)
  if (!row.tenant_id || !row.applied_revision_id) throw new CommercialHttpError('not_ready', 409)
  if (!row.admin_login) throw new CommercialHttpError('invalid', 422, 'admin_login')
  const inv = await issueInvitation(pool, { customer_id: m[1], tenant_id: row.tenant_id, admin_login: row.admin_login, ttl_seconds: body.ttl_seconds ?? DEFAULT_INVITATION_TTL_SECONDS,
    audit: { actor: actorLabel({ issuer: input.issuer, actorUid: input.actor }), reason: 'Vendor resent the invitation', metadata: { source: 'vendor' } } })
    .catch(e => { throw e instanceof InvitationError && e.code === 'accepted' ? new CommercialHttpError('invitation_accepted', 409) : e })
  return { status: 202, data: { id: inv.id, expires_at: inv.expires_at.toISOString(), delivery_status: 'queued' } }
}

export async function invitationHttp(pool: Pool, input: CommercialInput & { setPassword?: SetPassword; tenant?: string }) {
  return (await invitationPublicHttp(pool, input)) ?? (await invitationVendorHttp(pool, input))
}
