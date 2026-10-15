import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import * as statusTone from '@nasq/ui/app/utils/statusTone'
import { renderShared } from '@nasq/ui/test/helpers/renderShared'

const lines = [
  { id: 'a', description: 'Base', kind: { label: 'Base fee', tone: 'neutral' }, cells: [{ key: 'free', label: 'Free', value: '2' }, { key: 'period', label: 'Period', value: '2026-10-01 → 2026-10-31' }], amount: 'SAR 3.00' },
  { id: 'b', description: 'Discount', cells: [{ key: 'free', label: 'Free', value: '—' }, { key: 'period', label: 'Period', value: '2026-10-01 → 2026-10-31' }], amount: '-SAR 0.50' },
]
const render = (props: Record<string, unknown>) => renderShared(resolve(import.meta.dirname, '../InvoiceLines.vue'), props, {}, { modules: { '@nasq/ui/app/utils/statusTone': statusTone } })

describe('InvoiceLines', () => {
  it('draws a table: description, the cell columns from the first line, then the amount', async () => {
    const html = await render({ lines })
    expect(html).toContain('data-slot="invoice-lines"')
    expect(html.match(/<th\b/g)).toHaveLength(4)
    expect(html.indexOf('states.invoice.description')).toBeLessThan(html.indexOf('>Free<'))
    expect(html.indexOf('>Period<')).toBeLessThan(html.indexOf('states.invoice.amount'))
    expect(html.match(/data-testid="invoice-line"/g)).toHaveLength(2)
    expect(html).toContain('Base fee')
    expect(html).toContain('-SAR 0.50')
  })

  it('isolates money and periods left-to-right inside RTL text', async () => {
    const html = await render({ lines })
    expect(html).toMatch(/<bdi dir="ltr"[^>]*>SAR 3\.00<\/bdi>/)
    expect(html).toMatch(/<bdi dir="ltr"[^>]*>2026-10-01 → 2026-10-31<\/bdi>/)
  })

  it('draws a list with the notice and the totals, the last one bold', async () => {
    const html = await render({ lines, layout: 'list', notice: 'Not an official tax invoice', totals: [{ label: 'Subtotal', value: 'SAR 2.50' }, { label: 'Total', value: 'SAR 2.88' }] })
    expect(html).not.toContain('<table')
    expect(html).toContain('data-testid="not-official"')
    expect(html.match(/<dt\b/g)).toHaveLength(2)
    expect(html).toMatch(/<dt class="[^"]*font-semibold[^"]*">Total<\/dt>/)
  })

  it('draws nothing but the header for an invoice without lines', async () => {
    const html = await render({ lines: [] })
    expect(html).not.toContain('data-testid="invoice-line"')
    expect(html.match(/<th\b/g)).toHaveLength(2)
  })

  it('shows list cell labels as visible text after the value, never screen-reader only', async () => {
    const cells = [{ key: 'quantity', label: '', value: '× 5' }, { key: 'free', label: 'Free', value: '2' }, { key: 'paid', label: 'Paid', value: '3' }]
    const html = await render({ lines: [{ id: 'a', description: 'Base', cells, amount: 'SAR 3.00' }], layout: 'list' })
    const text = html.replace(/<[^>]+>/g, '').replace(/\s+/g, ' ')
    expect(text).toContain('× 5 · 2 Free · 3 Paid')
    expect(html).not.toMatch(/sr-only[^>]*>\s*Free/)
  })

  it('keeps the placeholder out of the left-to-right isolate', async () => {
    const html = await render({ lines: [{ id: 'a', description: 'Base', cells: [{ key: 'free', label: 'Free', value: 'غير متاح' }], amount: 'SAR 3.00' }] })
    expect(html).not.toMatch(/<bdi[^>]*>غير متاح/)
    expect(html).toContain('غير متاح')
  })
})
