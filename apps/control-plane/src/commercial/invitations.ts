import { randomUUID } from 'node:crypto'
import type { Pool } from 'pg'
import { enqueueOutbox, claimOutbox, completeOutbox, failOutbox } from './outbox.js'
import type { ReturnOrigin } from './return-origin.js'
import { buildInvitationUrl, createInvitationToken, hashToken, invitationExpiry, renderInvitationEmail } from './invitation-tokens.js'
import { isLocalCapture, type MailAdapter } from './mail-adapter.js'

export const INVITATION_KIND = 'invitation.send'
export const MIN_PASSWORD_LENGTH = 12
/** Same maxima as the internal effect protocol, enforced before the token is consumed. */
export const MAX_PASSWORD_LENGTH = 256
export const MAX_TOKEN_LENGTH = 200

/** Sets the tenant admin's own Odoo password. Without a configured adapter the default refuses,
 *  so acceptance never fakes success. */
export type SetPassword = (input: { tenant_id: string; admin_login: string; password: string; token: string }) => Promise<void>
export const unimplementedSetPassword: SetPassword = async () => { throw new InvitationError('password_setter_unavailable') }

export class InvitationError extends Error { constructor(public code: string) { super(code) } }

/** Rows are never returned with token material; the raw token only leaves via the outbox payload→email. */
export async function issueInvitation(pool: Pool, i: { customer_id: string; tenant_id: string; admin_login: string; ttl_seconds: number }) {
  const { token, token_hash } = createInvitationToken()
  const expires = invitationExpiry(i.ttl_seconds)
  const c = await pool.connect()
  try {
    await c.query('BEGIN')
    await c.query(`UPDATE admin_invitations SET revoked_at=now() WHERE tenant_id=$1 AND admin_login=$2 AND consumed_at IS NULL AND revoked_at IS NULL`, [i.tenant_id, i.admin_login])
    const id = randomUUID()
    await c.query(`INSERT INTO admin_invitations(id,customer_id,tenant_id,admin_login,token_hash,expires_at) VALUES($1,$2,$3,$4,$5,$6)`,
      [id, i.customer_id, i.tenant_id, i.admin_login, token_hash, expires])
    // The token must travel to the mailer; it is kept in the outbox payload only until sent, then scrubbed.
    await enqueueOutbox(c, { kind: INVITATION_KIND, aggregate_id: id, dedupe_key: id, payload: { invitation_id: id, token } })
    await c.query('COMMIT')
    return { id, expires_at: expires }
  } catch (e) { await c.query('ROLLBACK').catch(() => {}); throw e } finally { c.release() }
}

/** Readiness rule: call only once the subscription's first fulfillment is applied. */
export async function onSubscriptionActivated(pool: Pool, subscription_id: string, opts: { ttl_seconds?: number } = {}) {
  const r = await pool.query(
    `SELECT s.customer_id, s.tenant_id, s.applied_revision_id, c.admin_login FROM subscriptions s JOIN customers c ON c.id=s.customer_id WHERE s.id=$1`, [subscription_id])
  const s = r.rows[0]
  if (!s || !s.tenant_id || !s.applied_revision_id || !s.admin_login) return null
  const existing = await pool.query(`SELECT 1 FROM admin_invitations WHERE tenant_id=$1 AND admin_login=$2`, [s.tenant_id, s.admin_login])
  if (existing.rowCount) return null // already invited; resend is an explicit vendor action
  return issueInvitation(pool, { customer_id: s.customer_id, tenant_id: s.tenant_id, admin_login: s.admin_login, ttl_seconds: opts.ttl_seconds ?? 72 * 3600 })
}

export async function sendInvitationOutbox(pool: Pool, o: { mail: MailAdapter; returnOrigin: ReturnOrigin; smtpHost?: string; limit?: number }) {
  let sent = 0, failed = 0
  for (const row of await claimOutbox(pool, [INVITATION_KIND], o.limit ?? 20)) {
    const { invitation_id, token } = row.payload as { invitation_id: string; token?: string }
    try {
      const q = await pool.query(
        `SELECT i.admin_login, i.customer_id, c.name FROM admin_invitations i JOIN customers c ON c.id=i.customer_id
         WHERE i.id=$1 AND i.consumed_at IS NULL AND i.revoked_at IS NULL AND i.expires_at > now()`, [invitation_id])
      if (!q.rows[0] || !token) { await completeOutbox(pool, row.id); continue } // superseded/expired: nothing to send
      const mail = renderInvitationEmail({ companyName: q.rows[0].name, url: buildInvitationUrl(await o.returnOrigin(q.rows[0].customer_id), token) })
      const message_id = `${invitation_id}@liwan`
      const res = await o.mail.send({ to: q.rows[0].admin_login, ...mail, message_id })
      const status = o.smtpHost && isLocalCapture(o.smtpHost) ? 'local_capture' : 'sent'
      await pool.query(`UPDATE admin_invitations SET delivery_status=$2, sent_at=now(), message_id=$3 WHERE id=$1`, [invitation_id, status, res.provider_message_id])
      await pool.query(`UPDATE commercial_outbox SET payload = payload - 'token' WHERE id=$1`, [row.id])
      await completeOutbox(pool, row.id); sent++
    } catch (e) {
      await pool.query(`UPDATE admin_invitations SET delivery_status='failed' WHERE id=$1`, [invitation_id])
      await pool.query(`UPDATE commercial_outbox SET payload = payload - 'token' WHERE id=$1`, [row.id])
      await failOutbox(pool, row.id, e instanceof Error ? e.message.slice(0, 200) : 'send_failed'); failed++
    }
  }
  return { sent, failed }
}

/** Read-only: true only when acceptInvitation's consume condition would match (unconsumed, not revoked, not expired). Malformed tokens are simply not usable. */
export async function isInvitationUsable(pool: Pool, token: unknown): Promise<boolean> {
  if (typeof token !== 'string' || token.length < 20 || token.length > MAX_TOKEN_LENGTH) return false
  const r = await pool.query(
    `SELECT 1 FROM admin_invitations WHERE token_hash=$1 AND consumed_at IS NULL AND revoked_at IS NULL AND expires_at > now()`, [hashToken(token)])
  return r.rows.length > 0
}

export async function acceptInvitation(pool: Pool, a: { token: string; password: string; setPassword?: SetPassword }) {
  if (typeof a.token !== 'string' || a.token.length < 20 || typeof a.password !== 'string' || a.password.length < MIN_PASSWORD_LENGTH || a.token.length > MAX_TOKEN_LENGTH) throw new InvitationError('invalid')
  if (a.password.length > MAX_PASSWORD_LENGTH) throw new InvitationError('password_policy')
  const c = await pool.connect()
  try {
    await c.query('BEGIN')
    // A concurrent accept of the same token holds the row while its setter runs; do not queue behind it indefinitely.
    await c.query("SET LOCAL lock_timeout = '5s'")
    const r = await c.query(
      `UPDATE admin_invitations SET consumed_at=now() WHERE token_hash=$1 AND consumed_at IS NULL AND revoked_at IS NULL AND expires_at > now()
       RETURNING tenant_id, admin_login, customer_id`, [hashToken(a.token)])
    if (!r.rows[0]) { await c.query('ROLLBACK'); throw new InvitationError('invalid') }
    // Failure here rolls back the consume, so the invitation stays usable; the password is never stored.
    await (a.setPassword ?? unimplementedSetPassword)({ tenant_id: r.rows[0].tenant_id, admin_login: r.rows[0].admin_login, password: a.password, token: a.token })
    await c.query('COMMIT')
    return { tenant_id: r.rows[0].tenant_id as string, admin_login: r.rows[0].admin_login as string }
  } catch (e) {
    await c.query('ROLLBACK').catch(() => {})
    if ((e as { code?: string }).code === '55P03') throw new InvitationError('busy')
    throw e
  } finally { c.release() }
}
