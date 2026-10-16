import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { compileScript, compileTemplate, parse } from '@vue/compiler-sfc'
import { renderToString } from '@vue/server-renderer'
import * as Vue from 'vue'
import ts from 'typescript'
import { afterEach, describe, expect, it, vi } from 'vitest'
import * as subscriptions from '../../utils/vendorSubscriptions'
import * as commercial from '../../utils/vendorCommercial'
import { invoiceStatusBadge } from '@nasq/commercial-ui/app/utils/commercialBadges'
import { cadenceLabel, formatCommercialMoney } from '@nasq/commercial-ui/app/utils/commercial'
import { paymentAttemptBadge, customerDisplayBadge, operationStatusBadge } from '../../utils/vendorBadges'
import { safeReturnTo } from '@nasq/ui/app/utils/safeReturnTo'
import { formatNasqDate, formatNasqDateTime } from '@nasq/ui/app/composables/calendarDate'

const transpile = (s: string) => ts.transpileModule(s, { compilerOptions: { target: ts.ScriptTarget.ES2020, module: ts.ModuleKind.None } }).outputText
const stripImports = (s: string) => s.replace(/^import\s[\s\S]*?from\s*['"][^'"]+['"];?\s*$/gm, '')
const scopes: Vue.EffectScope[] = []
afterEach(() => scopes.splice(0).forEach(s => s.stop()))
const order = { id: 'order/1', kind: 'new', payment_state: 'awaiting_payment', fulfillment_state: 'not_started' }
const subscription = { id: 'sub1', applied: null, target: null, pending_order: order, revision: 1 }
const customer = { id: 'customer1', name: 'Customer', subscription, tenant_id: null }
const money = { minor: 12345, exponent: 2, currency: 'SAR' }
const invoice = { id: 'invoice1', order_id: 'order/1', customer_id: 'customer1', status: 'issued', kind: 'initial', total: money, subtotal: money, tax: money, period_start: '2026-10-01', period_end: '2026-11-01', lines: [] }
const plan = { id: 'plan2', name: 'New plan', included_bundle_revision_ids: ['bundle2'], prices: [{ cadence: { unit: 'month', count: 1 }, amount: money }] }
const attempt = { id: 'attempt1', order_id: order.id, invoice_id: invoice.id, status: 'pending', amount: money, created_at: '2026-10-04T12:34:00Z', provider_ref: 'private-provider-reference', redirect_url: 'https://private.example/pay' }

async function page(name: string, options: { path?: string; grants?: string[]; subscription?: unknown; orderId?: string | null; attempts?: unknown[]; attemptsError?: unknown; attemptsLoading?: boolean; hydrated?: boolean } = {}) {
  const filename = resolve(import.meta.dirname, '..', name)
  const descriptor = parse(readFileSync(filename, 'utf8'), { filename }).descriptor
  const script = stripImports(compileScript(descriptor, { id: 'admin-repairs' }).content).replaceAll('import.meta.client', 'false').replace('export default', 'return')
  let current = structuredClone(options.subscription ?? subscription)
  const calls: string[] = []
  const api = {
    customer: vi.fn(async () => { calls.push('customer'); return { ...customer, subscription: current } }),
    subscription: vi.fn(async () => { calls.push('subscription'); return current }),
    branches: vi.fn(async () => null), usage: vi.fn(async () => null), listInvoices: vi.fn(async () => ({ items: [], total: 0 })),
    invoice: vi.fn(async () => ({ ...invoice, order_id: options.orderId === undefined ? invoice.order_id : options.orderId })),
    paymentAttempts: vi.fn(async () => { if (options.attemptsError) throw options.attemptsError; return { items: options.attempts ?? [attempt], total: (options.attempts ?? [attempt]).length } }),
    changeQuote: vi.fn(async () => ({ id: 'new-quote' })), placeOrder: vi.fn(async () => order),
    listCustomers: vi.fn(async () => ({ items: [], total: 0 })),
    cancelOrder: vi.fn(async () => { calls.push('cancel'); current = { ...current, pending_order: null }; return order }),
  }
  const hydrated = Vue.ref(options.hydrated ?? true)
  const slots = new Map<string, unknown>()
  const bindings = {
    formatNasqDate, formatNasqDateTime,
    invoiceStatusBadge, paymentAttemptBadge, customerDisplayBadge, operationStatusBadge, formatCommercialMoney, cadenceLabel,
    ...subscriptions, ...commercial, _defineComponent: Vue.defineComponent, _withAsyncContext: (fn: () => unknown) => [fn(), () => {}],
    computed: Vue.computed, ref: Vue.ref, watch: Vue.watch, reactive: Vue.reactive, onMounted: () => {}, onBeforeUnmount: () => {}, safeReturnTo, sharedTenantLoginUrl: () => null, buildVendorPolicy: () => ({}),
    definePageMeta: () => {}, useHydrated: () => hydrated,
    useI18n: () => ({ t: (key: string) => key, locale: Vue.ref('en') }),
    useRoute: () => ({ params: { id: 'customer1' }, path: options.path ?? '/customers/customer1', query: { returnTo: '/customers?state=active' }, fullPath: '/customers/customer1?returnTo=%2Fcustomers' }),
    useVendorContext: () => ({ sharedOnboardingEnabled: Vue.ref(false), can: (grant: string) => (options.grants ?? ['vendor.read', 'vendor.billing.manage', 'vendor.subscriptions.manage']).includes(grant) }),
    useVendorSubscriptions: () => api,
    useVendorCommercial: () => ({ listPlans: async () => ({ items: [plan] }), releases: async () => [] }),
    useVendorApi: () => ({ request: async (path: string) => path === 'catalog' ? { items: [] } : { tenants: 1, available_operations: [] } }),
    refreshNuxtData: vi.fn(), navigateTo: vi.fn(),
    createError: (error: unknown) => error,
    useAsyncData: async (key: string | (() => string), fn: () => Promise<unknown>) => {
      const name = typeof key === 'function' ? key() : key
      const data = Vue.ref<unknown>(null); const error = Vue.ref<unknown>(null); const pending = Vue.ref(false)
      const refresh = vi.fn(async () => { pending.value = true; try { data.value = await fn(); error.value = null } catch (e) { error.value = e } finally { pending.value = false } })
      await refresh()
      if (name.includes('attempt') && options.attemptsLoading) pending.value = true
      const result = { data, error, pending, refresh }; slots.set(name, result); return result
    },
  }
  const component = new Function(...Object.keys(bindings), transpile(script))(...Object.values(bindings))
  const scope = Vue.effectScope(); scopes.push(scope)
  const state = await scope.run(() => component.setup({}, { expose: () => {} }))
  const template = compileTemplate({ source: descriptor.template!.content, filename, id: 'admin-repairs', compilerOptions: { mode: 'function', expressionPlugins: ['typescript'] } })
  const render = new Function('Vue', transpile(template.code))(Vue)
  async function rendered() {
    const captured: { name: string; props: Record<string, unknown> }[] = []
    const app = Vue.createSSRApp(Vue.defineComponent({ setup: () => Object.fromEntries(Object.entries(state).filter(([key]) => !key.startsWith('$'))), render }))
    for (const name of new Set([...descriptor.template!.content.matchAll(/<([A-Z]\w*)/g)].map(m => m[1]!))) app.component(name, Vue.defineComponent({ inheritAttrs: false, setup(_, { attrs, slots }) {
      return () => { captured.push({ name, props: { ...attrs } }); return Vue.h('div', [name === 'NuxtPage' ? 'NESTED PAGE' : null, attrs.title as string, attrs.description as string, name === 'SharedStatusBadge' ? attrs.label as string : null, name === 'SharedPageState' && (attrs.loading || attrs.error) ? (attrs.loading ? 'LOADING' : 'ERROR') : slots.default?.(), slots.header?.(), slots.actions?.(), name === 'SharedRecordPage' ? slots.aside?.() : null]) }
    } }))
    return { html: await renderToString(app), captured }
  }
  return { state, api, calls, hydrated, slots, rendered }
}

function apiWith(request: ReturnType<typeof vi.fn>) {
  const source = stripImports(readFileSync(resolve(import.meta.dirname, '../../composables/useVendorSubscriptions.ts'), 'utf8')).replace('export function', 'function')
  const bindings = {
    invoiceStatusBadge, paymentAttemptBadge, customerDisplayBadge, operationStatusBadge, ...subscriptions, ...commercial, useVendorApi: () => ({ request }) }
  return new Function(...Object.keys(bindings), transpile(`${source}\nreturn useVendorSubscriptions()`))(...Object.values(bindings))
}

describe('commercial request contracts', () => {
  it('loads the encoded by-id customer, never scans a paginated list', async () => {
    const request = vi.fn(async () => customer)
    expect(await apiWith(request).customer('c/5001')).toEqual(customer)
    expect(request.mock.calls).toEqual([['commercial/customers/c%2F5001']])
  })
  it('returns null only for missing customers and propagates outages', async () => {
    const request = vi.fn().mockRejectedValueOnce({ statusCode: 404 }).mockRejectedValueOnce({ status: 503 })
    const api = apiWith(request)
    await expect(api.customer('missing')).resolves.toBeNull()
    await expect(api.customer('outage')).rejects.toEqual({ status: 503 })
  })
  it('sends trimmed cancellation reason and reads typed payment attempts for the order', async () => {
    const request = vi.fn().mockResolvedValueOnce(order).mockResolvedValueOnce({ items: [attempt], total: 1 })
    const api = apiWith(request)
    expect(await api.cancelOrder('order/1', '  customer request  ')).toEqual(order)
    expect(await api.paymentAttempts('order/1')).toEqual({ items: [attempt], total: 1 })
    expect(request.mock.calls).toEqual([['commercial/orders/order%2F1/cancel', { method: 'POST', body: { reason: 'customer request' } }], ['commercial/orders/order%2F1/payment-attempts']])
  })
})

describe('customer detail repairs', () => {
  it.each(['/customers/customer1/change', '/customers/customer1/change/', '/customers/customer1/terms/new'])('renders nested route %s through NuxtPage', async path => {
    const result = await page('customers/[id].vue', { path })
    const { html, captured } = await result.rendered()
    expect(html).toContain('NESTED PAGE')
    expect(captured.some(c => c.name === 'SharedRecordPage')).toBe(false)
  })
  it('keeps customer detail and filtered back target on its own route', async () => {
    const { captured, html } = await (await page('customers/[id].vue')).rendered()
    expect(html).not.toContain('NESTED PAGE')
    expect(captured.find(c => c.name === 'SharedRecordPage')?.props['back-to']).toBe('/customers?state=active')
  })
  it.each([['paid', 'not_started'], ['failed', 'not_started'], ['awaiting_payment', 'queued']])('never offers cancellation for %s/%s', async (payment_state, fulfillment_state) => {
    const p = await page('customers/[id].vue', { subscription: { ...subscription, pending_order: { ...order, payment_state, fulfillment_state } } })
    expect((await p.rendered()).html).not.toContain('vendor.customers.cancelOrder.action')
  })
  it('hides and rejects cancellation of an unpaid renewal order', async () => {
    const p = await page('customers/[id].vue', { subscription: { ...subscription, pending_order: { ...order, kind: 'renewal' } } })
    expect((await p.rendered()).html).not.toContain('vendor.customers.cancelOrder.action')
    p.state.cancelOpen.value = true; p.state.cancelReason.value = 'cancel renewal'
    await p.state.cancelPendingOrder()
    expect(p.api.cancelOrder).not.toHaveBeenCalled()
  })
  it('requires grant, hydration and reason, then refreshes truth without optimistic cancellation', async () => {
    const p = await page('customers/[id].vue')
    expect((await p.rendered()).html).toContain('vendor.customers.cancelOrder.action')
    p.state.cancelOpen.value = true
    await p.state.cancelPendingOrder()
    expect(p.api.cancelOrder).not.toHaveBeenCalled()
    p.state.cancelReason.value = '  changed choice  '
    expect((await p.rendered()).captured.find(c => c.name === 'SharedUnsavedChanges')?.props.dirty).toBe(true)
    p.hydrated.value = false
    await p.state.cancelPendingOrder(); expect(p.api.cancelOrder).not.toHaveBeenCalled()
    p.hydrated.value = true
    let finish!: () => void
    p.api.cancelOrder.mockImplementationOnce(() => new Promise(resolve => { finish = () => resolve(order) }))
    const inflight = p.state.cancelPendingOrder()
    expect(p.state.view.value.pending_order.id).toBe(order.id)
    expect((await p.rendered()).captured.find(c => c.name === 'SharedInlineConfirm')?.props.pending).toBe(true)
    finish(); await inflight
    expect(p.api.cancelOrder).toHaveBeenCalledWith(order.id, 'changed choice')
    expect(p.calls.slice(-2)).toEqual(['customer', 'subscription'])
    expect(p.state.cancelReason.value).toBe('')
  })
  it('offers reselection once an initial unpaid order is cancelled', async () => {
    const p = await page('customers/[id].vue')
    p.state.cancelOpen.value = true; p.state.cancelReason.value = 'reselect plan'
    await p.state.cancelPendingOrder()
    const { html } = await p.rendered()
    expect(html).not.toContain('vendor.customers.cancelOrder.action')
    expect(html).toContain('vendor.customers.changeSubscription')
    const next = await page('customers/[id]/change.vue', { subscription: { ...subscription, pending_order: null } })
    next.state.planId.value = 'plan2'
    await Vue.nextTick()
    await next.state.recompute()
    expect(next.api.changeQuote).not.toHaveBeenCalled()
    next.state.cadence.value = 'month:1'
    await next.state.recompute()
    expect(next.api.changeQuote).toHaveBeenCalledWith({ customer_id: 'customer1', kind: 'new', subscription_id: 'sub1', expected_subscription_revision: 1, plan_revision_id: 'plan2', bundle_revision_ids: ['bundle2'], cadence: { unit: 'month', count: 1 }, requested_extra_branches: 0 })
    await next.state.place()
    expect(next.api.placeOrder).toHaveBeenCalledWith(expect.objectContaining({ quote_id: 'new-quote', expected_subscription_revision: 1, idempotency_key: expect.any(String) }))
  })
  it('clears the previous quote and freezes selections until a fresh quote resolves', async () => {
    const p = await page('customers/[id]/change.vue', { subscription: { ...subscription, pending_order: null } })
    p.state.planId.value = 'plan2'; await Vue.nextTick(); p.state.cadence.value = 'month:1'
    p.state.quote.value = { id: 'old-quote' }
    let finish!: () => void
    p.api.changeQuote.mockImplementationOnce(() => new Promise(resolve => { finish = () => resolve({ id: 'fresh-quote' }) }))
    const pending = p.state.recompute()
    expect(p.state.quote.value).toBeNull()
    const { captured } = await p.rendered()
    expect(captured.filter(c => ['USelect', 'UInput'].includes(c.name)).every(c => c.props.disabled)).toBe(true)
    await p.state.place(); expect(p.api.placeOrder).not.toHaveBeenCalled()
    finish(); await pending
    expect(p.state.quote.value.id).toBe('fresh-quote')
  })
  it('preserves applied subscription change requests', async () => {
    const applied = { plan_revision_id: 'plan1', bundle_revision_ids: ['bundle1'], cadence: { unit: 'year', count: 1 }, extra_branch_count: 2 }
    expect(subscriptions.customerQuoteBody('customer1', { ...subscription, applied } as never, { planRevisionId: 'plan2', extraBranches: 3 })).toEqual({ customer_id: 'customer1', kind: 'change', subscription_id: 'sub1', expected_subscription_revision: 1, plan_revision_id: 'plan2', bundle_revision_ids: ['bundle1'], cadence: { unit: 'year', count: 1 }, requested_extra_branches: 3 })
  })
  it('hides financial actions and invoice requests without grants', async () => {
    const p = await page('customers/[id].vue', { grants: ['vendor.read'] })
    const { html } = await p.rendered()
    expect(html).not.toContain('vendor.customers.cancelOrder.action')
    expect(html).not.toContain('vendor.customers.sections.invoices')
    expect(p.api.listInvoices).not.toHaveBeenCalled()
  })
  it.each(['order_not_cancellable', 'payment_reconciliation_required', 'provider_mismatch', 'reason_required'])('keeps %s retryable and reloads current truth', async code => {
    const p = await page('customers/[id].vue')
    p.state.cancelOpen.value = true; p.state.cancelReason.value = 'changed choice'
    p.api.cancelOrder.mockRejectedValueOnce({ statusCode: 409, data: { code } })
    await p.state.cancelPendingOrder()
    expect(p.state.cancelFailure.value).toBe(`vendor.customers.cancelOrder.errors.${code}`)
    expect(p.state.cancelReason.value).toBe('changed choice')
    expect(p.state.view.value.pending_order.id).toBe(order.id)
    expect(p.calls.slice(-2)).toEqual(['customer', 'subscription'])
    expect((await p.rendered()).html).toContain(`vendor.customers.cancelOrder.errors.${code}`)
  })
})

describe('invoice payment attempts', () => {
  it('renders actual status, amount and time without provider secrets', async () => {
    const p = await page('invoices/[id].vue')
    expect(p.api.paymentAttempts).toHaveBeenCalledWith(order.id)
    const { html } = await p.rendered()
    expect(html).toContain('vendor.invoices.attemptStatus.pending'); expect(html).toContain('123.45'); expect(html).toContain('2026')
    expect(html).not.toContain('vendor.invoices.attemptsNone'); expect(html).not.toContain('private-provider'); expect(html).not.toContain('private.example')
  })
  it('shows true empty, loading and retryable error separately', async () => {
    const empty = await page('invoices/[id].vue', { attempts: [] })
    expect((await empty.rendered()).html).toContain('vendor.invoices.attemptsNone')
    const loading = await page('invoices/[id].vue', { attempts: [], attemptsLoading: true })
    expect((await loading.rendered()).html).toContain('LOADING'); expect((await loading.rendered()).html).not.toContain('vendor.invoices.attemptsNone')
    const failed = await page('invoices/[id].vue', { attemptsError: { status: 503 } })
    const { html, captured } = await failed.rendered()
    expect(html).toContain('ERROR'); expect(html).not.toContain('vendor.invoices.attemptsNone')
    const retry = captured.find(c => c.name === 'SharedPageState' && c.props.error)?.props.onRetry
    expect(retry).toBeTypeOf('function'); await (retry as () => Promise<void>)(); expect(failed.api.paymentAttempts).toHaveBeenCalledTimes(2)
  })
  it.each([{ orderId: null }, { grants: ['vendor.read'] }])('does not query attempts without an order or grant: %j', async options => {
    const p = await page('invoices/[id].vue', options)
    expect(p.api.paymentAttempts).not.toHaveBeenCalled()
  })
})

it('overview has two sections whose tiles open the list they count and no navigation buttons', async () => {
  const { captured } = await (await page('overview.vue')).rendered()
  const links = captured.filter(c => c.name === 'NuxtLink').map(c => c.props.to)
  expect(links).toEqual(['/operations?status=attention', '/customers?state=setup_required', '/tenants', '/tenants', '/operations?status=pending', '/customers?state=active'])
  expect(captured.filter(c => c.name === 'SharedMetricTile').map(c => c.props.label)).toEqual([
    'vendor.overview.failed', 'vendor.overviewCommercial.pastDue', 'vendor.overviewCommercial.stalled', 'vendor.overviewCommercial.setup',
    'vendor.overview.tenants', 'vendor.overview.active', 'vendor.overview.pending', 'vendor.overviewCommercial.active', 'vendor.overviewCommercial.pending', 'vendor.overviewCommercial.renewals',
  ])
  expect(captured.some(c => c.name === 'UButton')).toBe(false)
})

it('finds a tenant customer by tenant filter rather than a bounded newest-customer scan', async () => {
  const p = await page('tenants/[id].vue')
  expect(p.api.listCustomers).toHaveBeenCalledWith({ tenant_id: 'customer1', limit: 1 })
})
