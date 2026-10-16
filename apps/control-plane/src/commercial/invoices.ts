import { randomUUID } from 'node:crypto'
import type { Pool, PoolClient } from 'pg'
import { invoiceSchema, TAX_LABEL, type Invoice, type Money, type Quote } from '@nasq/commercial-contracts'

export type InvoiceView = Invoice
/** Vendor-console view: the customer-facing invoice plus the customer's name (never sent to customers). */
export type VendorInvoiceView = InvoiceView & { customer_name: string }
export type VendorInvoiceSummary = { outstanding: Money[] }
type Q = Pick<Pool, 'query'>

const d = (v: unknown): string => (v instanceof Date ? v.toISOString().slice(0, 10) : String(v).slice(0, 10))
const ts = (v: unknown): string | null => (v == null ? null : v instanceof Date ? v.toISOString() : String(v))
const num = (v: unknown): number => Number(v)

export function invoiceView(row: any, lines: any[], adjustments: any[] = []): InvoiceView {
  const cur = row.currency as string
  const ex = num(row.exponent)
  const money = (minor: unknown) => ({ currency: cur, exponent: ex, minor: num(minor) })
  void adjustments
  return invoiceSchema.parse({
    id: row.id, number: row.number ?? null, customer_id: row.customer_id, subscription_id: row.subscription_id,
    order_id: row.order_id ?? null, kind: row.kind, status: row.status, currency: cur,
    lines: [...lines].sort((a, b) => num(a.position) - num(b.position)).map(l => ({
      key: l.key, kind: l.kind, timing: l.timing, description: l.description, quantity: num(l.quantity),
      unit_amount: money(l.unit_minor), amount: money(l.amount_minor),
      period_start: d(l.period_start), period_end: d(l.period_end), source_revision_id: l.source_revision_id,
      ...(l.free_quantity == null ? {} : { free_quantity: num(l.free_quantity) }),
    })),
    subtotal: money(row.subtotal_minor), tax: money(row.tax_minor), total: money(row.total_minor),
    period_start: d(row.period_start), period_end: d(row.period_end),
    issued_at: ts(row.issued_at), due_at: ts(row.due_at), paid_at: ts(row.paid_at),
    tax_label: TAX_LABEL, official_tax_invoice: false,
  })
}

export async function issueInvoiceFromQuote(
  client: PoolClient,
  { order, quote }: { order: { id: string; customer_id: string; subscription_id: string; kind: string }; quote: Quote },
): Promise<InvoiceView | null> {
  if (quote.due_now.minor === 0) return null
  const now = quote.lines.filter(l => l.timing === 'now')
  const subtotal = now.filter(l => l.kind !== 'tax').reduce((s, l) => s + l.amount.minor, 0)
  const tax = now.filter(l => l.kind === 'tax').reduce((s, l) => s + l.amount.minor, 0)
  const total = subtotal + tax
  if (total !== quote.due_now.minor) throw new Error('invoice_total_mismatch')
  const kind = order.kind === 'new' ? 'initial' : order.kind === 'renewal' ? 'renewal' : 'change'
  const periodStart = now[0]?.period_start ?? quote.effective_date
  const periodEnd = now[0]?.period_end ?? quote.next_renewal_at
  const id = randomUUID()
  const { currency, exponent } = quote.due_now
  const ins = await client.query(
    `INSERT INTO invoices(id, customer_id, subscription_id, order_id, kind, status, currency, exponent,
       subtotal_minor, tax_minor, total_minor, period_start, period_end, due_at)
     VALUES($1,$2,$3,$4,$5,'issued',$6,$7,$8,$9,$10,$11,$12, now()) RETURNING *`,
    [id, order.customer_id, order.subscription_id, order.id, kind, currency, exponent, subtotal, tax, total, periodStart, periodEnd],
  )
  const lines: any[] = []
  for (let i = 0; i < now.length; i++) {
    const l = now[i]!
    const unit = l.quantity > 0 && l.amount.minor % l.quantity === 0 ? l.amount.minor / l.quantity : l.amount.minor
    const r = await client.query(
      `INSERT INTO invoice_lines(id, invoice_id, position, key, kind, timing, description, quantity, unit_minor, amount_minor,
         currency, exponent, period_start, period_end, source_revision_id, free_quantity)
       VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,NULL) RETURNING *`,
      [randomUUID(), id, i, l.key, l.kind, l.timing, l.description, l.quantity, unit, l.amount.minor,
        l.amount.currency, l.amount.exponent, l.period_start, l.period_end, l.source_revision_id],
    )
    lines.push(r.rows[0])
  }
  return invoiceView(ins.rows[0], lines, [])
}

async function hydrate(pool: Q, rows: any[]): Promise<InvoiceView[]> {
  if (!rows.length) return []
  const ids = rows.map(r => r.id)
  const ls = (await pool.query('SELECT * FROM invoice_lines WHERE invoice_id = ANY($1::uuid[])', [ids])).rows
  const as = (await pool.query('SELECT * FROM invoice_adjustments WHERE invoice_id = ANY($1::uuid[])', [ids])).rows
  return rows.map(r => invoiceView(r, ls.filter(l => l.invoice_id === r.id), as.filter(a => a.invoice_id === r.id)))
}

type InvoiceFilter = { customer_id?: string; status?: string; limit?: number; offset?: number }

/** The one invoice query: filtered, newest first, paged in SQL. Rows carry the customer name for the vendor view only. */
async function selectInvoices(pool: Q, { customer_id, status, limit = 50, offset = 0 }: InvoiceFilter): Promise<{ rows: any[]; total: number }> {
  const where: string[] = []
  const args: unknown[] = []
  if (customer_id) { args.push(customer_id); where.push(`i.customer_id = $${args.length}`) }
  if (status) { args.push(status); where.push(`i.status = $${args.length}`) }
  const w = where.length ? `WHERE ${where.join(' AND ')}` : ''
  const total = num((await pool.query(`SELECT count(*)::int AS n FROM invoices i ${w}`, args)).rows[0].n)
  const rows = (await pool.query(
    `SELECT i.*, c.name AS customer_name FROM invoices i JOIN customers c ON c.id = i.customer_id ${w}
     ORDER BY i.created_at DESC, i.id LIMIT $${args.length + 1} OFFSET $${args.length + 2}`,
    [...args, limit, offset],
  )).rows
  return { rows, total }
}

/** A customer's own invoices; the customer name is never part of this view. */
export async function listInvoices(pool: Q, { customer_id }: { customer_id: string }): Promise<{ items: InvoiceView[]; total: number }> {
  const { rows, total } = await selectInvoices(pool, { customer_id })
  return { items: await hydrate(pool, rows), total }
}

export async function getInvoice(pool: Q, id: string, { customer_id }: { customer_id?: string } = {}): Promise<InvoiceView | null> {
  const args: unknown[] = [id]
  let w = 'id = $1'
  if (customer_id) { args.push(customer_id); w += ' AND customer_id = $2' }
  const rows = (await pool.query(`SELECT * FROM invoices WHERE ${w}`, args)).rows
  return (await hydrate(pool, rows))[0] ?? null
}

async function hydrateVendor(pool: Q, rows: any[]): Promise<VendorInvoiceView[]> {
  const views = await hydrate(pool, rows)
  return views.map((v, i) => ({ ...v, customer_name: rows[i].customer_name as string }))
}

export async function getVendorInvoice(pool: Q, id: string): Promise<VendorInvoiceView | null> {
  const rows = (await pool.query('SELECT i.*, c.name AS customer_name FROM invoices i JOIN customers c ON c.id = i.customer_id WHERE i.id = $1', [id])).rows
  return (await hydrateVendor(pool, rows))[0] ?? null
}

/** Vendor list: a filtered page plus the outstanding balance (issued invoices) for the same customer scope, ignoring the status filter. */
export async function listVendorInvoices(
  pool: Q,
  filter: InvoiceFilter = {},
): Promise<{ items: VendorInvoiceView[]; total: number; summary: VendorInvoiceSummary }> {
  const { rows, total } = await selectInvoices(pool, filter)
  const args = filter.customer_id ? [filter.customer_id] : []
  const sums = (await pool.query(
    `SELECT currency, exponent, sum(total_minor)::bigint AS minor FROM invoices WHERE status = 'issued'${args.length ? ' AND customer_id = $1' : ''}
     GROUP BY currency, exponent ORDER BY currency`,
    args,
  )).rows
  return {
    items: await hydrateVendor(pool, rows), total,
    summary: { outstanding: sums.map(r => ({ currency: r.currency, exponent: num(r.exponent), minor: num(r.minor) })) },
  }
}
