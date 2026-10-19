import { describe, expect, it } from 'vitest'
import { FinanceInvoiceDetailSchema, FinanceInvoiceListSchema, FinanceJournalListSchema, FinancePartnerListSchema, FinancePaymentListSchema } from '@webvue/contracts'
import { moduleUiCapabilities, moduleUiPreviewData } from '../../../e2e/module-ui-preview-data.mjs'

const at = (path, query = '') => new URL(`http://localhost${path}${query}`)
const get = (path, query = '') => moduleUiPreviewData(path, at(path, query))

describe('the finance documents preview fixtures', () => {
  it('serve schema-valid lists and records through the module preview', () => {
    for (const [path, schema] of [
      ['/api/v1/finance/invoices', FinanceInvoiceListSchema], ['/api/v1/finance/invoices/2', FinanceInvoiceDetailSchema],
      ['/api/v1/finance/payments', FinancePaymentListSchema], ['/api/v1/finance/journals', FinanceJournalListSchema],
      ['/api/v1/finance/partners', FinancePartnerListSchema],
    ]) expect(() => schema.parse(get(path)), path).not.toThrow()
    expect(get('/api/v1/finance/invoices/999')).toBeUndefined()
  })

  it('cover all four document types in every state', () => {
    for (const type of ['out_invoice', 'out_refund', 'in_invoice', 'in_refund']) {
      const rows = get('/api/v1/finance/invoices', `?move_type=${type}`).items
      expect(new Set(rows.map(row => row.state)), type).toEqual(new Set(['draft', 'posted', 'cancel']))
      expect(rows.every(row => row.move_type === type)).toBe(true)
    }
  })

  it('report the filtered total even for a one-row page, like the KPI strip asks', () => {
    const drafts = get('/api/v1/finance/invoices', '?move_type=out_invoice&state=draft&limit=1&offset=0')
    expect(drafts.items).toHaveLength(1)
    expect(drafts.total).toBe(get('/api/v1/finance/invoices', '?move_type=out_invoice&state=draft').items.length)
    const noPartnerMatch = get('/api/v1/finance/invoices', '?move_type=out_invoice&partner_id=3&limit=1')
    expect(noPartnerMatch).toEqual({ items: [], total: 0 })
  })

  it('honour the period, the search and the payment filters', () => {
    expect(get('/api/v1/finance/invoices', '?move_type=out_invoice&date_from=2026-09-01').items.every(row => row.invoice_date >= '2026-09-01')).toBe(true)
    expect(get('/api/v1/finance/invoices', '?q=RINV').items.every(row => row.move_type === 'out_refund')).toBe(true)
    expect(get('/api/v1/finance/payments', '?payment_type=outbound').items.every(row => row.payment_type === 'outbound')).toBe(true)
    expect(get('/api/v1/finance/payments', '?state=canceled').total).toBe(1)
    expect(get('/api/v1/finance/partners', '?kind=vendor').items.every(row => row.vendor)).toBe(true)
  })

  it('grant the finance capabilities the pages check', () => {
    for (const capability of ['finance.invoices.read', 'finance.invoices.manage', 'finance.invoices.post', 'finance.payments.read', 'finance.payments.manage', 'finance.journals.read', 'finance.zatca.submit']) expect(moduleUiCapabilities).toContain(capability)
  })
})
