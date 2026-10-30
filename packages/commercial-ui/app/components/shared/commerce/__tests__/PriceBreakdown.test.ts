import { resolve } from 'node:path'
import { defineComponent, h } from 'vue'
import { describe, expect, it } from 'vitest'
import { renderShared } from '@liwan/ui/test/helpers/renderShared'
import * as commercial from '../../../../utils/commercial'

const sar = (minor: number) => ({ currency: 'SAR', exponent: 2, minor })
const line = (key: string, kind: string, timing: 'now' | 'renewal', description: string, quantity: number, minor: number) =>
  ({ key, kind, timing, description, quantity, amount: sar(minor) })
const quote = {
  cadence: { unit: 'month', count: 1 }, requested_extra_branches: 3, due_now: sar(41400), next_renewal: sar(41400), next_renewal_at: '2026-11-02',
  lines: [line('base', 'base', 'now', 'Base plan', 1, 20000), line('br', 'branch', 'now', 'Extra branch', 2, 6000), line('r1', 'base', 'renewal', 'Base plan renewal', 1, 20000)],
}
// The invoice list is its own component with its own test; here it only echoes what it was given.
const SharedInvoiceLines = defineComponent({
  props: { lines: { type: Array, default: () => [] }, totals: { type: Array, default: () => [] } },
  setup: props => () => h('div', { 'data-stub': 'lines' }, [...props.lines.map(l => h('p', (l as { description: string, amount: string }).description + '|' + (l as { amount: string }).amount)), ...props.totals.map(r => h('p', (r as { label: string, value: string }).label + '|' + (r as { value: string }).value))]),
})
const UAlert = defineComponent({ props: { title: String }, setup: (props, { slots }) => () => h('div', { 'data-alert': '' }, [props.title, slots.actions?.()]) })
const render = (props: Record<string, unknown>) => renderShared(
  resolve(import.meta.dirname, '../PriceBreakdown.vue'), props, {},
  { modules: { '../../../utils/commercial': commercial }, stubs: { SharedInvoiceLines, UAlert } },
)

describe('PriceBreakdown', () => {
  it('lists the headquarters line then the due-now lines, and the due-now and renewal totals', async () => {
    const html = await render({ quote, hqIncluded: true })
    expect(html).toContain('commercial.pricing.quote.hq|commercial.pricing.summary.included')
    expect(html).toMatch(/Base plan\|[^<]*200\.00/)
    expect(html).toMatch(/Extra branch\|[^<]*60\.00/)
    expect(html).toContain('commercial.pricing.quote.dueNow|')
    expect(html).toContain('commercial.pricing.quote.nextRenewal · 2026-11-02|')
    expect(html).toContain('commercial.pricing.cadence.month.one')
  })

  it('shows the renewal lines in a closed details block and the VAT note', async () => {
    const html = await render({ quote })
    expect(html).toContain('<details')
    expect(html).toContain('Base plan renewal')
    expect(html).toContain('commercial.pricing.quote.vatNote')
  })

  it('renders the metered users and storage lines from the server quote', async () => {
    const metered = { ...quote, lines: [...quote.lines, line('us', 'users', 'now', 'Users', 7, 17500), line('st', 'storage', 'now', 'Storage', 15, 7500)] }
    const html = await render({ quote: metered })
    expect(html).toContain('commercial.pricing.quote.users')
    expect(html).toContain('commercial.pricing.quote.storage')
    expect(html).toMatch(/commercial\.pricing\.quote\.users\|[^<]*175\.00/)
    expect(html).not.toContain('|Users')
  })

  it('hides the headquarters line when the plan does not include it', async () => {
    const html = await render({ quote, hqIncluded: false })
    expect(html).not.toContain('commercial.pricing.quote.hq|')
  })

  it('shows the empty, loading and failed states instead of a quote', async () => {
    expect(await render({ quote: null })).toContain('commercial.pricing.quote.empty')
    expect(await render({ quote: null, pending: true })).toContain('commercial.pricing.quote.loading')
    const failed = await render({ quote: null, error: 'Request failed' })
    expect(failed).toContain('Request failed')
    expect(failed).toContain('commercial.pricing.retry')
    expect(failed).not.toContain('data-stub')
  })
})
