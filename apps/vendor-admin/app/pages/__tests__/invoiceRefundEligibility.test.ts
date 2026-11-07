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
// A refund is about a paid invoice, so that is the default; the bank-transfer case below overrides it to `issued`.
const makeInvoice = (tax_label: string | null = null) => ({ id: 'invoice1', order_id: 'order/1', customer_id: 'customer1', status: 'paid', kind: 'initial', total: money, subtotal: money,
  tax: tax_label === null ? { minor: 0, exponent: 2, currency: 'SAR' } : { minor: 100, exponent: 2, currency: 'SAR' },
  tax_label, period_start: '2026-10-01', period_end: '2026-11-01', lines: [], adjustments: [] })
const invoice = makeInvoice()
const { tax_label: _taxLabel, ...withoutTaxLabel } = invoice
const refundable = { refundable: true, first_payment: true, until: '2026-11-20T23:59:59+03:00', window_days: 14 }
/** A refund the vendor requested because the customer asked inside the window. */
const creditNote = { id: 'note1', invoice_id: invoice.id, customer_id: 'customer1', kind: 'credit_note', origin: 'vendor', reason: 'Customer asked for the refund on day 3', amount: money, status: 'pending', created_at: '2026-10-04T12:34:00Z', created_by: 'account:7', refund_reference: null, refunded_at: null, refunded_by: null }
/** A duplicate payment the system found: it has no window, so it must be recordable at any date. */
const systemNote = { ...creditNote, id: 'note2', origin: 'system', reason: 'Duplicate charge for the same invoice', created_by: 'system' }

type Refundability = { refundable: boolean; first_payment: boolean; until: string | null; window_days: number }

type Options = {
  overrides?: Partial<typeof invoice>
  refund?: Refundability
  adjustments?: unknown[]
  /** `omit`: no `tax_label` key at all (the shape the removed condition depended on); `null`: Liwan's own untaxed invoice. */
  taxLabel?: 'omit' | null | string
  grants?: string[]
  hydrated?: boolean
}

async function page(options: Options = {}) {
  const filename = resolve(import.meta.dirname, '../invoices/[id].vue')
  const descriptor = parse(readFileSync(filename, 'utf8'), { filename }).descriptor
  const script = stripImports(compileScript(descriptor, { id: 'invoice-refund-eligibility' }).content).replaceAll('import.meta.client', 'false').replace('export default', 'return')
  const base = options.taxLabel === 'omit' || options.taxLabel === undefined ? withoutTaxLabel : makeInvoice(options.taxLabel)
  const loaded = { ...base, ...options.overrides, refund: options.refund ?? refundable, adjustments: options.adjustments ?? [] }
  const hydrated = Vue.ref(options.hydrated ?? true)
  const api = {
    invoice: vi.fn(async () => loaded),
    paymentAttempts: vi.fn(async () => ({ items: [], total: 0 })),
    refundCreditNote: vi.fn(async () => ({ ...creditNote, status: 'refunded' })),
    requestRefund: vi.fn(async () => creditNote),
    recordBankTransfer: vi.fn(async () => ({})),
  }
  const bindings = {
    formatLiwanDate, formatLiwanDateTime, invoiceStatusBadge, adjustmentStatusBadge, paymentAttemptBadge, formatCommercialMoney,
    ...subscriptions, ...commercial, _defineComponent: Vue.defineComponent, _withAsyncContext: (fn: () => unknown) => [fn(), () => {}],
    computed: Vue.computed, ref: Vue.ref, watch: Vue.watch, reactive: Vue.reactive,
    definePageMeta: () => {}, useHydrated: () => hydrated,
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
  return { state, api, hydrated, rendered }
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

  it('states no refund eligibility on an invoice that has not been paid', async () => {
    // An unpaid invoice has no payment to judge, so "not the customer's first payment" would be a false statement.
    const unpaid = await page({ taxLabel: null, overrides: { status: 'issued' } })
    const { captured } = await unpaid.rendered()
    expect(captured.some(c => c.props['data-testid'] === 'refund-window')).toBe(false)
  })

  it('offers the bank-transfer action on an unpaid invoice and not on a paid one', async () => {
    const unpaid = await page({ taxLabel: null, overrides: { status: 'issued' } })
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

type Captured = { name: string; props: Record<string, unknown> }[]
const byTestId = (captured: Captured, id: string) => captured.find(c => c.props['data-testid'] === id)
const closed: Refundability = { refundable: false, first_payment: true, until: '2026-01-02T23:59:59+03:00', window_days: 14 }
const later: Refundability = { refundable: false, first_payment: false, until: null, window_days: 14 }
const refundedVendorNote = { ...creditNote, status: 'refunded', refund_reference: 'MOY-REFUND-77', refunded_at: '2026-10-05T08:00:00Z', refunded_by: 'account:7' }

describe('requesting the refund of a paid invoice', () => {
  it('offers «طلب استرداد» on a paid invoice that is refundable, enabled and without a reason line', async () => {
    const { html, captured } = await (await page({ refund: refundable })).rendered()
    const button = byTestId(captured, 'request-refund-action')
    expect(button?.props.disabled).toBe(false)
    expect(button?.props['aria-describedby']).toBeUndefined()
    expect(html).toContain('vendor.invoices.refund.request.action')
    expect(byTestId(captured, 'refund-request-blocked')).toBeUndefined()
  })

  it.each([
    ['the window has closed', closed, [], 'vendor.invoices.refund.windowClosed'],
    ['the payment is not the first one', later, [], 'vendor.invoices.refund.notFirstPayment'],
    ['the invoice is already refunded', refundable, [refundedVendorNote], 'vendor.invoices.refund.alreadyRequested'],
    ['a refund was already requested and is pending', refundable, [creditNote], 'vendor.invoices.refund.alreadyRequested'],
  ])('disables the request and says why when %s', async (_name, refund, adjustments, reasonKey) => {
    const p = await page({ refund, adjustments })
    const { html, captured } = await p.rendered()
    expect(byTestId(captured, 'request-refund-action')?.props.disabled).toBe(true)
    // The disabled button points at the sentence that explains it.
    expect(byTestId(captured, 'request-refund-action')?.props['aria-describedby']).toBe('refund-request-blocked')
    expect(html).toContain('id="refund-request-blocked"')
    expect(html).toContain(reasonKey)
    // No path opens the request: the handler refuses even when called directly.
    p.state.openRequest(); p.state.requestReason.value = 'Customer asked for the refund on day 3'
    await p.state.requestRefund()
    expect(p.api.requestRefund).not.toHaveBeenCalled()
  })

  it('is not blocked by a system note, which is no vendor request', async () => {
    const p = await page({ refund: refundable, adjustments: [systemNote] })
    expect(byTestId((await p.rendered()).captured, 'request-refund-action')?.props.disabled).toBe(false)
  })

  it('offers no request on an unpaid invoice or to a role without the billing grant', async () => {
    const unpaid = await (await page({ taxLabel: null, overrides: { status: 'issued' } })).rendered()
    expect(byTestId(unpaid.captured, 'request-refund-action')).toBeUndefined()
    const noBilling = await (await page({ grants: ['vendor.read'] })).rendered()
    expect(byTestId(noBilling.captured, 'request-refund-action')).toBeUndefined()
    expect(noBilling.html).not.toContain('vendor.invoices.refund.request.title')
  })

  it('states the eligibility alert only for a paid invoice', async () => {
    expect(byTestId((await (await page({ refund: refundable })).rendered()).captured, 'refund-window')).toBeDefined()
    for (const status of ['issued', 'draft', 'void'])
      expect(byTestId((await (await page({ refund: later, overrides: { status } })).rendered()).captured, 'refund-window'), status).toBeUndefined()
    const closedAlert = byTestId((await (await page({ refund: closed })).rendered()).captured, 'refund-window')
    expect(closedAlert?.props.description).toBe('vendor.invoices.refund.windowClosed')
    expect(byTestId((await (await page({ refund: later })).rendered()).captured, 'refund-window')?.props.description).toBe('vendor.invoices.refund.notFirstPayment')
  })

  it('opens one inline confirmation with a reason field, never a dialog, and sends one request on a double click', async () => {
    const p = await page({ refund: refundable })
    const open = byTestId((await p.rendered()).captured, 'request-refund-action')!
    ;(open.props.onClick as () => void)(); (open.props.onClick as () => void)()
    // Too short a reason keeps the confirm disabled and sends nothing.
    p.state.requestReason.value = 'ab'
    const opened = await p.rendered()
    expect(opened.captured.filter(c => c.name === 'SharedInlineConfirm' && c.props.title === 'vendor.invoices.refund.request.confirmTitle')).toHaveLength(1)
    expect(opened.captured.some(c => c.name === 'UModal')).toBe(false)
    expect(opened.captured.find(c => c.name === 'SharedInlineConfirm')?.props.disabled).toBe(true)
    await p.state.requestRefund(); expect(p.api.requestRefund).not.toHaveBeenCalled()
    // The same confirm clicked twice before the first answer arrives is one request.
    p.state.requestReason.value = '  Customer asked for the refund on day 3  '
    let answer!: () => void
    p.api.requestRefund.mockImplementationOnce(() => new Promise(resolve => { answer = () => resolve(creditNote) }))
    const confirm = (await p.rendered()).captured.find(c => c.name === 'SharedInlineConfirm')!
    const first = (confirm.props.onConfirm as () => Promise<void>)(); const second = (confirm.props.onConfirm as () => Promise<void>)()
    expect((await p.rendered()).captured.find(c => c.name === 'SharedInlineConfirm')?.props.pending).toBe(true)
    answer(); await Promise.all([first, second])
    expect(p.api.requestRefund).toHaveBeenCalledTimes(1)
    expect(p.api.requestRefund).toHaveBeenCalledWith('invoice1', { reason: '  Customer asked for the refund on day 3  ' })
  })

  it('refreshes the invoice, its adjustments and the payment attempts after success, and closes the form', async () => {
    const p = await page({ refund: refundable })
    const invoiceCalls = p.api.invoice.mock.calls.length; const attemptCalls = p.api.paymentAttempts.mock.calls.length
    p.state.openRequest(); p.state.requestReason.value = 'Customer asked for the refund on day 3'
    await p.state.requestRefund()
    expect(p.api.invoice.mock.calls.length).toBe(invoiceCalls + 1)
    expect(p.api.paymentAttempts.mock.calls.length).toBe(attemptCalls + 1)
    expect(p.state.requestOpen.value).toBe(false); expect(p.state.requestFailure.value).toBeUndefined(); expect(p.state.requestBusy.value).toBe(false)
  })

  it('shows the structured server refusal through the known-code mapping, keeps the draft and still reloads', async () => {
    const p = await page({ refund: refundable })
    p.state.openRequest(); p.state.requestReason.value = 'Customer asked for the refund on day 3'
    p.api.requestRefund.mockRejectedValueOnce({ statusCode: 409, data: { code: 'refund_window_closed', message: 'closed' } })
    const invoiceCalls = p.api.invoice.mock.calls.length
    await p.state.requestRefund()
    expect(p.state.requestFailure.value).toBe('vendor.invoices.refund.errors.refund_window_closed')
    expect(p.state.requestReason.value).toBe('Customer asked for the refund on day 3')
    expect(p.api.invoice.mock.calls.length).toBe(invoiceCalls + 1)
    const shown = byTestId((await p.rendered()).captured, 'request-refund-failure')
    expect(shown?.props.title).toBe('vendor.invoices.refund.errors.refund_window_closed')
    // A code outside the refund wording still reads through the shared mapping, and an unknown one never leaks.
    p.api.requestRefund.mockRejectedValueOnce({ statusCode: 409, data: { code: 'refund_already_requested' } })
    await p.state.requestRefund()
    expect(p.state.requestFailure.value).toBe('vendor.pricing.errors.refund_already_requested')
    p.api.requestRefund.mockRejectedValueOnce({ statusCode: 500, data: { code: 'database exploded at 10.0.0.4' } })
    await p.state.requestRefund()
    expect(p.state.requestFailure.value).toBe('vendor.pricing.errors.generic')
  })

  it('sends nothing before hydration', async () => {
    const p = await page({ refund: refundable, hydrated: false })
    p.state.openRequest(); p.state.requestReason.value = 'Customer asked for the refund on day 3'
    await p.state.requestRefund()
    expect(p.api.requestRefund).not.toHaveBeenCalled()
  })
})

describe('recording a refund follows the origin of the note, not today’s date', () => {
  const recordButton = (captured: Captured) => captured.filter(c => c.name === 'UButton' && c.props['data-testid'] === 'record-refund-action')
  const record = async (p: Awaited<ReturnType<typeof page>>, id: string) => {
    p.state.openRefund(id); p.state.refundReference.value = 'MOY-REFUND-77'; p.state.refundReason.value = 'Refunded in the dashboard'
    await p.state.recordRefund()
  }

  it.each([['a window that has closed', closed], ['a payment that is not the first', later]])('records a system note (duplicate payment) outside the window: %s', async (_name, refund) => {
    const p = await page({ refund, adjustments: [systemNote] })
    const buttons = recordButton((await p.rendered()).captured)
    expect(buttons).toHaveLength(1)
    expect(buttons[0]!.props.disabled).toBe(false)
    await record(p, 'note2')
    expect(p.api.refundCreditNote).toHaveBeenCalledWith('note2', { external_reference: 'MOY-REFUND-77', reason: 'Refunded in the dashboard' })
  })

  it('still records a pending vendor note after the window closed: the server judged it when the note was created', async () => {
    const p = await page({ refund: closed, adjustments: [creditNote] })
    expect(recordButton((await p.rendered()).captured)[0]!.props.disabled).toBe(false)
    await record(p, 'note1')
    expect(p.api.refundCreditNote).toHaveBeenCalledTimes(1)
  })

  it('names who raised each note and offers no record action on a refunded one', async () => {
    const { html, captured } = await (await page({ refund: closed, adjustments: [creditNote, systemNote, refundedVendorNote].map((n, i) => ({ ...n, id: `n${i}` })) })).rendered()
    expect(html).toContain('vendor.invoices.adjustmentOrigin.vendor')
    expect(html).toContain('vendor.invoices.adjustmentOrigin.system')
    expect(recordButton(captured)).toHaveLength(2)
    expect(html).not.toContain('data-testid="refund-ineligible"')
  })
})

describe('the bank transfer form', () => {
  const issued = { taxLabel: null, overrides: { status: 'issued' } } as const
  const transferRows = (captured: Captured) => captured.filter(c => c.name === 'UFormField' && c.props.label === 'vendor.invoices.transfer.amount')

  afterEach(() => { vi.useRealTimers() })

  it('opens on today’s date in Riyadh, not on the UTC day, and on the invoice total', async () => {
    // 22:30 UTC on the 7th is already 01:30 on the 8th in Riyadh, where the bank statement is dated.
    vi.useFakeTimers({ toFake: ['Date'] }); vi.setSystemTime(new Date('2026-11-07T22:30:00Z'))
    const p = await page(issued)
    p.state.openTransfer()
    expect(p.state.transferDate.value).toBe('2026-11-08')
    expect(p.state.transferAmount.value).toBe('123.45')
  })

  it('accepts Arabic-Indic digits and records the exact minor amount', async () => {
    const p = await page(issued)
    p.state.openTransfer()
    p.state.transferReference.value = 'SARIE-7731'; p.state.transferAmount.value = '١٢٣٫٤٥'
    expect(p.state.transferValid.value).toBe(true)
    expect(p.state.transferAmountError.value).toBeUndefined()
    await p.state.recordTransfer()
    expect(p.api.recordBankTransfer).toHaveBeenCalledWith('invoice1', { reference: 'SARIE-7731', amount: 12345, value_date: p.state.transferDate.value })
  })

  it('shows a visible message, not a silently disabled button, for an amount it cannot read', async () => {
    const p = await page(issued)
    p.state.openTransfer(); p.state.transferReference.value = 'SARIE-7731'
    p.state.transferAmount.value = 'abc'
    expect(p.state.transferValid.value).toBe(false)
    expect(transferRows((await p.rendered()).captured)[0]!.props.error).toBe('vendor.invoices.transfer.amountInvalid')
    await p.state.recordTransfer(); expect(p.api.recordBankTransfer).not.toHaveBeenCalled()
  })

  it('refuses more than two decimals instead of rounding them', async () => {
    const p = await page(issued)
    p.state.openTransfer(); p.state.transferReference.value = 'SARIE-7731'
    p.state.transferAmount.value = '123.456'
    expect(p.state.transferValid.value).toBe(false)
    expect(transferRows((await p.rendered()).captured)[0]!.props.error).toBe('vendor.invoices.transfer.amountDecimals')
    await p.state.recordTransfer(); expect(p.api.recordBankTransfer).not.toHaveBeenCalled()
    p.state.transferAmount.value = '123.4'
    expect(p.state.transferValid.value).toBe(true)
  })
})
