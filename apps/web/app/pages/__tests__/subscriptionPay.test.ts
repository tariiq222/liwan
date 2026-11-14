import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { compileScript, compileTemplate, parse } from '@vue/compiler-sfc'
import { renderToString } from '@vue/server-renderer'
import ts from 'typescript'
import * as Vue from 'vue'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import * as cardPayment from '../../utils/cardPayment'
import * as subscriptionUtils from '../../utils/subscription'

// The pay page's own script runs here with a mocked API and the Nuxt auto-imports stood in for, and its template is rendered with
// plain stand-ins for the components. This tests the page's state machine, not the source text.
const filename = resolve(import.meta.dirname, '../subscription/pay/[order].vue')
const descriptor = parse(readFileSync(filename, 'utf8'), { filename }).descriptor
const transpile = (source: string) => ts.transpileModule(source, { compilerOptions: { target: ts.ScriptTarget.ES2020, module: ts.ModuleKind.None } }).outputText
const stripImports = (source: string) => source.replace(/^import\s[\s\S]*?from\s*['"][^'"]+['"];?\s*$/gm, '')
const script = stripImports(compileScript(descriptor, { id: 'subscription-pay' }).content).replaceAll('import.meta.client', 'true').replace('export default', 'return')
const template = compileTemplate({ source: descriptor.template!.content, filename, id: 'subscription-pay', compilerOptions: { mode: 'function', expressionPlugins: ['typescript'] } })
const render = new Function('Vue', transpile(template.code))(Vue)

const money = { minor: 34_500, currency: 'SAR', exponent: 2 }
const unpaid = { id: 'order-1', kind: 'new', payment_state: 'awaiting_payment', fulfillment_state: 'not_started', cancelled: false, due_now: money, created_at: '2026-11-14T08:00:00.000Z' }
const invoice = { id: 'inv-1', number: 'INV-0001', order_id: 'order-1', status: 'issued', total: money }
const session = { attempt_id: 'attempt-1', intent: { id: 'intent-1', client_secret: 'secret-1' }, publishable_key: 'pk_test_abc', amount: money, expires_at: '2099-01-01T00:00:00.000Z' }
const refused = (code: string, statusCode = 409) => Object.assign(new Error(code), { statusCode, data: { code } })

const scopes: Vue.EffectScope[] = []
beforeEach(() => vi.useFakeTimers())
afterEach(() => { scopes.splice(0).forEach(scope => scope.stop()); vi.useRealTimers() })

type Options = { capabilities?: string[]; order?: Record<string, unknown> | null; hydrated?: boolean }
async function mountPage(options: Options = {}) {
  const current = { order: options.order === undefined ? { ...unpaid } : options.order }
  const api = {
    order: vi.fn(async () => { if (!current.order) throw Object.assign(new Error('missing'), { statusCode: 404 }); return { ...current.order } }),
    invoices: vi.fn(async () => ({ items: [invoice], total: 1 })),
    startCardPayment: vi.fn(async (_order: string, _saveCard: boolean) => session),
  }
  const capabilities = options.capabilities ?? ['subscription.read', 'subscription.manage', 'billing.read']
  const store = new Map<string, string>()
  const mounted: Array<() => void> = []
  const unmounting: Array<() => void> = []
  const navigateTo = vi.fn()
  const bindings = {
    ...cardPayment, ...subscriptionUtils, _defineComponent: Vue.defineComponent, _withAsyncContext: (fn: () => unknown) => [fn(), () => {}],
    ref: Vue.ref, computed: Vue.computed, watch: Vue.watch,
    onMounted: (fn: () => void) => mounted.push(fn), onBeforeUnmount: (fn: () => void) => unmounting.push(fn),
    definePageMeta: () => {}, navigateTo,
    window: { sessionStorage: { getItem: (key: string) => store.get(key) ?? null, setItem: (key: string, value: string) => void store.set(key, value), removeItem: (key: string) => void store.delete(key) } },
    useI18n: () => ({ t: (key: string) => key, locale: Vue.ref('en') }),
    useRoute: () => ({ params: { order: 'order-1' }, path: '/subscription/pay/order-1' }),
    useSubscriptionApi: () => api,
    useCustomerCapabilities: () => ({ can: (capability: string) => capabilities.includes(capability) }),
    useHydrated: () => Vue.ref(options.hydrated ?? true),
    useAsyncData: async (_key: unknown, fn: () => Promise<unknown>) => {
      const data = Vue.ref<unknown>(null); const error = Vue.ref<unknown>(null); const pending = Vue.ref(false)
      const refresh = vi.fn(async () => { try { data.value = await fn(); error.value = null } catch (cause) { error.value = cause } })
      await refresh()
      return { data, error, pending, refresh }
    },
  }
  const component = new Function(...Object.keys(bindings), transpile(script))(...Object.values(bindings))
  const scope = Vue.effectScope(); scopes.push(scope)
  const state = await scope.run(() => component.setup({}, { expose: () => {} }))
  mounted.forEach(fn => fn())
  const forms: Array<{ props: Record<string, unknown>; expire: () => void }> = []
  async function html() {
    const app = Vue.createSSRApp(Vue.defineComponent({ setup: () => Object.fromEntries(Object.entries(state).filter(([key]) => !key.startsWith('$'))), render }))
    for (const name of new Set([...descriptor.template!.content.matchAll(/<([A-Z]\w*)/g)].map(match => match[1]!))) {
      app.component(name, Vue.defineComponent({
        name, inheritAttrs: false, emits: ['expired'],
        setup(_, { attrs, slots, emit }) {
          return () => {
            if (name === 'SubscriptionPaymentForm') forms.push({ props: { ...attrs }, expire: () => emit('expired') })
            const text = [attrs.title, attrs.description, attrs.label].filter(Boolean).join(' ')
            const hidden = name === 'SharedPageState' && (attrs.loading || attrs.error)
            return Vue.h('div', { 'data-testid': attrs['data-testid'] as string | undefined, 'data-component': name, 'data-save-card': attrs['save-card'] as string | undefined }, [text, hidden ? 'LOADING' : slots.default?.(), slots.actions?.()])
          }
        },
      }))
    }
    return renderToString(app)
  }
  return { state, api, current, navigateTo, unmounting, store, html, forms }
}

const settle = () => vi.advanceTimersByTimeAsync(0)

describe('the pay page opened', () => {
  it('shows the amount, both ways to pay, and sends nothing', async () => {
    const page = await mountPage()
    const html = await page.html()
    expect(html).toContain('data-testid="pay-choose"'); expect(html).toContain('data-testid="pay-by-transfer"'); expect(html).toContain('pay-transfer-link')
    expect(html).toContain('INV-0001')
    expect(page.api.startCardPayment).not.toHaveBeenCalled()
  })
  it('an order that is already paid goes to its status page', async () => {
    const page = await mountPage({ order: { ...unpaid, payment_state: 'paid', fulfillment_state: 'queued' } })
    expect(page.navigateTo).toHaveBeenCalledWith({ path: '/subscription/status', query: { order: 'order-1' } }, { replace: true })
  })
  it('an unknown order says so and offers no form', async () => {
    const page = await mountPage({ order: null })
    const html = await page.html()
    expect(html).toContain('data-testid="pay-not-found"'); expect(html).not.toContain('pay-continue')
  })
  it('a user without subscription.manage sees no form, is told who to ask, and sends nothing', async () => {
    const page = await mountPage({ capabilities: ['subscription.read', 'billing.read'] })
    const html = await page.html()
    expect(html).toContain('data-testid="pay-no-permission"'); expect(html).not.toContain('pay-continue'); expect(html).not.toContain('pay-by-card')
    await page.state.start()
    expect(page.api.startCardPayment).not.toHaveBeenCalled()
  })
})

describe('opening the card form', () => {
  it('mounts the form with the choice made, and records that this tab opened it', async () => {
    const page = await mountPage()
    page.state.saveCard.value = true
    await page.state.start()
    expect(page.api.startCardPayment).toHaveBeenCalledOnce()
    expect(page.api.startCardPayment).toHaveBeenCalledWith('order-1', true)
    expect(page.state.phase.value).toBe('form')
    expect(await page.html()).toContain('data-component="SubscriptionPaymentForm"')
    expect(page.store.get('liwan:pay:started:order-1')).toBe('1')
  })
  it('a double click sends one request', async () => {
    const page = await mountPage()
    let release: (value: typeof session) => void = () => {}
    page.api.startCardPayment.mockImplementationOnce(() => new Promise(resolve => { release = resolve }))
    const first = page.state.start(); const second = page.state.start()
    release(session)
    await Promise.all([first, second])
    expect(page.api.startCardPayment).toHaveBeenCalledTimes(1)
    expect(page.state.phase.value).toBe('form')
  })
  it('a plan without automatic renewal: the retry really runs, sends save_card false, mounts the form and says the card is not saved, beside it', async () => {
    const page = await mountPage()
    page.state.saveCard.value = true
    page.api.startCardPayment.mockRejectedValueOnce(refused('auto_renew_not_allowed'))
    await page.state.start()
    expect(page.api.startCardPayment.mock.calls).toEqual([['order-1', true], ['order-1', false]])
    expect(page.state.phase.value).toBe('form')
    expect(page.state.sessionSavesCard.value).toBe(false)
    const html = await page.html()
    expect(html).toContain('data-component="SubscriptionPaymentForm"'); expect(html).toContain('data-save-card="false"')
    expect(html).toContain('data-testid="pay-auto-renew-denied"'); expect(html).toContain('subscription.pay.autoRenewNotAllowed')
    expect(html.indexOf('pay-auto-renew-denied')).toBeLessThan(html.indexOf('SubscriptionPaymentForm'))
    // The checkbox is gone for good, and the retry is not repeated if the second answer is another refusal.
    expect(html).not.toContain('pay-save-card')
  })
  it('a second refusal after the retry stops there and is shown, not retried again', async () => {
    const page = await mountPage()
    page.state.saveCard.value = true
    page.api.startCardPayment.mockRejectedValue(refused('auto_renew_not_allowed'))
    await page.state.start()
    expect(page.api.startCardPayment).toHaveBeenCalledTimes(2)
    expect(page.state.phase.value).toBe('choose'); expect(page.state.failed.value).toBe(true)
  })
  it('a network failure says nothing was charged and keeps the choice open to try again', async () => {
    const page = await mountPage()
    page.api.startCardPayment.mockRejectedValueOnce(new TypeError('fetch failed'))
    await page.state.start()
    expect(page.state.phase.value).toBe('choose')
    const html = await page.html()
    expect(html).toContain('data-testid="pay-failed"'); expect(html).toContain('subscription.pay.failed')
    const en = JSON.parse(readFileSync(resolve(import.meta.dirname, '../../../i18n/locales/en/subscription.json'), 'utf8')).subscription.pay.failed as string
    const ar = JSON.parse(readFileSync(resolve(import.meta.dirname, '../../../i18n/locales/ar/subscription.json'), 'utf8')).subscription.pay.failed as string
    expect(en).toContain('Nothing was charged'); expect(ar).toContain('لم يُخصم')
    await page.state.start()
    expect(page.state.phase.value).toBe('form')
  })
  it('card payment unavailable offers bank transfer', async () => {
    const page = await mountPage()
    page.api.startCardPayment.mockRejectedValueOnce(refused('card_form_unavailable'))
    await page.state.start()
    expect(page.state.phase.value).toBe('unavailable')
    const html = await page.html()
    expect(html).toContain('data-testid="pay-unavailable"'); expect(html).toContain('data-testid="pay-transfer-link"')
  })
  it('an order that is no longer awaiting payment goes to its status page', async () => {
    const page = await mountPage()
    page.api.startCardPayment.mockImplementationOnce(async () => { page.current.order = { ...unpaid, payment_state: 'paid', fulfillment_state: 'queued' }; throw refused('payment_not_awaiting') })
    await page.state.start()
    await settle()
    expect(page.api.order).toHaveBeenCalledTimes(2)
    expect(page.navigateTo).toHaveBeenCalledWith({ path: '/subscription/status', query: { order: 'order-1' } }, { replace: true })
  })
  it('an expired session offers to start again, and starting again returns to the choice', async () => {
    const page = await mountPage()
    await page.state.start()
    await page.html()
    page.forms.at(-1)!.expire()
    await settle()
    expect(page.state.phase.value).toBe('expired')
    expect(await page.html()).toContain('data-testid="pay-expired"')
    page.state.chooseAgain()
    expect(page.state.phase.value).toBe('choose')
  })
})

describe('a payment that may be in flight', () => {
  it('shows checking, never a second form, polls calmly, leaves when the order is paid, and stops', async () => {
    const page = await mountPage()
    page.api.startCardPayment.mockRejectedValueOnce(refused('payment_in_progress'))
    await page.state.start()
    expect(page.state.phase.value).toBe('checking')
    const html = await page.html()
    expect(html).toContain('data-testid="pay-checking"'); expect(html).not.toContain('pay-continue'); expect(html).not.toContain('SubscriptionPaymentForm')
    const before = page.api.order.mock.calls.length
    await vi.advanceTimersByTimeAsync(5000)
    expect(page.api.order.mock.calls.length).toBe(before + 1)
    page.current.order = { ...unpaid, payment_state: 'paid', fulfillment_state: 'queued' }
    await vi.advanceTimersByTimeAsync(5000)
    expect(page.navigateTo).toHaveBeenCalledWith({ path: '/subscription/status', query: { order: 'order-1' } }, { replace: true })
    expect(page.api.startCardPayment).toHaveBeenCalledTimes(1)
  })
  it('stops polling when the page is left', async () => {
    const page = await mountPage()
    page.api.startCardPayment.mockRejectedValueOnce(refused('payment_in_progress'))
    await page.state.start()
    await vi.advanceTimersByTimeAsync(5000)
    const calls = page.api.order.mock.calls.length
    page.unmounting.forEach(fn => fn())
    await vi.advanceTimersByTimeAsync(60_000)
    expect(page.api.order.mock.calls.length).toBe(calls)
  })
  it('stops after the limit and says it is still checking, without offering a second form', async () => {
    const page = await mountPage()
    page.api.startCardPayment.mockRejectedValueOnce(refused('payment_in_progress'))
    await page.state.start()
    await vi.advanceTimersByTimeAsync(3 * 60 * 1000 + 10_000)
    expect(page.state.stillChecking.value).toBe(true)
    const calls = page.api.order.mock.calls.length
    await vi.advanceTimersByTimeAsync(60_000)
    expect(page.api.order.mock.calls.length).toBe(calls)
    const html = await page.html()
    expect(html).toContain('subscription.pay.checking.still'); expect(html).not.toContain('pay-continue')
    expect(page.api.startCardPayment).toHaveBeenCalledTimes(1)
  })
})

describe('the pay route is strict about case', () => {
  it('redirects any other spelling of the path to the canonical one, in the page middleware', () => {
    expect(readFileSync(filename, 'utf8')).toMatch(/middleware: \['customer-commercial', \(to\) => \{ const canonical = canonicalPayRedirect\(to\.path\); if \(canonical\) return navigateTo\(canonical, \{ replace: true \}\) \}\]/)
    expect(cardPayment.canonicalPayRedirect('/Subscription/Pay/abc')).toBe('/subscription/pay/abc')
    expect(cardPayment.canonicalPayRedirect('/subscription/PAY/Abc/')).toBe('/subscription/pay/Abc/')
    expect(cardPayment.canonicalPayRedirect('/SUBSCRIPTION/pay/abc')).toBe('/subscription/pay/abc')
    expect(cardPayment.canonicalPayRedirect('/subscription/pay/abc')).toBeNull()
    expect(cardPayment.canonicalPayRedirect('/subscription/pay/abc/')).toBeNull()
    expect(cardPayment.canonicalPayRedirect('/subscription/status')).toBeNull()
  })
})
