import { randomUUID } from 'node:crypto'
import type { Pool, PoolClient } from 'pg'
import { enqueueOutbox, claimOutbox, deferOutbox, failOutbox, releaseOutbox, type OutboxRow } from './outbox.js'
import type { ReturnOrigin } from './return-origin.js'
import { buildInvitationUrl, createInvitationToken, hashToken, invitationExpiry, renderInvitationEmail } from './invitation-tokens.js'
import { isLocalCapture, type MailAdapter } from './mail-adapter.js'

export const INVITATION_KIND = 'invitation.send'
/** How long a new invitation link works, for the first issue and the vendor's resend. */
export const DEFAULT_INVITATION_TTL_SECONDS = 72 * 3600
/** A handoff link is a short-lived one-time secret shown through the signup status endpoint, never emailed. */
export const HANDOFF_INVITATION_TTL_SECONDS = 15 * 60
export const MIN_PASSWORD_LENGTH = 12
/** Same maxima as the internal effect protocol, enforced before the token is consumed. */
export const MAX_PASSWORD_LENGTH = 256
export const MAX_TOKEN_LENGTH = 200
/** An invitation that cannot be issued or sent is retried with the outbox backoff (1, 2, 4, 8 minutes); the fifth failure is final and shows as `failed`. */
export const INVITATION_MAX_ATTEMPTS = 5

const failureText = (error: unknown, fallback: string) => error instanceof Error ? error.message.slice(0, 200) : fallback
const lastAttempt = (row: Pick<OutboxRow, 'attempts'>) => row.attempts + 1 >= INVITATION_MAX_ATTEMPTS

/** Backs a failed invitation row off for another try, or fails it for good on its last allowed attempt. Returns true when it failed for good. */
export async function settleFailedInvitationOutbox(pool: Pool, row: Pick<OutboxRow, 'id' | 'attempts'>, error: unknown, fallback: string): Promise<boolean> {
  if (lastAttempt(row)) { await failOutbox(pool, row.id, failureText(error, fallback)); return true }
  await deferOutbox(pool, row.id, failureText(error, fallback))
  return false
}

/** Closes an invitation outbox row and removes the raw token from its payload. */
const DONE_WITHOUT_TOKEN = `status='done', processed_at=now(), payload = payload - 'token'`
const RECORD_DELIVERY_ATTEMPTS = 3

/** One statement records the delivery on the invitation and closes its outbox row, so the two cannot disagree.
 *  Retried in place, because the mail has already gone out and sending again would deliver it twice;
 *  only if every attempt fails does the row stay leased and get claimed again. */
async function recordDelivery(pool: Pool, outboxId: string, invitationId: string, delivery: { status: string; provider_message_id: string }) {
  for (let attempt = 1; ; attempt++) {
    try {
      await pool.query(
        `WITH delivered AS (UPDATE admin_invitations SET delivery_status=$3, sent_at=now(), message_id=$4 WHERE id=$2)
         UPDATE commercial_outbox SET ${DONE_WITHOUT_TOKEN} WHERE id=$1 AND status='pending'`,
        [outboxId, invitationId, delivery.status, delivery.provider_message_id])
      return
    } catch (e) { if (attempt >= RECORD_DELIVERY_ATTEMPTS) throw e }
  }
}

/** Sets the tenant admin's own Odoo password. Without a configured adapter the default refuses,
 *  so acceptance never fakes success. */
export type SetPassword = (input: { tenant_id: string; admin_login: string; password: string; token: string }) => Promise<number | void>
export const unimplementedSetPassword: SetPassword = async () => { throw new InvitationError('password_setter_unavailable') }

export class InvitationError extends Error { constructor(public code: string) { super(code) } }

/** Who asked for an invitation and why; recorded in the audit log in the same transaction as the invitation. */
export type InvitationAudit = { actor: string; reason: string; metadata: Record<string, unknown> }

type InvitationRequest = { customer_id: string; tenant_id: string; admin_login: string; ttl_seconds: number; delivery?: 'email' | 'handoff'; audit?: InvitationAudit }

/** One lock per tenant serializes every issue, so the vendor's resend, the first issue and the founder's handoff
 *  cannot interleave and a count read under the lock is still true when the insert commits. Held to commit. */
const lockTenantInvitations = (c: PoolClient, tenant_id: string) => c.query(`SELECT pg_advisory_xact_lock(hashtextextended('invitation:' || $1::text, 0))`, [tenant_id])

/** Runs `work` in one transaction that holds the tenant's invitation lock. */
export async function withTenantInvitationLock<T>(pool: Pool, tenant_id: string, work: (c: PoolClient) => Promise<T>): Promise<T> {
  const c = await pool.connect()
  try {
    await c.query('BEGIN')
    await lockTenantInvitations(c, tenant_id)
    const result = await work(c)
    await c.query('COMMIT')
    return result
  } catch (e) { await c.query('ROLLBACK').catch(() => {}); throw e } finally { c.release() }
}

/** Inside the caller's transaction (which holds the tenant lock): revokes the earlier links and records the new one.
 *  Rows are never returned with token material; the raw token only leaves via the outbox payload→email, or directly to
 *  the caller for a handoff invitation. */
async function insertInvitation(c: PoolClient, i: InvitationRequest) {
  const delivery = i.delivery ?? 'email'
  // An accepted invitation never issues another to the same address: the link would set the manager's password again.
  if ((await c.query('SELECT 1 FROM admin_invitations WHERE tenant_id=$1 AND admin_login=$2 AND consumed_at IS NOT NULL LIMIT 1', [i.tenant_id, i.admin_login])).rowCount) throw new InvitationError('accepted')
  const { token, token_hash } = createInvitationToken()
  const expires = invitationExpiry(i.ttl_seconds)
  await c.query(`UPDATE admin_invitations SET revoked_at=now() WHERE tenant_id=$1 AND admin_login=$2 AND consumed_at IS NULL AND revoked_at IS NULL`, [i.tenant_id, i.admin_login])
  const id = randomUUID()
  await c.query(`INSERT INTO admin_invitations(id,customer_id,tenant_id,admin_login,token_hash,expires_at,delivery_status) VALUES($1,$2,$3,$4,$5,$6,$7)`,
    [id, i.customer_id, i.tenant_id, i.admin_login, token_hash, expires, delivery === 'handoff' ? 'handoff' : 'queued'])
  // An emailed invitation sends its token through the outbox; a handoff invitation never queues one and the caller
  // returns the raw token once. Only the hash is stored either way.
  if (delivery === 'email') {
    await enqueueOutbox(c, { kind: INVITATION_KIND, aggregate_id: id, dedupe_key: id, payload: { invitation_id: id, token } })
  }
  if (i.audit) {
    await c.query('INSERT INTO audit_events(id,actor,action,subject,reason,metadata) VALUES($1,$2,$3,$4,$5,$6)',
      [randomUUID(), i.audit.actor, 'invitation.reissued', id, i.audit.reason,
        JSON.stringify({ ...i.audit.metadata, tenant_id: i.tenant_id, customer_id: i.customer_id, expires_at: expires.toISOString() })])
  }
  return { id, expires_at: expires, token: delivery === 'handoff' ? token : undefined }
}

/** The one place a new invitation is issued for the vendor and the first issue: under the tenant lock. */
export const issueInvitation = (pool: Pool, i: InvitationRequest) => withTenantInvitationLock(pool, i.tenant_id, c => insertInvitation(c, i))

/** The self-signup handoff link for the founder of `customer_id`, delivered through the signup status endpoint instead
 *  of an email. Runs under the tenant lock, revokes every earlier live invitation of the founder in the same
 *  transaction, and stores only the token hash: the raw token is returned once, never logged. Refreshing the waiting
 *  page issues again, so only the newest link ever works. */
export async function issueHandoffInvitation(pool: Pool, customer_id: string): Promise<{ token: string; expiresAt: Date }> {
  const row = (await pool.query('SELECT tenant_id, admin_login FROM customers WHERE id=$1', [customer_id])).rows[0] as
    { tenant_id: string; admin_login: string } | undefined
  if (!row?.tenant_id || !row.admin_login) throw new InvitationError('invalid')
  return withTenantInvitationLock(pool, row.tenant_id, async c => {
    const issued = await insertInvitation(c, { customer_id, tenant_id: row.tenant_id, admin_login: row.admin_login, ttl_seconds: HANDOFF_INVITATION_TTL_SECONDS, delivery: 'handoff' })
    if (typeof issued.token !== 'string') throw new Error('handoff_token_missing')
    return { token: issued.token, expiresAt: issued.expires_at }
  })
}

/** Readiness rule: call only once the subscription's first fulfillment is applied. */
export async function onSubscriptionActivated(pool: Pool, subscription_id: string, opts: { ttl_seconds?: number } = {}) {
  const r = await pool.query(
    `SELECT s.customer_id, s.tenant_id, s.applied_revision_id, c.admin_login FROM subscriptions s JOIN customers c ON c.id=s.customer_id WHERE s.id=$1`, [subscription_id])
  const s = r.rows[0]
  if (!s || !s.tenant_id || !s.applied_revision_id || !s.admin_login) return null
  const existing = await pool.query(`SELECT 1 FROM admin_invitations WHERE tenant_id=$1 AND admin_login=$2`, [s.tenant_id, s.admin_login])
  if (existing.rowCount) return null // already invited; resend is an explicit vendor action
  return issueInvitation(pool, { customer_id: s.customer_id, tenant_id: s.tenant_id, admin_login: s.admin_login, ttl_seconds: opts.ttl_seconds ?? DEFAULT_INVITATION_TTL_SECONDS })
}

/** `signal` is the worker shutdown: the message in flight finishes, every other claimed row gives its lease back untouched.
 *  `failed` counts invitations that failed for good; a failed attempt with retries left is only logged. */
export async function sendInvitationOutbox(pool: Pool, o: { mail: MailAdapter; returnOrigin: ReturnOrigin; smtpHost?: string; limit?: number; signal?: AbortSignal; log?: (message: string, error?: unknown) => void }) {
  let sent = 0, failed = 0
  for (const row of await claimOutbox(pool, [INVITATION_KIND], o.limit ?? 20)) {
    if (o.signal?.aborted) { await releaseOutbox(pool, row.id); continue }
    const { invitation_id, token } = row.payload as { invitation_id: string; token?: string }
    let delivery: { status: string; provider_message_id: string }
    try {
      const q = await pool.query(
        `SELECT i.admin_login, i.customer_id, c.name FROM admin_invitations i JOIN customers c ON c.id=i.customer_id
         WHERE i.id=$1 AND i.consumed_at IS NULL AND i.revoked_at IS NULL AND i.expires_at > now()`, [invitation_id])
      if (!q.rows[0] || !token) { await pool.query(`UPDATE commercial_outbox SET ${DONE_WITHOUT_TOKEN} WHERE id=$1 AND status='pending'`, [row.id]); continue } // superseded/expired: nothing to send
      const origin = await o.returnOrigin(q.rows[0].customer_id)
      const mail = renderInvitationEmail({ companyName: q.rows[0].name, url: buildInvitationUrl(origin, token), origin })
      const message_id = `${invitation_id}@liwan`
      const res = await o.mail.send({ to: q.rows[0].admin_login, ...mail, message_id })
      delivery = { status: o.smtpHost && isLocalCapture(o.smtpHost) ? 'local_capture' : 'sent', provider_message_id: res.provider_message_id }
    } catch (e) {
      // The raw token stays in the outbox payload while retries remain (it is what the next attempt mails); the final failure scrubs it.
      o.log?.(`invitation ${invitation_id} send failed (attempt ${row.attempts + 1} of ${INVITATION_MAX_ATTEMPTS})`, e)
      if (lastAttempt(row)) {
        await pool.query(`UPDATE admin_invitations SET delivery_status='failed' WHERE id=$1`, [invitation_id])
        await pool.query(`UPDATE commercial_outbox SET payload = payload - 'token' WHERE id=$1`, [row.id])
      }
      if (await settleFailedInvitationOutbox(pool, row, e, 'send_failed')) failed++
      continue
    }
    // The mail is out: a recording failure must never count as a failed send or mark a delivered mail `failed`.
    try { await recordDelivery(pool, row.id, invitation_id, delivery); sent++ }
    catch (e) { o.log?.(`invitation ${invitation_id} was sent but its delivery could not be recorded`, e) }
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

/** Consumes the invitation for the workspace `tenant_id` names: a valid token bound to another workspace is the same
 *  generic `invalid` as a wrong or expired token, so the answer never distinguishes the two. */
export async function acceptInvitation(pool: Pool, a: { token: string; password: string; tenant_id: string; setPassword?: SetPassword }) {
  if (typeof a.token !== 'string' || a.token.length < 20 || typeof a.password !== 'string' || a.password.length < MIN_PASSWORD_LENGTH || a.token.length > MAX_TOKEN_LENGTH) throw new InvitationError('invalid')
  if (a.password.length > MAX_PASSWORD_LENGTH) throw new InvitationError('password_policy')
  const c = await pool.connect()
  try {
    await c.query('BEGIN')
    // A concurrent accept of the same token holds the row while its setter runs; do not queue behind it indefinitely.
    await c.query("SET LOCAL lock_timeout = '5s'")
    const r = await c.query(
      `UPDATE admin_invitations SET consumed_at=now() WHERE token_hash=$1 AND tenant_id=$2 AND consumed_at IS NULL AND revoked_at IS NULL AND expires_at > now()
       RETURNING tenant_id, admin_login, customer_id`, [hashToken(a.token), a.tenant_id])
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
