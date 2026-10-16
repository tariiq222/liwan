import type { Pool } from 'pg'
import { AUDIT_PAGE_SIZE, type AuditEvent, type AuditList, type AuditListQuery, type AuditSubjectKind } from '@webvue/commercial-contracts'

// Read model of audit_events for the vendor console. Every filter is a bound parameter; the SQL text
// only ever names columns. Subjects are stored as plain strings (a record id or `account:<n>`), so the
// readable name of each one is resolved for the returned page only.
// The `from`/`to` days are calendar days in the business time zone, the one the console displays.
const BUSINESS_TIME_ZONE = 'Asia/Riyadh'
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/
const ACCOUNT = /^account:(\d{1,18})$/
const contains = (value: string) => `%${value.replace(/[\\%_]/g, '\\$&')}%`

// Accounts, customers, workspaces, plans and bundles whose name matches, expressed as the subject/actor strings they appear under.
// Account emails are never matched: vendor.audit.read does not grant reading vendor accounts.
const NAMED_SUBJECTS = `SELECT id::text FROM customers WHERE name ILIKE $N
  UNION SELECT id::text FROM tenants WHERE name ILIKE $N
  UNION SELECT id::text FROM plan_revisions WHERE name ILIKE $N
  UNION SELECT id::text FROM bundle_revisions WHERE name ILIKE $N
  UNION SELECT 'account:' || id FROM vendor_accounts WHERE display_name ILIKE $N`
const NAMED_ACCOUNTS = `SELECT 'account:' || id FROM vendor_accounts WHERE display_name ILIKE $N`
// A customer's records: itself, its workspace, subscriptions, orders and the shared jobs of its workspace.
const CUSTOMER_SUBJECTS = `SELECT $N::text
  UNION SELECT tenant_id::text FROM customers WHERE id = ($N::text)::uuid AND tenant_id IS NOT NULL
  UNION SELECT id::text FROM subscriptions WHERE customer_id = ($N::text)::uuid
  UNION SELECT tenant_id::text FROM subscriptions WHERE customer_id = ($N::text)::uuid AND tenant_id IS NOT NULL
  UNION SELECT id::text FROM orders WHERE customer_id = ($N::text)::uuid
  UNION SELECT j.id::text FROM shared_jobs j JOIN customers c ON c.tenant_id = j.control_tenant_id WHERE c.id = ($N::text)::uuid`

function filters(query: AuditListQuery): { where: string; params: unknown[] } {
  const params: unknown[] = []
  const bind = (sql: string, value: unknown) => { params.push(value); return sql.replaceAll('$N', `$${params.length}`) }
  const conditions: string[] = []
  if (query.q) conditions.push(bind(`(a.action ILIKE $N OR a.actor ILIKE $N OR a.subject ILIKE $N OR a.reason ILIKE $N OR a.subject IN (${NAMED_SUBJECTS}) OR a.actor IN (${NAMED_ACCOUNTS}))`, contains(query.q)))
  if (query.actor) conditions.push(bind(`(a.actor ILIKE $N OR a.actor IN (${NAMED_ACCOUNTS}))`, contains(query.actor)))
  if (query.action) conditions.push(bind(`(a.action = $N OR starts_with(a.action, $N || '.'))`, query.action))
  if (query.customer_id) conditions.push(bind(`(a.subject IN (${CUSTOMER_SUBJECTS}) OR a.metadata->>'customer_id' = $N::text)`, query.customer_id))
  if (query.from) conditions.push(bind(`a.created_at >= ($N::text)::date::timestamp AT TIME ZONE '${BUSINESS_TIME_ZONE}'`, query.from))
  if (query.to) conditions.push(bind(`a.created_at < (($N::text)::date + 1)::timestamp AT TIME ZONE '${BUSINESS_TIME_ZONE}'`, query.to))
  return { where: conditions.length ? `WHERE ${conditions.join(' AND ')}` : '', params }
}

type Resolved = { kind: AuditSubjectKind; name: string | null; customer_id: string | null; tenant_id: string | null }

async function resolveSubjects(pool: Pool, subjects: string[], actors: string[]) {
  const ids = [...new Set(subjects.filter(subject => UUID.test(subject)))]
  const accountIds = [...new Set([...subjects, ...actors].map(value => ACCOUNT.exec(value)?.[1]).filter((id): id is string => Boolean(id)))]
  const [records, accounts] = await Promise.all([
    ids.length ? pool.query(`SELECT 'customer' AS kind, c.id::text AS ref, c.name, c.id AS customer_id, c.tenant_id FROM customers c WHERE c.id = ANY($1::uuid[])
      UNION ALL SELECT 'tenant', t.id::text, t.name, c.id, t.id FROM tenants t LEFT JOIN customers c ON c.tenant_id = t.id WHERE t.id = ANY($1::uuid[])
      UNION ALL SELECT 'order', o.id::text, c.name, c.id, c.tenant_id FROM orders o JOIN customers c ON c.id = o.customer_id WHERE o.id = ANY($1::uuid[])
      UNION ALL SELECT 'plan', id::text, name, NULL::uuid, NULL::uuid FROM plan_revisions WHERE id = ANY($1::uuid[])
      UNION ALL SELECT 'bundle', id::text, name, NULL::uuid, NULL::uuid FROM bundle_revisions WHERE id = ANY($1::uuid[])
      UNION ALL SELECT 'catalog', id::text, version, NULL::uuid, NULL::uuid FROM catalog_entries WHERE id = ANY($1::uuid[])`, [ids]) : { rows: [] },
    accountIds.length ? pool.query('SELECT id::text AS id, display_name FROM vendor_accounts WHERE id = ANY($1::bigint[])', [accountIds]) : { rows: [] },
  ])
  const accountNames = new Map<string, string>(accounts.rows.map(row => [`account:${row.id}`, row.display_name]))
  const byRef = new Map<string, Resolved>(records.rows.map(row => [row.ref, { kind: row.kind, name: row.name, customer_id: row.customer_id, tenant_id: row.tenant_id }]))
  const subjectRef = (subject: string): Resolved => ACCOUNT.test(subject)
    ? { kind: 'account', name: accountNames.get(subject) ?? null, customer_id: null, tenant_id: null }
    : byRef.get(subject) ?? { kind: 'other', name: null, customer_id: null, tenant_id: null }
  return { subjectRef, actorName: (actor: string) => accountNames.get(actor) ?? null }
}

export async function listAudit(pool: Pool, query: AuditListQuery): Promise<AuditList> {
  const { where, params } = filters(query)
  const [page, count] = await Promise.all([
    pool.query(
      `SELECT a.id,a.actor,a.action,a.subject,a.reason,a.created_at FROM audit_events a ${where}
       ORDER BY a.created_at DESC,a.id DESC LIMIT ${AUDIT_PAGE_SIZE} OFFSET $${params.length + 1}`, [...params, ((query.page ?? 1) - 1) * AUDIT_PAGE_SIZE]),
    pool.query(`SELECT count(*)::int AS total FROM audit_events a ${where}`, params),
  ])
  const rows = page.rows
  const { subjectRef, actorName } = await resolveSubjects(pool, rows.map(row => row.subject), rows.map(row => row.actor))
  const items: AuditEvent[] = rows.map(({ created_at, ...row }) => ({
    ...row, created_at: created_at.toISOString(), actor_name: actorName(row.actor), subject_ref: subjectRef(row.subject),
  }))
  return { items, total: count.rows[0].total }
}
