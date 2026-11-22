import { describe, expect, it, vi } from 'vitest'
import { collectInvoices, INVOICE_EXPORT_CAP, INVOICE_EXPORT_COLUMNS, INVOICE_EXPORT_PAGE, invoiceExportCsv, invoiceExportFileName, plainAmount } from '../invoiceExport'

const sar = (minor: number, exponent = 2) => ({ currency: 'SAR', exponent, minor })
const invoice = (n: number, extra: Record<string, unknown> = {}) => ({
  id: `inv-${n}`, number: `INV-${n}`, customer_id: `cus-${n}`, customer_name: `Customer ${n}`, kind: 'renewal', status: 'paid', currency: 'SAR',
  subtotal: sar(26000), tax: sar(0), total: sar(26000), period_start: '2026-10-02', period_end: '2026-11-02',
  issued_at: '2026-10-01T22:00:00Z', due_at: '2026-10-15T21:00:00Z', paid_at: null, adjustments: [], ...extra,
}) as never

/** A control plane with `total` invoices, newest first; `newcomer` adds one more after the first page, which moves every later offset down by one. */
function plane(total: number, newcomer = false) {
  const queries: Record<string, unknown>[] = []
  const read = vi.fn(async (query: { limit: number, offset: number }) => {
    queries.push(query)
    const size = total + (newcomer && queries.length > 1 ? 1 : 0)
    const items = Array.from({ length: Math.max(0, Math.min(query.limit, size - query.offset)) }, (_, i) => invoice(size - (query.offset + i)))
    return { items, total: size }
  })
  return { read, queries }
}
const filters = { customerId: '', status: 'all' }

describe('collectInvoices', () => {
  it('reads pages of 200 by offset until every invoice of the first answer is in', async () => {
    const { read, queries } = plane(450)
    const progress = vi.fn()
    const result = await collectInvoices(read, filters, { onProgress: progress })
    expect(queries.map(q => [q.limit, q.offset])).toEqual([[200, 0], [200, 200], [200, 400]])
    expect(result).toMatchObject({ total: 450, partial: false })
    expect(result.rows).toHaveLength(450)
    expect(progress.mock.calls.map(([p]) => p)).toEqual([{ done: 200, total: 450 }, { done: 400, total: 450 }, { done: 450, total: 450 }])
  })

  it('makes one request for a short list and none beyond an empty one', async () => {
    expect((await collectInvoices(plane(3).read, filters, {})).rows).toHaveLength(3)
    const empty = plane(0)
    expect((await collectInvoices(empty.read, filters, {})).rows).toEqual([])
    expect(empty.read).toHaveBeenCalledTimes(1)
  })

  it('drops an invoice a shifted offset reads twice and still reaches the last one', async () => {
    // A new invoice arrives after the first page: every later offset moves down by one, so page 2 repeats the last row of page 1.
    const { read, queries } = plane(400, true)
    const result = await collectInvoices(read, filters, {})
    const ids = result.rows.map(row => row.id)
    expect(new Set(ids).size).toBe(ids.length)
    expect(ids).toHaveLength(400)
    expect(ids).not.toContain('inv-401')
    expect(ids).toContain('inv-1')
    expect(queries.map(q => q.offset)).toEqual([0, 200, 400])
  })

  it('stops at 5,000 rows after 25 requests and says the export is partial', async () => {
    const { read } = plane(6200)
    const result = await collectInvoices(read, filters, {})
    expect(INVOICE_EXPORT_CAP).toBe(5000)
    expect(read).toHaveBeenCalledTimes(INVOICE_EXPORT_CAP / INVOICE_EXPORT_PAGE)
    expect(result.rows).toHaveLength(5000)
    expect(result).toMatchObject({ total: 6200, partial: true })
  })

  it('passes the customer and status filters to every page, and no status for "all"', async () => {
    const { read, queries } = plane(250)
    await collectInvoices(read, { customerId: 'cus-9', status: 'issued' }, {})
    expect(queries).toEqual([{ customer_id: 'cus-9', status: 'issued', limit: 200, offset: 0 }, { customer_id: 'cus-9', status: 'issued', limit: 200, offset: 200 }])
    const all = plane(10)
    await collectInvoices(all.read, filters, {})
    expect(all.queries).toEqual([{ customer_id: undefined, status: undefined, limit: 200, offset: 0 }])
  })

  it('fails with no rows when a page fails', async () => {
    const boom = new Error('upstream')
    const read = vi.fn().mockResolvedValueOnce({ items: Array.from({ length: 200 }, (_, i) => invoice(i)), total: 450 }).mockRejectedValueOnce(boom)
    await expect(collectInvoices(read, filters, {})).rejects.toBe(boom)
    expect(read).toHaveBeenCalledTimes(2)
  })

  it('stops when cancelled, before asking for another page', async () => {
    const { read } = plane(900)
    const controller = new AbortController()
    const pending = collectInvoices(read, filters, { signal: controller.signal, onProgress: () => controller.abort() })
    await expect(pending).rejects.toMatchObject({ name: 'AbortError' })
    expect(read).toHaveBeenCalledTimes(1)
  })
})

describe('plainAmount', () => {
  it('writes Latin digits, a dot and the currency decimals with no symbol or separator', () => {
    expect(plainAmount(sar(26000))).toBe('260.00')
    expect(plainAmount(sar(5))).toBe('0.05')
    expect(plainAmount(sar(123456789))).toBe('1234567.89')
    expect(plainAmount(sar(-1050))).toBe('-10.50')
    expect(plainAmount(sar(1500, 3))).toBe('1.500')
    expect(plainAmount(sar(7, 0))).toBe('7')
  })
})

const labels = {
  header: ['Number', 'Customer', 'Kind', 'Status', 'Issued', 'Due', 'Paid', 'Period start', 'Period end', 'Currency', 'Subtotal', 'Tax', 'Total', 'Credited', 'Invoice id', 'Customer id'],
  kind: (kind: string) => `kind:${kind}`, status: (status: string) => `status:${status}`,
}
const BOM = '﻿'

describe('invoiceExportCsv', () => {
  it('writes the sixteen columns, the label of the kind and status, the Riyadh day and plain amounts', () => {
    const csv = invoiceExportCsv([invoice(7, { paid_at: '2026-10-03T08:00:00Z', tax: sar(3900), subtotal: sar(26000), total: sar(29900) })], labels)
    const [head, row] = csv.slice(BOM.length).split('\r\n')
    expect(head).toBe(labels.header.join(','))
    expect(INVOICE_EXPORT_COLUMNS).toHaveLength(labels.header.length)
    expect(row!.split(',')).toHaveLength(labels.header.length)
    expect(row).toBe('INV-7,Customer 7,kind:renewal,status:paid,2026-10-02,2026-10-16,2026-10-03,2026-10-02,2026-11-02,SAR,260.00,39.00,299.00,0.00,inv-7,cus-7')
  })

  it('credits the applied and refunded credit notes only', () => {
    const note = (status: string, minor: number, kind = 'credit_note') => ({ kind, status, amount: sar(minor) })
    const csv = invoiceExportCsv([invoice(1, { adjustments: [note('applied', 1000), note('refunded', 250), note('pending', 9000), note('void', 8000), note('applied', 700, 'debit_note')] })], labels)
    expect(csv.split('\r\n')[1]!.split(',')[13]).toBe('12.50')
  })

  it('leaves a draft number empty and a missing date empty', () => {
    const csv = invoiceExportCsv([invoice(2, { number: null, status: 'draft', issued_at: null, due_at: null })], labels)
    expect(csv.split('\r\n')[1]!.split(',').slice(0, 7)).toEqual(['', 'Customer 2', 'kind:renewal', 'status:draft', '', '', ''])
  })

  it('writes a customer name that could start a formula as text, and an Arabic name whole', () => {
    const csv = invoiceExportCsv([invoice(3, { customer_name: '=HYPERLINK("x")' }), invoice(4, { customer_name: 'شركة المثال, للتجارة' })], labels)
    const lines = csv.split('\r\n')
    expect(lines[1]).toContain(`"'=HYPERLINK(""x"")"`)
    expect(lines[2]).toContain('"شركة المثال, للتجارة"')
  })

  it('does not apostrophe a negative amount the code wrote', () => {
    const csv = invoiceExportCsv([invoice(5, { total: sar(-500), subtotal: sar(-500) })], labels)
    expect(csv.split('\r\n')[1]!.split(',').slice(10, 13)).toEqual(['-5.00', '0.00', '-5.00'])
  })
})

describe('invoiceExportFileName', () => {
  it('names the status and the day, and ends a partial export with -partial', () => {
    expect(invoiceExportFileName('issued', '2026-11-22', false)).toBe('liwan-invoices-issued-2026-11-22.csv')
    expect(invoiceExportFileName('all', '2026-11-22', true)).toBe('liwan-invoices-all-2026-11-22-partial.csv')
  })
})
