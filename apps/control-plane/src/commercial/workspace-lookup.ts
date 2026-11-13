import { createHmac, randomUUID } from 'node:crypto'
import type { Pool } from 'pg'
import { enqueueOutbox, claimOutbox, completeOutbox, deferOutbox, leaseOutboxRow, releaseOutbox } from './outbox.js'
import { INVITATION_MAX_ATTEMPTS, settleFailedInvitationOutbox } from './invitations.js'
import type { MailAdapter } from './mail-adapter.js'
import type { ReturnOrigin } from './return-origin.js'

/** Kind of the queued "find my workspace" requests; the scheduler turns each into the lookup. */
export const WORKSPACE_LOOKUP_KIND = 'workspace.lookup'
/** Kind of the mail the lookup decided to send; it carries workspace ids, never the typed address. */
export const WORKSPACE_LOOKUP_NOTICE_KIND = 'workspace.lookup.notice'
export const WORKSPACE_LOOKUP_ACTOR = 'customer:workspace_lookup'
export const WORKSPACE_LOOKUP_ACTION = 'workspace.lookup.mailed'
/** At most one mail per cooldown and `WORKSPACE_LOOKUP_HOURLY_LIMIT` per hour to one address on record, so the route cannot mail-bomb it. */
export const WORKSPACE_LOOKUP_COOLDOWN_SECONDS = 60
export const WORKSPACE_LOOKUP_HOURLY_LIMIT = 3
/** The platform-wide ceiling of lookup mails in 24 hours: the last-resort cost cap, like sign-up's daily limit. */
export const WORKSPACE_LOOKUP_DAILY_LIMIT = 200
/** One lock for every decision, so parallel requests (the same address or many) cannot all pass a count read under it. */
const DECISION_LOCK = 'workspace-lookup'

/** Keyed hash of a normalised address: what a notice row keeps to prove at send time that a customer is still on the address the
 *  lookup matched. The address itself is never stored in the row. */
export const addressHash = (key: string, address: string) => createHmac('sha256', key).update(`workspace-lookup\n${address.trim().toLowerCase()}`).digest('hex')

/** Records a request without looking at it: every valid request does exactly this, so the HTTP answer and its timing cannot
 *  tell an address on record from any other. The typed address is kept only until the worker has handled the row. */
export async function queueWorkspaceLookup(pool: Pool, i: { email: string; client_address: string }): Promise<void> {
  const id = randomUUID()
  await enqueueOutbox(pool, { kind: WORKSPACE_LOOKUP_KIND, aggregate_id: id, dedupe_key: id, payload: { email: i.email, client_address: i.client_address } })
}

/** Workspaces a manager may be told about: delivered (a first plan applied) and bound to an enabled host. A suspended
 *  subscription or a deletion request does not hide one: the manager must be able to reach it to pay or to withdraw. */
const MATCHES = `SELECT c.id, c.name FROM customers c
  JOIN shared_registry_bindings b ON b.control_tenant_id=c.tenant_id AND b.enabled
  JOIN subscriptions s ON s.customer_id=c.id AND s.applied_revision_id IS NOT NULL
  WHERE c.admin_login IS NOT NULL AND lower(c.admin_login)=$1 ORDER BY c.created_at, c.id`

/** Looks `email` up, decides whether a mail may go and, if so, records it and queues the notice, all in one transaction with the
 *  request row's completion. Returns whether a mail was queued. The address typed is removed from the row in the same statement. */
async function handleLookup(pool: Pool, row: { id: string }, email: string, key: string): Promise<boolean> {
  const c = await pool.connect()
  try {
    await c.query('BEGIN')
    await c.query(`SELECT pg_advisory_xact_lock(hashtextextended($1, 0))`, [DECISION_LOCK])
    const found = (await c.query(MATCHES, [email.trim().toLowerCase()])).rows as { id: string }[]
    let queued = false
    if (found.length) {
      const ids = found.map(r => r.id)
      const state = (await c.query(
        `SELECT count(DISTINCT metadata->>'mail_id') FILTER (WHERE subject = ANY($2::text[]) AND created_at > now() - interval '1 hour')::int AS recent,
                count(DISTINCT metadata->>'mail_id') FILTER (WHERE subject = ANY($2::text[]) AND created_at > now() - make_interval(secs => $3))::int AS cooling,
                count(DISTINCT metadata->>'mail_id')::int AS today
         FROM audit_events WHERE action=$1 AND created_at > now() - interval '24 hours'`, [WORKSPACE_LOOKUP_ACTION, ids, WORKSPACE_LOOKUP_COOLDOWN_SECONDS])).rows[0]
      if (state.recent < WORKSPACE_LOOKUP_HOURLY_LIMIT && state.cooling === 0 && state.today < WORKSPACE_LOOKUP_DAILY_LIMIT) {
        const mailId = randomUUID()
        for (const id of ids) {
          await c.query('INSERT INTO audit_events(id,actor,action,subject,reason,metadata) VALUES($1,$2,$3,$4,$5,$6)',
            [randomUUID(), WORKSPACE_LOOKUP_ACTOR, WORKSPACE_LOOKUP_ACTION, id, 'Manager asked for the workspace address', JSON.stringify({ mail_id: mailId })])
        }
        await enqueueOutbox(c, { kind: WORKSPACE_LOOKUP_NOTICE_KIND, aggregate_id: mailId, dedupe_key: mailId, payload: { customer_ids: ids, address_hash: addressHash(key, email) } })
        queued = true
      }
    }
    await c.query(`UPDATE commercial_outbox SET status='done', processed_at=now(), payload = payload - 'email' WHERE id=$1 AND status='pending'`, [row.id])
    await c.query('COMMIT')
    return queued
  } catch (e) { await c.query('ROLLBACK').catch(() => {}); throw e } finally { c.release() }
}

/** Worker side of `queueWorkspaceLookup`. Survives a process stop: an unfinished row is leased again and retried. The typed
 *  address is removed from the row as soon as it is handled, and from a row that fails for good. Returns the rows handled. */
export async function processWorkspaceLookups(pool: Pool, o: { key: string; limit?: number; signal?: AbortSignal; log?: (message: string, error?: unknown) => void }) {
  let handled = 0
  for (const row of await claimOutbox(pool, [WORKSPACE_LOOKUP_KIND], o.limit ?? 20)) {
    if (o.signal?.aborted) { await releaseOutbox(pool, row.id); continue }
    try {
      await handleLookup(pool, row, (row.payload as { email: string }).email, o.key)
      handled++
    } catch (e) {
      o.log?.(`workspace lookup ${row.id} failed (attempt ${row.attempts + 1} of ${INVITATION_MAX_ATTEMPTS})`, e)
      if (await settleFailedInvitationOutbox(pool, row, e, 'lookup_failed')) await pool.query(`UPDATE commercial_outbox SET payload = payload - 'email' WHERE id=$1`, [row.id])
    }
  }
  return handled
}

const oneLine = (text: string) => text.replace(/[\u0000-\u001f\u007f\u2028\u2029]+/g, ' ').trim()

/** The mail: Arabic, then English; the workspaces with their sign-in addresses. No token, and nobody is signed in by it. */
export function workspaceLookupMail(workspaces: { name: string; url: string }[]): { subject: string; text: string } {
  const list = workspaces.map(w => `- ${oneLine(w.name)}: ${w.url}`).join('\n')
  const ar = `طُلب العثور على مساحات العمل المرتبطة بهذا البريد في ليوان. مساحاتك:\n${list}\nإن لم تطلب ذلك فلا حاجة لأي إجراء. هذه الرسالة لا تحتوي رمز دخول ولا تسجّل أحدًا الدخول.`
  const en = `Someone asked for the LiwanOS workspaces linked to this address. Your workspaces:\n${list}\nIf you did not ask, nothing needs doing. This message contains no sign-in code and does not sign anyone in.`
  return { subject: 'عنوان مساحة العمل في LiwanOS | Your LiwanOS workspace address', text: `${ar}\n\n${en}` }
}

/** Sends each queued notice to the address on record, one mail listing every workspace of that address. The recipient and the
 *  workspaces are read again just before sending, so a workspace that was disabled meanwhile is left out. A row is leased so two
 *  workers send it once. */
export async function sendWorkspaceLookupNotices(pool: Pool, o: { key: string; mail: MailAdapter; returnOrigin: ReturnOrigin; limit?: number; signal?: AbortSignal; log?: (message: string, error?: unknown) => void }): Promise<number> {
  let sent = 0
  const rows = (await pool.query(`SELECT id, aggregate_id, attempts, payload FROM commercial_outbox WHERE kind=$1 AND status='pending' AND next_attempt_at <= now() ORDER BY created_at, id LIMIT $2`,
    [WORKSPACE_LOOKUP_NOTICE_KIND, o.limit ?? 20])).rows as { id: string; aggregate_id: string; attempts: number; payload: { customer_ids: string[]; address_hash: string } }[]
  const close = (id: string, reason: string) => pool.query(`UPDATE commercial_outbox SET status='done', processed_at=now(), payload = payload || jsonb_build_object('reason', $2::text) WHERE id=$1 AND status='pending'`, [id, reason])
  for (const row of rows) {
    if (o.signal?.aborted) return sent
    if (!await leaseOutboxRow(pool, row.id)) continue
    try {
      // The match is proven again now: only customers still on the matched address, with an enabled binding, are listed, and the mail goes to that address.
      const candidates = (await pool.query(
        `SELECT c.id, c.name, c.admin_login FROM customers c
         JOIN shared_registry_bindings b ON b.control_tenant_id=c.tenant_id AND b.enabled
         WHERE c.id = ANY($1::uuid[]) AND c.admin_login IS NOT NULL ORDER BY c.created_at, c.id`, [row.payload.customer_ids])).rows as { id: string; name: string; admin_login: string }[]
      const live = candidates.filter(c => addressHash(o.key, c.admin_login) === row.payload.address_hash)
      if (!live.length) { await close(row.id, 'address_changed'); continue }
      // Another mail to these workspaces since the match counts against the same limits.
      const others = (await pool.query(
        `SELECT count(DISTINCT metadata->>'mail_id') FILTER (WHERE created_at > now() - interval '1 hour')::int AS recent,
                count(DISTINCT metadata->>'mail_id') FILTER (WHERE created_at > now() - make_interval(secs => $4))::int AS cooling
         FROM audit_events WHERE action=$1 AND subject = ANY($2::text[]) AND metadata->>'mail_id' <> $3`,
        [WORKSPACE_LOOKUP_ACTION, live.map(c => c.id), row.aggregate_id, WORKSPACE_LOOKUP_COOLDOWN_SECONDS])).rows[0]
      if (others.recent >= WORKSPACE_LOOKUP_HOURLY_LIMIT || others.cooling > 0) { await close(row.id, 'limited'); continue }
      const workspaces = []
      for (const w of live) workspaces.push({ name: w.name, url: `${await o.returnOrigin(w.id)}/login` })
      const notice = workspaceLookupMail(workspaces)
      await o.mail.send({ to: live[0]!.admin_login, subject: notice.subject, text: notice.text, message_id: `workspace-lookup-${row.id}@liwan` })
      await completeOutbox(pool, row.id)
      sent++
    } catch (e) {
      o.log?.(`workspace lookup notice ${row.id} failed (attempt ${row.attempts + 1} of ${INVITATION_MAX_ATTEMPTS})`, e)
      await settleFailedInvitationOutbox(pool, row, e, 'lookup_notice_failed')
    }
  }
  return sent
}

/** The two halves in the order the scheduler runs them: decide the queued requests, then send what was decided. */
export async function runWorkspaceLookups(pool: Pool, o: { key: string; mail: MailAdapter; returnOrigin: ReturnOrigin; signal?: AbortSignal; log?: (message: string, error?: unknown) => void }) {
  const handled = await processWorkspaceLookups(pool, o)
  const sent = await sendWorkspaceLookupNotices(pool, o)
  return { handled, sent }
}
