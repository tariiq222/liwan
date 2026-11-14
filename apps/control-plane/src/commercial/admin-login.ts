import { randomUUID } from 'node:crypto'
import { z } from 'zod'
import type { Pool } from 'pg'
import { CommercialHttpError } from './lifecycle.js'
import { enqueueOutbox, leaseOutboxRow, completeOutbox, deferOutbox } from './outbox.js'
import { withTenantInvitationLock } from './invitations.js'
import { invalidateDeletionCode } from './tenant-deletion.js'
import { workspaceLines, workspaceOrigin, type ReturnOrigin } from './return-origin.js'
import type { MailAdapter } from './mail-adapter.js'

export const ADMIN_LOGIN_NOTICE_KIND = 'admin_login.notice'
/** The same address rule the vendor's customer creation uses (the vendor, unlike public sign-up, is trusted with any valid address).
 *  `dry_run` only reports what the change would meet, so the console can warn before the vendor confirms; it needs no reason and writes nothing. */
export const adminLoginChangeSchema = z.strictObject({ admin_login: z.email().max(100), reason: z.string().trim().min(3).max(1000).optional(), dry_run: z.boolean().optional() })
  .refine(body => body.dry_run === true || body.reason !== undefined, { path: ['reason'] })
export const ADMIN_LOGIN_CHANGED_ACTION = 'customer.admin_login_changed'

type NoticePayload = { customer_id: string; role: 'previous' | 'new'; to: string; previous: string; current: string }

export type AdminLoginChange = { customer_id: string; admin_login: string; reason: string; actor: string; client_address: string | null }
export type AdminLoginChangeResult = { admin_login: string; previous_admin_login: string | null; deletion_code_invalidated: boolean }
/** What a change would meet: how many OTHER customers already hold the address (nothing prevents it, but "find my workspace" then lists them all to that mailbox). */
export type AdminLoginPreview = { other_customers_with_address: number }

const activated = async (c: Pick<Pool, 'query'>, tenantId: string) =>
  (await c.query('SELECT EXISTS (SELECT 1 FROM admin_invitations WHERE tenant_id=$1 AND consumed_at IS NOT NULL) AS activated', [tenantId])).rows[0].activated === true

/** The workspace of a customer that can have its address changed: it exists and a manager has accepted an invitation. Until then the
 *  address was fixed at provisioning (the first Odoo manager carries it), so a new address could never accept an invitation and the change is refused. */
async function changeableTenant(pool: Pick<Pool, 'query'>, customerId: string): Promise<string> {
  const found = (await pool.query('SELECT tenant_id FROM customers WHERE id=$1', [customerId])).rows[0]
  if (!found) throw new CommercialHttpError('not_found', 404)
  if (!found.tenant_id) throw new CommercialHttpError('no_workspace', 409)
  if (!await activated(pool, found.tenant_id)) throw new CommercialHttpError('workspace_not_activated', 409)
  return found.tenant_id
}

export async function previewAdminLogin(pool: Pool, customerId: string, admin_login: string): Promise<AdminLoginPreview> {
  await changeableTenant(pool, customerId)
  const others = (await pool.query('SELECT count(*)::int AS n FROM customers WHERE id<>$1 AND lower(admin_login)=$2', [customerId, admin_login.trim().toLowerCase()])).rows[0].n
  return { other_customers_with_address: others }
}

/**
 * Changes the address that receives every control-plane mail for the customer's activated workspace (billing, trial, cancellation and
 * deletion notices, the manager's own invitation requests), under the tenant's invitation lock so it cannot interleave with an issue or a
 * self re-issue. It never touches the workspace itself: no Odoo user, password or login changes, so the new person must already hold an
 * account there. A workspace nobody has activated is refused (`workspace_not_activated`), nothing written.
 *
 * Mail that is queued but not yet sent reads the address when it is sent, so it follows the change; a deletion code already mailed to
 * the old address is killed; every unused invitation to the old address is revoked. Both addresses are told.
 */
export async function changeAdminLogin(pool: Pool, input: AdminLoginChange): Promise<AdminLoginChangeResult> {
  const tenantId = await changeableTenant(pool, input.customer_id)
  const next = input.admin_login.trim().toLowerCase()
  return withTenantInvitationLock(pool, tenantId, async c => {
    const customer = (await c.query('SELECT name,admin_login FROM customers WHERE id=$1 FOR UPDATE', [input.customer_id])).rows[0]
    const previous: string | null = customer.admin_login
    if (previous?.toLowerCase() === next) throw new CommercialHttpError('admin_login_unchanged', 409)
    await c.query('UPDATE customers SET admin_login=$2 WHERE id=$1', [input.customer_id, next])
    if (previous) await c.query('UPDATE admin_invitations SET revoked_at=now() WHERE tenant_id=$1 AND admin_login=$2 AND consumed_at IS NULL AND revoked_at IS NULL', [tenantId, previous])
    const deletionCodeInvalidated = await invalidateDeletionCode(c, { actor: input.actor, client_address: input.client_address }, input.customer_id, input.reason)
    await c.query('INSERT INTO audit_events(id,actor,action,subject,reason,metadata) VALUES($1,$2,$3,$4,$5,$6)',
      [randomUUID(), input.actor, ADMIN_LOGIN_CHANGED_ACTION, input.customer_id, input.reason, JSON.stringify({
        previous_admin_login: previous, admin_login: next, tenant_id: tenantId, deletion_code_invalidated: deletionCodeInvalidated, client_address: input.client_address })])
    const change = randomUUID()
    for (const [role, to] of [['previous', previous], ['new', next]] as const) {
      if (!to) continue
      await enqueueOutbox(c, { kind: ADMIN_LOGIN_NOTICE_KIND, aggregate_id: input.customer_id, dedupe_key: `${change}:${role}`,
        payload: { customer_id: input.customer_id, role, to, previous: previous ?? '', current: next } satisfies NoticePayload })
    }
    return { admin_login: next, previous_admin_login: previous, deletion_code_invalidated: deletionCodeInvalidated }
  })
}

/** The subject and body (Arabic, then English) of the notice to the previous or the new address. It carries no link that acts. */
export function adminLoginNotice(payload: NoticePayload, companyName: string, origin: string | null): { subject: string; text: string } {
  const workspace = workspaceLines(origin)
  const previous = payload.previous || '-'
  const [ar, en] = payload.role === 'previous'
    ? [`تغيّر العنوان الذي يستقبل إشعارات حساب LiwanOS لشركة ${companyName}. كان العنوان ${payload.previous} وصار ${payload.current}، ولن تصلك هذه الإشعارات بعد الآن. إن لم تكن تتوقع هذا التغيير فراسلنا فورًا.`,
      `The address that receives LiwanOS account notices for ${companyName} was changed from ${payload.previous} to ${payload.current}, so you will no longer receive them. If you did not expect this change, write to us right away.`]
    : [`صار هذا العنوان هو الذي يستقبل إشعارات حساب LiwanOS لشركة ${companyName} (الإشعارات، وفواتير الاشتراك، ورمز تأكيد حذف مساحة العمل). كان العنوان السابق ${previous}. إن لم تكن تتوقع هذا فراسلنا.`,
      `This address now receives LiwanOS account notices for ${companyName} (notices, subscription billing and the workspace deletion code). The previous address was ${previous}. If you did not expect this, write to us.`]
  return { subject: 'تغيّر عنوان إشعارات حساب LiwanOS | The address for your LiwanOS account notices changed', text: `${ar}${workspace.ar}\n${en}${workspace.en}` }
}

/** Sends every queued change notice, each once: leased so two workers send it once, deferred with a backoff when the send fails. */
export async function sendAdminLoginNotices(pool: Pool, input: { mail: MailAdapter; returnOrigin?: ReturnOrigin; signal?: AbortSignal }): Promise<number> {
  const rows = (await pool.query(`SELECT o.id,o.payload,c.name FROM commercial_outbox o JOIN customers c ON c.id::text=o.aggregate_id
    WHERE o.kind=$1 AND o.status='pending' AND o.next_attempt_at <= now() ORDER BY o.created_at,o.id LIMIT 50`, [ADMIN_LOGIN_NOTICE_KIND])).rows as { id: string; payload: NoticePayload; name: string }[]
  let sent = 0
  for (const row of rows) {
    if (input.signal?.aborted) return sent
    if (!await leaseOutboxRow(pool, row.id)) continue
    try {
      const notice = adminLoginNotice(row.payload, row.name, await workspaceOrigin(input.returnOrigin, row.payload.customer_id))
      await input.mail.send({ to: row.payload.to, subject: notice.subject, text: notice.text, message_id: `admin-login-${row.id}@liwan` })
      await completeOutbox(pool, row.id)
      sent++
    } catch (error) { await deferOutbox(pool, row.id, error instanceof Error ? error.message.slice(0, 200) : 'admin_login_notice_failed') }
  }
  return sent
}
