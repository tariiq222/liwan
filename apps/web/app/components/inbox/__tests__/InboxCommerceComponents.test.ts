import { readFileSync } from 'node:fs'
import { compileScript, parse } from '@vue/compiler-sfc'
import ts from 'typescript'
import * as Vue from 'vue'
import { describe, expect, it, vi } from 'vitest'
import type { InboxOrder } from '@liwan/contracts'
import * as commerce from '../../../composables/inbox/inboxCommerce'

// The scripts of the commerce components, compiled and run against stubbed composables (as the other component tests do).
function run(file: string, bindings: Record<string, unknown>, props: Record<string, unknown>, emitted: Array<[string, unknown]> = []) {
  const filename = new URL(`../${file}`, import.meta.url).pathname
  const script = compileScript(parse(readFileSync(filename, 'utf8'), { filename }).descriptor, { id: file }).content
    .replace(/^import\s[\s\S]*?from\s*['"][^'"]+['"];?\s*$/gm, '').replace('export default', 'return')
  const base = {
    _defineComponent: Vue.defineComponent, _mergeModels: (Vue as unknown as Record<string, unknown>).mergeModels, _useModel: Vue.useModel, _unref: Vue.unref,
    InboxOrderActions: {}, InboxOrderCustomerStep: {}, InboxOrderLines: {}, InboxOrderEditor: {}, InboxProductPicker: {}, InboxTemplatePicker: {}, ref: Vue.ref, reactive: Vue.reactive, computed: Vue.computed, watch: Vue.watch,
    useI18n: () => ({ t: (key: string) => key, locale: Vue.ref('en') }), useHydrated: () => Vue.ref(true), useToast: () => ({ add: vi.fn() }), ...commerce, ...bindings,
  }
  const code = ts.transpileModule(script, { compilerOptions: { module: ts.ModuleKind.None, target: ts.ScriptTarget.ES2022 } }).outputText
  const component = new Function(...Object.keys(base), code)(...Object.values(base))
  return Vue.proxyRefs(Vue.effectScope().run(() => component.setup(Vue.reactive(props), { expose: () => {}, emit: (name: string, value: unknown) => emitted.push([name, value]) })))
}

const item = (id: number) => ({ id, product_retailer_id: `wv-${id}`, name: `منتج ${id}`, price: 10, currency: 'SAR', availability: 'in_stock', image_url: null })

describe('InboxProductPicker', () => {
  it('reports a tap and locks the unpicked products once the limit is reached', () => {
    const emitted: Array<[string, unknown]> = []
    const state = run('InboxProductPicker.vue', {}, { items: [item(1), item(2)], picked: ['wv-1'], max: 1 }, emitted)
    expect(state.full).toBe(true)
    expect(state.isPicked(item(1))).toBe(true)
    expect(state.isPicked(item(2))).toBe(false)
  })

  it('stays open below the limit', () => {
    const state = run('InboxProductPicker.vue', {}, { items: [item(1)], picked: [], max: commerce.COMMERCE_LIMITS.products })
    expect(state.full).toBe(false)
  })
})

describe('InboxOrderCard', () => {
  const order = (overrides: Partial<InboxOrder> = {}): InboxOrder => ({
    id: 1, conversation_id: 3, channel: { id: 1, name: 'قناة' }, contact: { id: 2, name: 'ليلى' }, message_id: 9, state: 'cart', reference: null,
    lines: [{ id: 1, product_retailer_id: 'wv-1', catalog_item_id: 1, name: 'قهوة', quantity: 2, cart_price: 45, unit_price: 50, currency: 'SAR', availability: 'in_stock' }],
    cart_total: 90, cart_currency: 'SAR', total: 100, currency: 'SAR', price_changed: true, payment: null, pay_link_sent_at: null, created_by: null, created_at: '2026-10-29T08:00:00Z', ...overrides,
  })
  const payable = { status: 'payable' as const, refund_due: false, needs_attention: false, currency: 'SAR', amount_total: 100, amount_due: 100, expires_at: '2026-10-29T10:30:00Z' }
  const NOW = Date.parse('2026-10-29T10:00:00Z')

  it('shows a cart by its state, and an order by its payment', () => {
    expect(run('InboxOrderCard.vue', {}, { order: order() }).badge.labelKey).toBe('inbox.orders.state.cart')
    const paid = run('InboxOrderCard.vue', {}, { order: order({ state: 'ordered', reference: 'S00012', payment: { ...payable, status: 'paid' } }) })
    expect(paid.badge).toEqual({ tone: 'success', labelKey: 'inbox.orders.payment.paid' })
    expect(paid.countdown).toBeNull()
  })

  it('counts down an unpaid order and reports it expired', () => {
    const open = run('InboxOrderCard.vue', {}, { order: order({ state: 'ordered', payment: payable }), now: NOW })
    expect(open.countdown).toEqual({ expired: false, minutes: 30 })
    const late = run('InboxOrderCard.vue', {}, { order: order({ state: 'ordered', payment: { ...payable, expires_at: '2026-10-29T09:00:00Z' } }), now: NOW })
    expect(late.countdown).toEqual({ expired: true, minutes: 0 })
  })

  it('flags the unknown product of a line', () => {
    const state = run('InboxOrderCard.vue', {}, { order: order({ lines: [{ id: 2, product_retailer_id: 'x', catalog_item_id: null, name: null, quantity: 1, cart_price: 5, unit_price: null, currency: 'SAR', availability: null }] }) })
    expect(state.rows[0]).toMatchObject({ unknown: true, name: 'x' })
  })
})

describe('InboxOrderCustomerStep', () => {
  const candidates = [{ id: 5, name: 'منى', phone_last4: '0003' }, { id: 6, name: 'منى سعد', phone_last4: null }]

  it('lists each candidate by name and phone ending, then the new customer last', () => {
    const state = run('InboxOrderCustomerStep.vue', {}, { candidates })
    expect(state.items).toEqual([
      { value: '5', label: 'منى', description: 'inbox.orders.customer.phoneEnds' },
      { value: '6', label: 'منى سعد', description: 'inbox.orders.customer.noPhone' },
      { value: 'new', label: 'inbox.orders.customer.new', description: 'inbox.orders.customer.newHint' },
    ])
  })

  it('answers only once something is picked', () => {
    const emitted: Array<[string, unknown]> = []
    const state = run('InboxOrderCustomerStep.vue', {}, { candidates }, emitted)
    state.confirm()
    expect(emitted).toEqual([])
    state.choice = 'new'
    state.confirm()
    expect(emitted).toEqual([['choose', 'new']])
  })
})

describe('InboxOrderActions', () => {
  function mount(props: Record<string, unknown>, can = true, answer: (input: unknown) => Promise<unknown> = async () => ({})) {
    const checkout = vi.fn(answer)
    const cancel = vi.fn()
    const toasts: Array<{ title: string; color: string }> = []
    const state = run('InboxOrderActions.vue', {
      useToast: () => ({ add: (toast: { title: string; color: string }) => toasts.push(toast) }),
      useAccess: () => ({ can: () => can }),
      useInboxOrder: () => ({ data: Vue.ref(undefined), isPending: Vue.ref(false), error: Vue.ref(null), refetch: vi.fn() }),
      useCheckoutInboxOrder: () => ({ mutateAsync: checkout, isPending: Vue.ref(false) }),
      useCancelInboxOrder: () => ({ mutate: cancel, isPending: Vue.ref(false) }),
    }, { orderId: 7, state: 'cart', paymentStatus: null, conversationId: 3, channelId: 1, windowOpen: true, ...props })
    return { state, checkout, cancel, toasts }
  }

  it('offers the actions only to an order manager, for a cart or an unpaid order', () => {
    expect(mount({}).state.manage).toBe(true)
    expect(mount({}, false).state.manage).toBe(false)
    expect(mount({ state: 'cart' }).state.isCart).toBe(true)
    expect(mount({ state: 'ordered', paymentStatus: 'payable' }).state.unpaid).toBe(true)
    expect(mount({ state: 'ordered', paymentStatus: 'paid' }).state.unpaid).toBe(false)
  })

  it('sends the link as a message inside the window', async () => {
    const { state, checkout } = mount({})
    state.step = 'checkout'
    expect(state.checkoutReady).toBe(true)
    state.body = ' ادفع من هنا '
    await state.submitCheckout()
    expect(checkout).toHaveBeenCalledWith({ id: 7, body: { body: 'ادفع من هنا' } })
    expect(state.step).toBeNull()
  })

  it('needs a pay-link template once the window has closed', async () => {
    const { state, checkout } = mount({ windowOpen: false })
    state.step = 'checkout'
    expect(state.checkoutReady).toBe(false)
    await state.submitCheckout()
    expect(checkout).not.toHaveBeenCalled()
    state.templateId = 4 // chosen in the picker, which searches the channel's templates on the server
    await state.submitCheckout()
    expect(checkout).toHaveBeenCalledWith({ id: 7, body: { template_id: 4 } })
  })

  const refusal = (status: number, code: string, details?: unknown) => Object.assign(new Error('refused'), { status, code, details })
  const candidates = [{ id: 5, name: 'منى', phone_last4: '0003' }, { id: 6, name: 'منى سعد', phone_last4: '0003' }]

  it('stops at the customer step when the phone matches customers, and sends nothing else', async () => {
    const { state, toasts } = mount({}, true, async () => { throw refusal(409, 'conflict', { candidates }) })
    state.step = 'checkout'
    await state.submitCheckout()
    expect(state.step).toBe('customer')
    expect(state.candidates).toEqual(candidates)
    expect(toasts).toEqual([])
  })

  it('repeats the checkout with the chosen customer, keeping the link message', async () => {
    const { state, checkout } = mount({})
    state.step = 'customer'
    state.body = 'ادفع'
    await state.chooseCustomer('6')
    expect(checkout).toHaveBeenCalledWith({ id: 7, body: { body: 'ادفع', customer_id: 6 } })
    expect(state.step).toBeNull()
  })

  it('asks for a new customer with create_new', async () => {
    const { state, checkout } = mount({ windowOpen: false })
    state.step = 'customer'
    state.templateId = 4
    await state.chooseCustomer('new')
    expect(checkout).toHaveBeenCalledWith({ id: 7, body: { template_id: 4, create_new: true } })
  })

  it('goes back to the form when a chosen customer is gone, with the clear message', async () => {
    const { state, toasts } = mount({}, true, async () => { throw refusal(404, 'not_found') })
    state.step = 'customer'
    await state.chooseCustomer('5')
    expect(state.step).toBe('checkout')
    expect(toasts).toEqual([{ title: 'inbox.orders.customer.notFound', color: 'error' }])
  })

  it('tells the agent what to do when the contact phone is not valid', async () => {
    const { state, toasts } = mount({}, true, async () => { throw refusal(422, 'invalid_phone') })
    state.step = 'checkout'
    await state.submitCheckout()
    expect(state.step).toBe('checkout')
    expect(toasts).toEqual([{ title: 'inbox.orders.customer.invalidPhone', color: 'error' }])
  })

  it('cancels only after the inline confirmation', () => {
    const { state, cancel } = mount({})
    state.step = 'cancel'
    state.confirmCancel()
    expect(cancel).toHaveBeenCalledWith(7, expect.objectContaining({ onSuccess: expect.any(Function) }))
  })
})
