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
    InboxOrderActions: {}, InboxOrderLines: {}, InboxOrderEditor: {}, InboxProductPicker: {}, ref: Vue.ref, reactive: Vue.reactive, computed: Vue.computed, watch: Vue.watch,
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

describe('InboxOrderActions', () => {
  function mount(props: Record<string, unknown>, can = true) {
    const checkout = vi.fn(async (_input: unknown) => ({}))
    const cancel = vi.fn()
    const state = run('InboxOrderActions.vue', {
      useAccess: () => ({ can: () => can }),
      useInboxOrder: () => ({ data: Vue.ref(undefined), isPending: Vue.ref(false), error: Vue.ref(null), refetch: vi.fn() }),
      useInboxTemplates: () => ({ data: Vue.ref({ items: [
        { id: 4, name: 'pay', language: 'ar', supported: true, buttons: [{ type: 'url', url: 'https://x.test/pay/order/{{1}}' }] },
        { id: 5, name: 'other', language: 'ar', supported: true, buttons: [{ type: 'url', url: 'https://x.test/a/{{1}}' }] },
      ], total: 2 }) }),
      useCheckoutInboxOrder: () => ({ mutateAsync: checkout, isPending: Vue.ref(false) }),
      useCancelInboxOrder: () => ({ mutate: cancel, isPending: Vue.ref(false) }),
    }, { orderId: 7, state: 'cart', paymentStatus: null, conversationId: 3, channelId: 1, windowOpen: true, ...props })
    return { state, checkout, cancel }
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

  it('needs a pay-link template once the window has closed, and offers only those', async () => {
    const { state, checkout } = mount({ windowOpen: false })
    state.step = 'checkout'
    expect(state.payTemplates.map((entry: { value: number }) => entry.value)).toEqual([4])
    expect(state.checkoutReady).toBe(false)
    await state.submitCheckout()
    expect(checkout).not.toHaveBeenCalled()
    state.templateId = 4
    await state.submitCheckout()
    expect(checkout).toHaveBeenCalledWith({ id: 7, body: { template_id: 4 } })
  })

  it('cancels only after the inline confirmation', () => {
    const { state, cancel } = mount({})
    state.step = 'cancel'
    state.confirmCancel()
    expect(cancel).toHaveBeenCalledWith(7, expect.objectContaining({ onSuccess: expect.any(Function) }))
  })
})
