import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { compileScript, compileTemplate, parse } from '@vue/compiler-sfc'
import { renderToString } from '@vue/server-renderer'
import * as Vue from 'vue'
import ts from 'typescript'
import { afterEach, describe, expect, it, vi } from 'vitest'
import * as subscriptions from '../../utils/vendorSubscriptions'
import * as commercial from '../../utils/vendorCommercial'
import { invoiceStatusBadge } from '@liwan/commercial-ui/app/utils/commercialBadges'
import { formatCommercialMoney } from '@liwan/commercial-ui/app/utils/commercial'
import { adjustmentStatusBadge, paymentAttemptBadge } from '../../utils/vendorBadges'
import { formatLiwanDate, formatLiwanDateTime } from '@liwan/ui/app/composables/calendarDate'

// The mounting harness of admin-repairs.test.ts: the page's SFC script and template are compiled in place, every
// Nuxt/UI binding it resolves is injected, and the child components are shallow stubs that record their props.
const transpile = (s: string) => ts.transpileModule(s, { compilerOptions: { target: ts.ScriptTarget.ES2020, module: ts.ModuleKind.None } }).outputText
const stripImports = (s: string) => s.replace(/^import\s[\s\S]*?from\s*['"][^'"]+['"];?\s*$/gm, '')
const scopes: Vue.EffectScope[] = []
afterEach(() => scopes.splice(0).forEach(s => s.stop()))

const money = { minor: 12345, exponent: 2, currency: 'SAR' }
/** Liwan's own invoice carries no tax: the API sends `tax_label: null` (never a missing key) and a zero tax line. */
const makeInvoice = (tax_label: string | null = null) => ({ id: 'invoice1', order_id: 'order/1', customer_id: 'customer1', status: 'issued', kind: 'initial', total: money, subtotal: money,
  tax: tax_label === null ? { minor: 0, exponent: 2, currency: 'SAR' } : { minor: 100, exponent: 2, currency: 'SAR' },
  tax_label, period_start: '2026-10-01', period_end: '2026-11-01', lines: [], adjustments: [] })
const invoice = makeInvoice()
const { tax_label: _taxLabel, ...withoutTaxLabel } = invoice
const refundable = { refundable: true, first_payment: true, until: '2026-11-20T23:59:59+03:00', window_days: 14 }
const creditNote = { id: 'note1', invoice_id: invoice.id, customer_id: 'customer1', kind: 'credit_note', reason: 'Provisioning failed after payment', amount: money, status: 'pending', created_at: '2026-10-04T12:34:00Z', created_by: 'system', refund_reference: null, refunded_at: null, refunded_by: null }

type Refundability = { refundable: boolean; first_payment: boolean; until: string | null; window_days: number }

type Options = {
  overrides?: Partial<typeof invoice>
  refund?: Refundability
  adjustments?: unknown[]
  /** `omit`: no `tax_label` key at all (the shape the removed condition depended on); `null`: Liwan's own untaxed invoice. */
  taxLabel?: 'omit' | null | string
  grants?: string[]
}

async function page(options: Options = {}) {
  const filename = resolve(import.meta.dirname, '../invoices/[id].vue')
  const descriptor = parse(readFileSync(filename, 'utf8'), { filename }).descriptor
  const script = stripImports(compileScript(descriptor, { id: 'invoice-refund-eligibility' }).content).replaceAll('import.meta.client', 'false').replace('export default', 'return')
  const base = options.taxLabel === 'omit' || options.taxLabel === undefined ? withoutTaxLabel : makeInvoice(options.taxLabel)
  const loaded = { ...base, ...options.overrides, refund: options.refund ?? refundable, adjustments: options.adjustments ?? [] }
  const api = {
    invoice: vi.fn(async () => loaded),
    paymentAttempts: vi.fn(async () => ({ items: [], total: 0 })),
    refundCreditNote: vi.fn(async () => ({ ...creditNote, status: 'refunded' })),
    recordBankTransfer: vi.fn(async () => ({})),
  }
  const bindings = {
    formatLiwanDate, formatLiwanDateTime, invoiceStatusBadge, adjustmentStatusBadge, paymentAttemptBadge, formatCommercialMoney,
    ...subscriptions, ...commercial, _defineComponent: Vue.defineComponent, _withAsyncContext: (fn: () => unknown) => [fn(), () => {}],
    computed: Vue.computed, ref: Vue.ref, watch: Vue.watch, reactive: Vue.reactive,
    definePageMeta: () => {}, useHydrated: () => Vue.ref(true),
    useI18n: () => ({ t: (key: string) => key, locale: Vue.ref('en') }),
    useRoute: () => ({ params: { id: 'invoice1' }, path: '/invoices/invoice1', query: {} }),
    useVendorContext: () => ({ can: (grant: string) => (options.grants ?? ['vendor.read', 'vendor.billing.manage']).includes(grant) }),
    useVendorSubscriptions: () => api,
    useAsyncData: async (key: string | (() => string), fn: () => Promise<unknown>) => {
      const data = Vue.ref<unknown>(null); const error = Vue.ref<unknown>(null); const pending = Vue.ref(false)
      const refresh = vi.fn(async () => { pending.value = true; try { data.value = await fn(); error.value = null } catch (e) { error.value = e } finally { pending.value = false } })
      await refresh()
      void key
      return { data, error, pending, refresh }
    },
  }
  const component = new Function(...Object.keys(bindings), transpile(script))(...Object.values(bindings))
  const scope = Vue.effectScope(); scopes.push(scope)
  const state = await scope.run(() => component.setup({}, { expose: () => {} }))
  const template = compileTemplate({ source: descriptor.template!.content, filename, id: 'invoice-refund-eligibility', compilerOptions: { mode: 'function', expressionPlugins: ['typescript'] } })
  const render = new Function('Vue', transpile(template.code))(Vue)
  async function rendered() {
    const captured: { name: string; props: Record<string, unknown> }[] = []
    const app = Vue.createSSRApp(Vue.defineComponent({ setup: () => Object.fromEntries(Object.entries(state).filter(([key]) => !key.startsWith('$'))), render }))
    for (const name of new Set([...descriptor.template!.content.matchAll(/<([A-Z]\w*)/g)].map(m => m[1]!))) app.component(name, Vue.defineComponent({ inheritAttrs: false, setup(_, { attrs, slots }) {
      return () => { captured.push({ name, props: { ...attrs } }); return Vue.h('div', { 'data-testid': attrs['data-testid'] as string | undefined }, [attrs.title as string, attrs.description as string, slots.default?.()]) }
    } }))
    return { html: await renderToString(app), captured }
  }
  return { state, api, rendered }
}

describe('invoice refund eligibility', () => {
  it('enables the refund action of the customer’s first payment and states the deadline', async () => {
    const p = await page({ adjustments: [creditNote], refund: refundable })
    const { html, captured } = await p.rendered()
    expect(html).toContain('vendor.invoices.refund.firstPayment')
    expect(html).toContain('vendor.invoices.refund.eligibilityRefundable')
    expect(captured.some(c => c.name === 'UAlert' && c.props['data-testid'] === 'refund-window' && c.props.description === 'vendor.invoices.refund.eligibilityRefundable')).toBe(true)
    expect(p.state.refundUntil.value).toBe(formatLiwanDate(refundable.until))
    const button = captured.find(c => c.name === 'UButton' && c.props['data-testid'] === 'record-refund-action')
    expect(button?.props.disabled).toBe(false)
    expect(html).toContain('vendor.invoices.refund.action')
    expect(captured.some(c => c.props['data-testid'] === 'refund-ineligible')).toBe(false)
  })

  it('states the refund eligibility even when the invoice has no adjustments', async () => {
    const { captured } = await (await page({ refund: refundable })).rendered()
    expect(captured.some(c => c.props['data-testid'] === 'refund-window')).toBe(true)
    expect(captured.find(c => c.props['data-testid'] === 'refund-window')?.props.description).toBe('vendor.invoices.refund.eligibilityRefundable')
  })

  it('disables the refund action once the window has closed and says the window closed', async () => {
    const closed = { refundable: false, first_payment: true, until: '2026-01-02T23:59:59+03:00', window_days: 14 }
    const p = await page({ adjustments: [creditNote], refund: closed })
    const { html, captured } = await p.rendered()
    const button = captured.find(c => c.name === 'UButton' && c.props['data-testid'] === 'record-refund-action')
    expect(button?.props.disabled).toBe(true)
    expect(html).toContain('data-testid="refund-ineligible"')
    expect(p.state.refundEligibility.value.label).toBe('vendor.invoices.refund.windowClosed')
    expect(html).toContain('vendor.invoices.refund.windowClosed')
    // No path opens the refund form: the click handler refuses and nothing else offers the action.
    p.state.openRefund('note1')
    p.state.refundReference.value = 'MOY-REFUND-77'; p.state.refundReason.value = 'Refunded in the dashboard'
    await p.state.recordRefund()
    expect(p.api.refundCreditNote).not.toHaveBeenCalled()
    expect(p.state.canRefund.value).toBe(false)
  })

  it('disables the refund action for a payment that is not the first one and says why', async () => {
    const later = { refundable: false, first_payment: false, until: null, window_days: 14 }
    const p = await page({ adjustments: [creditNote], refund: later })
    const { html, captured } = await p.rendered()
    expect(captured.find(c => c.name === 'UButton' && c.props['data-testid'] === 'record-refund-action')?.props.disabled).toBe(true)
    expect(html).toContain('vendor.invoices.refund.notFirstPayment')
    expect(html).toContain('vendor.invoices.refund.firstPaymentNo')
    expect(html).not.toContain('vendor.invoices.refund.windowClosed')
    expect(p.state.refundEligibility.value.label).toBe('vendor.invoices.refund.notFirstPayment')
  })

  it('offers the bank-transfer action on an unpaid invoice and not on a paid one', async () => {
    const unpaid = await page({ taxLabel: null })
    expect((await unpaid.rendered()).captured.some(c => c.props['data-testid'] === 'bank-transfer-action')).toBe(true)
    const paid = await page({ taxLabel: null, overrides: { status: 'paid' } })
    const { html, captured } = await paid.rendered()
    expect(captured.some(c => c.props['data-testid'] === 'bank-transfer-action')).toBe(false)
    expect(html).not.toContain('vendor.invoices.transfer.title')
  })

  it('labels an untaxed subtotal without the tax wording and keeps the taxed label otherwise', async () => {
    const untaxed = await page({ taxLabel: null })
    const { captured, html } = await untaxed.rendered()
    expect(untaxed.state.totals.value.map((total: { label: string }) => total.label)).toEqual(['vendor.invoices.subtotalNoTax', 'vendor.invoices.total'])
    expect(captured.find(c => c.name === 'SharedInvoiceLines')?.props.totals).toEqual(untaxed.state.totals.value)
    expect(html).not.toContain('vendor.invoices.subtotal\"')
    const taxed = await page({ taxLabel: 'VAT 15%' })
    expect(taxed.state.totals.value.map((total: { label: string }) => total.label)).toEqual(['vendor.invoices.subtotal', 'vendor.invoices.taxLine', 'vendor.invoices.total'])
  })
})
