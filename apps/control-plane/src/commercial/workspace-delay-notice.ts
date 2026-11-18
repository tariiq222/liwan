import type { Pool } from 'pg'
import type { MailAdapter } from './mail-adapter.js'
import { completeOutbox, enqueueOutbox, failOutbox, leaseOutboxRow, releaseOutbox } from './outbox.js'
import { logText } from '../log-text.js'

/** A first workspace not delivered this long after sign-up is late: the customer is told once, and the trial clock starts at the administrator's first sign-in. */
export const WORKSPACE_DELAY_MINUTES = 10
export const WORKSPACE_DELAY_MS = WORKSPACE_DELAY_MINUTES * 60_000
/** The resolution window the delay notice promises; the vendor sees the same order as a stalled activation in attention. */
export const WORKSPACE_RESOLUTION_WINDOW = { ar: 'خلال يوم عمل', en: 'within one business day' } as const

/**
 * One email per customer when the first workspace is still not delivered WORKSPACE_DELAY_MINUTES after sign-up. A terminal provisioning failure is covered by the same row (it does not depend on the order state). Recovery retries
 * stay silent; the invitation itself goes out as usual once the workspace is delivered. A row that failed or was interrupted is
 * retried on the next run, a completed row is never sent again, and a row is sent by the one worker that leases it.
 */
export async function sendWorkspaceDelayNotices(pool: Pool, input: { now: Date; mail: MailAdapter; signal?: AbortSignal }): Promise<number> {
  const late = (await pool.query(`SELECT c.id AS customer_id,c.admin_login FROM orders o
    JOIN subscriptions s ON s.id=o.subscription_id JOIN customers c ON c.id=o.customer_id
    WHERE o.kind='new' AND o.payment_state='not_required' AND NOT o.cancelled AND s.applied_revision_id IS NULL
      AND c.admin_login IS NOT NULL AND o.created_at <= $1::timestamptz - make_interval(mins => $2::int) ORDER BY o.created_at,o.id`,
  [input.now, WORKSPACE_DELAY_MINUTES])).rows
  let sent = 0
  for (const row of late) {
    if (input.signal?.aborted) return sent
    try { sent += await noticeOf(pool, row, input) }
    catch (error) { console.error('[workspace-delay-notice] customer %s skipped: %s', row.customer_id, logText(error instanceof Error ? error : 'error')) }
  }
  return sent
}

async function noticeOf(pool: Pool, row: { customer_id: string; admin_login: string }, input: { mail: MailAdapter; signal?: AbortSignal }): Promise<number> {
  const dedupe = `workspace-delay:${row.customer_id}`
  const inserted = await enqueueOutbox(pool, { kind: 'workspace.delay_notice', aggregate_id: row.customer_id, dedupe_key: dedupe, payload: { customer_id: row.customer_id } })
  const existing = (await pool.query("SELECT id,status FROM commercial_outbox WHERE kind='workspace.delay_notice' AND aggregate_id=$1 AND dedupe_key=$2", [row.customer_id, dedupe])).rows[0]
  if (!inserted && (!existing || !['failed', 'pending'].includes(existing.status))) return 0
  if (!inserted && existing.status === 'failed') await pool.query("UPDATE commercial_outbox SET status='pending',processed_at=NULL,payload=payload-'error',next_attempt_at=now() WHERE id=$1 AND status='failed'", [existing.id])
  const leaseUntil = await leaseOutboxRow(pool, existing.id)
  if (!leaseUntil) return 0
  if (input.signal?.aborted) { await releaseOutbox(pool, existing.id, leaseUntil); return 0 }
  const ar = `مساحة عملك في LiwanOS تستغرق وقتًا أطول من المتوقع. نُبِّه فريقنا وهو يعمل عليها الآن، ونتوقع حل المشكلة ${WORKSPACE_RESOLUTION_WINDOW.ar}. لا تحتاج إلى أي إجراء منك. سنرسل لك دعوة الدخول على هذا البريد بمجرد جاهزيتها، وتبدأ مدة التجربة عند أول دخول لك إلى المساحة.`
  const en = `Your LiwanOS workspace is taking longer than expected to set up. Our team has been alerted and is working on it, and we expect it to be resolved ${WORKSPACE_RESOLUTION_WINDOW.en}. You do not need to do anything. We will send the sign-in invitation to this address as soon as it is ready, and your trial starts when you first sign in to it.`
  try {
    await input.mail.send({ to: row.admin_login, subject: 'مساحة عملك في LiwanOS تستغرق وقتًا أطول من المتوقع', text: `${ar}\n\n${en}`, message_id: `workspace-delay-${row.customer_id}@liwan` })
    await completeOutbox(pool, existing.id)
  } catch (error) {
    await failOutbox(pool, existing.id, error instanceof Error ? error.message.slice(0, 200) : 'workspace_delay_notice_failed')
    return 0
  }
  return 1
}
