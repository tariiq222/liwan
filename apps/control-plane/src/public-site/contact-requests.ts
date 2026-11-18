import { randomUUID } from 'node:crypto'
import type { Pool } from 'pg'
import type { ZodError } from 'zod'
import type { PublicContact } from '@liwan/commercial-contracts'
import type { MailAdapter } from '../commercial/mail-adapter.js'
import { settleFailedInvitationOutbox } from '../commercial/invitations.js'
import { claimOutbox, completeOutbox, enqueueOutbox, releaseOutbox } from '../commercial/outbox.js'
import { transaction } from '../db.js'

/** Kind of the outbox row that tells the owner about one stored request; it carries the request id, never the person's data. */
export const CONTACT_NOTICE_KIND = 'contact.notice'
/** A request is deleted after this long (site contract 4.5; the lawyer confirms the period). */
export const CONTACT_RETENTION_MONTHS = 12

/** The code the site shows its own message for. Only the first problem is named, and never its value. */
export function contactRefusalCode(error: ZodError): string {
  switch (error.issues[0]?.path[0]) {
    case 'email': return 'invalid_email'
    case 'mobile': return 'invalid_mobile'
    case 'consent': return 'consent_required'
    case 'turnstile_token': return 'turnstile_required'
    default: return 'validation_failed'
  }
}

const UTM_KEYS = ['utm_source', 'utm_medium', 'utm_campaign', 'utm_term', 'utm_content'] as const

/** Stores the request and queues the owner's notice in one transaction, so a stored request is never left unannounced. */
export async function storeContactRequest(pool: Pool, input: PublicContact): Promise<string> {
  const id = randomUUID()
  const utm = Object.fromEntries(UTM_KEYS.flatMap(key => input[key] ? [[key, input[key]]] : []))
  await transaction(pool, async client => {
    await client.query(`INSERT INTO public_contact_requests(id,name,email,company,mobile,users,message,lang,utm) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9)`,
      [id, input.name, input.email, input.company ?? null, input.mobile ?? null, input.users ?? null, input.message, input.lang, JSON.stringify(utm)])
    await enqueueOutbox(client, { kind: CONTACT_NOTICE_KIND, aggregate_id: id, dedupe_key: id, payload: { request_id: id } })
  })
  return id
}

type Row = { name: string; email: string; company: string | null; mobile: string | null; users: number | null; message: string; lang: string; utm: Record<string, string> }
const oneLine = (text: string) => text.replace(/[\u0000-\u001f\u007f\u2028\u2029]+/g, ' ').trim()

/** The owner's mail. Replies go by WhatsApp or phone (the site contract), so every field is listed plainly. */
export function contactNoticeMail(row: Row): { subject: string; text: string } {
  const details = [`الاسم: ${oneLine(row.name)}`, `البريد: ${row.email}`, row.company ? `الشركة: ${oneLine(row.company)}` : '', row.mobile ? `الجوال: ${row.mobile}` : '',
    row.users ? `عدد المستخدمين: ${row.users}` : '', `اللغة: ${row.lang}`, ...Object.entries(row.utm).map(([key, value]) => `${key}: ${oneLine(value)}`)].filter(Boolean)
  return { subject: `طلب تواصل جديد من الموقع | ${oneLine(row.name)}`, text: `${details.join('\n')}\n\n${row.message}` }
}

/** Sends the queued notices to the owner address, retrying with the outbox backoff. A request deleted meanwhile closes its notice. */
export async function sendContactNotices(pool: Pool, o: { mail: MailAdapter; to: string; signal?: AbortSignal; log?: (message: string, error?: unknown) => void }): Promise<number> {
  let sent = 0
  for (const row of await claimOutbox(pool, [CONTACT_NOTICE_KIND], 20)) {
    if (o.signal?.aborted) { await releaseOutbox(pool, row.id); continue }
    try {
      const request = (await pool.query<Row>(`SELECT name,email,company,mobile,users,message,lang,utm FROM public_contact_requests WHERE id=$1`, [(row.payload as { request_id: string }).request_id])).rows[0]
      if (request) {
        const notice = contactNoticeMail(request)
        const result = await o.mail.send({ to: o.to, subject: notice.subject, text: notice.text, message_id: `contact-${row.id}@liwan` })
        if (!result.accepted) throw new Error('contact_notice_not_accepted')
        sent++
      }
      await completeOutbox(pool, row.id)
    } catch (e) {
      o.log?.(`contact notice ${row.id} failed (attempt ${row.attempts + 1})`, e)
      await settleFailedInvitationOutbox(pool, row, e, 'contact_notice_failed')
    }
  }
  return sent
}

/** Deletes requests past retention, and returns how many went. */
export async function purgeContactRequests(pool: Pick<Pool, 'query'>, now = new Date()): Promise<number> {
  const result = await pool.query(`DELETE FROM public_contact_requests WHERE created_at < $1::timestamptz - make_interval(months => $2)`, [now, CONTACT_RETENTION_MONTHS])
  return result.rowCount ?? 0
}
