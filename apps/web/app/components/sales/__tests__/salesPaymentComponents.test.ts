import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { compileScript, parse } from '@vue/compiler-sfc'
import { renderToString } from 'vue/server-renderer'
import ts from 'typescript'
import * as Vue from 'vue'
import { describe, expect, it } from 'vitest'
import { SALES_PREPAYMENT_PERCENT, SalesOrderRefundBodySchema, type SalesOrderPayment, type SalesPublicPayment } from '@liwan/contracts'
import { vueBindings } from '../../../../tests/vueBindings'
import * as errors from '../../../composables/sales/salesErrors'

// The compiled component with its script's imports supplied by name, so it runs without Nuxt's auto-imports.
function compile(file: string, inline: boolean) {
  const filename = resolve(import.meta.dirname, `../${file}`)
  const descriptor = parse(readFileSync(filename, 'utf8'), { filename }).descriptor
  const script = compileScript(descriptor, { id: file, inlineTemplate: inline }).content
    .replace(/^import\s*\{([^}]*)\}\s*from\s*['"]vue['"];?\s*$/gm, (_, names: string) => `const {${names.replace(/ as /g, ': ')}} = Vue`)
    .replace(/^import\s[\s\S]*?from\s*['"][^'"]+['"];?\s*$/gm, '').replace('export default', 'return')
  return ts.transpileModule(script, { compilerOptions: { module: ts.ModuleKind.None, target: ts.ScriptTarget.ES2022 } }).outputText
}

const globals = {
  Vue, ...vueBindings, SALES_PREPAYMENT_PERCENT, ...errors,
  useI18n: () => ({ locale: Vue.ref('en'), t: (key: string, params?: Record<string, string | number>) => params ? `${key} ${Object.values(params).join(' ')}` : key }),
  formatCurrency: (amount: number, currency: string) => `${amount.toFixed(2)} ${currency}`,
}

function stubs(app: Vue.App) {
  const passthrough = (name: string) => Vue.defineComponent({ name, inheritAttrs: true, setup: (_, { slots }) => () => Vue.h('div', { 'data-stub': name }, [slots.default?.()]) })
  app.component('UAlert', Vue.defineComponent({ props: ['title', 'description'], setup: (props, { attrs, slots }) => () => Vue.h('div', { 'data-testid': attrs['data-testid'] }, [props.title, ' | ', props.description, slots.actions?.()]) }))
  app.component('UButton', Vue.defineComponent({ props: ['to', 'label'], setup: (props, { attrs }) => () => Vue.h('a', { href: props.to, 'data-testid': attrs['data-testid'] }, props.label) }))
  app.component('SharedRecordSection', Vue.defineComponent({ props: ['title'], setup: (props, { slots, attrs }) => () => Vue.h('section', { 'data-testid': attrs['data-testid'] }, [props.title, slots.default?.()]) }))
  app.component('SharedPropertiesPanel', passthrough('SharedPropertiesPanel'))
  app.component('SharedPropertyRow', Vue.defineComponent({ props: ['label', 'value'], setup: (props, { slots, attrs }) => () => Vue.h('div', { 'data-testid': attrs['data-testid'] }, [props.label, ' ', props.value, slots.default?.()]) }))
  app.component('SharedStatusBadge', Vue.defineComponent({ props: ['label', 'tone'], setup: (props, { attrs }) => () => Vue.h('span', { 'data-testid': attrs['data-testid'], 'data-tone': props.tone }, props.label) }))
  return app
}

async function render(file: string, props: Record<string, unknown>) {
  const component = new Function(...Object.keys(globals), compile(file, true))(...Object.values(globals))
  return renderToString(stubs(Vue.createSSRApp(component, props)))
}

const PAY_URL = '/pay/order/7?access_token=tok-7'
const PUBLIC: SalesPublicPayment = { percent: 100, amount: 90, currency: 'SAR', pay_url: PAY_URL, state: 'payable' }

describe('SalesQuotePayment', () => {
  it('offers the pay page with the amount when the customer may pay', async () => {
    const html = await render('SalesQuotePayment.vue', { payment: PUBLIC })
    expect(html).toContain(`href="${PAY_URL}"`)
    expect(html).toContain('sales.quote.payment.pay 90.00 SAR')
    expect(html).toContain('sales.quote.payment.hintFull')
    expect(html).not.toContain('hintPercent')
  })

  it('says the share when only a part is asked for', async () => {
    const html = await render('SalesQuotePayment.vue', { payment: { ...PUBLIC, percent: 30, amount: 27 } })
    expect(html).toContain('sales.quote.payment.hintPercent 27.00 SAR 30')
    expect(html).toContain('data-testid="quote-pay"')
  })

  it('offers no link while the customer signs first, a payment is on its way, it is paid or unavailable', async () => {
    for (const state of ['awaiting_signature', 'processing', 'paid', 'unavailable'] as const) {
      const html = await render('SalesQuotePayment.vue', { payment: { ...PUBLIC, state, pay_url: null } })
      expect(html).not.toContain('href=')
      expect(html).toContain(`sales.quote.payment.states.${state}.title`)
      expect(html).toContain(`data-testid="quote-payment-${state}"`)
    }
  })

  it('keeps one polite status container, empty when there is nothing to say, so a change of state is announced', async () => {
    for (const payment of [null, { ...PUBLIC, state: 'unknown' }]) {
      const html = await render('SalesQuotePayment.vue', { payment })
      expect(html).toContain('role="status"')
      expect(html).toContain('aria-live="polite"')
      expect(html).not.toContain('data-testid="quote-payment')
      expect(html).not.toContain('href=')
    }
    const html = await render('SalesQuotePayment.vue', { payment: PUBLIC })
    expect(html).toMatch(/role="status"[^>]*>[\s\S]*quote-pay/)
  })

  it('says a received payment arrived and the confirmation follows, or that the signature is what remains', async () => {
    const received = { ...PUBLIC, state: 'received', amount: 0, pay_url: null } as const
    const plain = await render('SalesQuotePayment.vue', { payment: received })
    expect(plain).toContain('data-testid="quote-payment-received"')
    expect(plain).toContain('sales.quote.payment.states.received.title')
    expect(plain).toContain('sales.quote.payment.states.received.body')
    expect(plain).not.toContain('signBody')
    expect(plain).not.toContain('acceptBody')
    expect(plain).not.toContain('href=')
    expect(await render('SalesQuotePayment.vue', { payment: received, signFirst: true })).toContain('sales.quote.payment.states.received.signBody')
    const accept = await render('SalesQuotePayment.vue', { payment: received, acceptFirst: true })
    expect(accept).toContain('sales.quote.payment.states.received.acceptBody')
    expect(accept).not.toContain('received.signBody')
  })

  it('offers a refresh only while the payment is processing or received', async () => {
    expect(await render('SalesQuotePayment.vue', { payment: { ...PUBLIC, state: 'processing', pay_url: null } })).toContain('data-testid="quote-payment-refresh"')
    expect(await render('SalesQuotePayment.vue', { payment: { ...PUBLIC, state: 'received', pay_url: null } })).toContain('data-testid="quote-payment-refresh"')
    for (const state of ['awaiting_signature', 'paid', 'unavailable'] as const) {
      expect(await render('SalesQuotePayment.vue', { payment: { ...PUBLIC, state, pay_url: null } })).not.toContain('quote-payment-refresh')
    }
  })

  it('never builds a link from a payable state that has no address', async () => {
    const html = await render('SalesQuotePayment.vue', { payment: { ...PUBLIC, pay_url: null } })
    expect(html).not.toContain('href=')
  })
})

const STAFF: SalesOrderPayment = {
  mode: 'percent', percent: 40, currency: 'SAR', amount_required: 36, amount_received: 0, amount_due: 36, amount_to_refund: 0, amount_refundable: 0, can_refund: false,
  status: 'payable', link: 'ready', held: null, needs_attention: false, attention: null,
}

describe('SalesOrderPayment', () => {
  it('shows how the quotation asks to be paid, what it needs, what it has and what is due', async () => {
    const html = await render('SalesOrderPayment.vue', { payment: STAFF })
    expect(html).toContain('sales.payment.mode.percent 40')
    expect(html).toContain('data-testid="sales-payment-status"')
    expect(html).toContain('sales.payment.statuses.payable')
    expect(html).toContain('36.00 SAR')
    expect(html).toContain('data-testid="sales-payment-due"')
    expect(html).toContain('sales.payment.links.ready')
    expect(html).not.toContain('sales-payment-held')
    expect(html).not.toContain('sales-payment-refund')
  })

  it('reports a payment that did not confirm the order, and money to give back', async () => {
    const held = await render('SalesOrderPayment.vue', { payment: { ...STAFF, mode: 'full', percent: 100, amount_received: 90, amount_due: 0, held: 'expired', status: 'payable' } })
    expect(held).toContain('data-testid="sales-payment-held"')
    expect(held).toContain('sales.payment.held.expired 90.00 SAR')
    expect(held).not.toContain('sales-payment-due')
    const cancelled = await render('SalesOrderPayment.vue', { payment: { ...STAFF, mode: 'full', percent: 100, status: 'cancelled', amount_received: 90, amount_to_refund: 90, amount_due: 0, link: 'none' } })
    expect(cancelled).toContain('data-testid="sales-payment-refund"')
    expect(cancelled).toContain('data-tone="destructive"')
    expect(cancelled).not.toContain('sales-payment-link')
  })

  it('flags a payment that needs attention and shows only the line "not asked" when nothing is asked', async () => {
    expect(await render('SalesOrderPayment.vue', { payment: { ...STAFF, needs_attention: true, attention: 'payment_not_recorded' } })).toContain('data-testid="sales-payment-attention"')
    const waiting = await render('SalesOrderPayment.vue', { payment: { ...STAFF, needs_attention: true, attention: 'payment_awaits_confirmation' } })
    expect(waiting).toContain('sales.payment.attention.payment_awaits_confirmation')
    const off = await render('SalesOrderPayment.vue', { payment: { ...STAFF, mode: 'off', percent: 100, status: 'none', link: 'none', amount_required: 0, amount_due: 0 } })
    expect(off).toContain('sales.payment.mode.off')
    expect(off).not.toContain('sales-payment-status')
  })
})

describe('SalesOrderPayment link and held values the server added', () => {
  it('says no gateway is ready and links to the payments settings, only for that link value', async () => {
    const html = await render('SalesOrderPayment.vue', { payment: { ...STAFF, link: 'no_gateway' } })
    expect(html).toContain('data-testid="sales-payment-no-gateway"')
    expect(html).toContain('sales.payment.noGateway.title')
    expect(html).toContain('href="/settings/apps/payments"')
    expect(html).toContain('sales.payment.links.no_gateway')
    for (const link of ['none', 'ready', 'awaiting_signature', 'unavailable'] as const) expect(await render('SalesOrderPayment.vue', { payment: { ...STAFF, link } })).not.toContain('sales-payment-no-gateway')
  })

  it('explains money held on a cancelled quotation', async () => {
    const html = await render('SalesOrderPayment.vue', { payment: { ...STAFF, status: 'cancelled', held: 'cancelled', amount_received: 36, amount_to_refund: 36, link: 'none' } })
    expect(html).toContain('sales.payment.held.cancelled 36.00 SAR')
  })
})

describe('SalesOrderPayment when payment is no longer asked for', () => {
  const OFF: SalesOrderPayment = { ...STAFF, mode: 'off', percent: 100, status: 'none', link: 'none', amount_required: 0, amount_due: 0 }

  it('still shows money that arrived and money to give back', async () => {
    const html = await render('SalesOrderPayment.vue', { payment: { ...OFF, amount_received: 90, amount_to_refund: 90 } })
    expect(html).toContain('data-testid="sales-payment-received"')
    expect(html).toContain('90.00 SAR')
    expect(html).toContain('data-testid="sales-payment-refund"')
    expect(html).not.toContain('sales-payment-status')
    expect(html).not.toContain('sales-payment-due')
    expect(html).not.toContain('sales-payment-link')
  })

  it('shows a received amount alone, and nothing of either when no money moved', async () => {
    const received = await render('SalesOrderPayment.vue', { payment: { ...OFF, amount_received: 25 } })
    expect(received).toContain('data-testid="sales-payment-received"')
    expect(received).not.toContain('sales-payment-refund')
    const none = await render('SalesOrderPayment.vue', { payment: OFF })
    expect(none).not.toContain('sales-payment-received')
    expect(none).not.toContain('sales-payment-refund')
  })
})

describe('SalesPaymentCard', () => {
  function card(draft: { payment_to_confirm?: string; prepayment_percent?: number }) {
    const saved: unknown[] = []
    const form = { draft: Vue.ref(draft), state: Vue.ref({ saving: false, reloading: false }), save: async () => { saved.push({ ...form.draft.value }) }, revert: () => {}, reload: () => {}, refusedField: Vue.ref(null) }
    const scope = { ...globals, useHydrated: () => Vue.ref(true), useSalesSettingsCard: () => form }
    const component = new Function(...Object.keys(scope), compile('settings/SalesPaymentCard.vue', false))(...Object.values(scope))
    const state = component.setup({ settings: {}, canEdit: true, reloadSettings: async () => ({}) }, { expose: () => {}, emit: () => {} })
    return { state, form, saved }
  }

  it('blocks saving a percentage mode with an empty percentage and says why', async () => {
    const { state, saved } = card({ payment_to_confirm: 'percent' })
    expect(state.percentError.value).toBe('sales.settings.payment.shareRequired')
    await state.submit()
    expect(saved).toEqual([])
  })

  it('saves a cleared percentage under "off" or "full", leaving it out of the draft', async () => {
    for (const payment_to_confirm of ['off', 'full']) {
      const { state, saved } = card({ payment_to_confirm })
      expect(state.percentError.value).toBeUndefined()
      await state.submit()
      expect(saved).toEqual([{ payment_to_confirm }])
    }
  })

  it('saves a percentage mode with its percentage', async () => {
    const { state, saved } = card({ payment_to_confirm: 'percent', prepayment_percent: 30 })
    await state.submit()
    expect(saved).toEqual([{ payment_to_confirm: 'percent', prepayment_percent: 30 }])
  })
})

describe('SalesPaymentChoice', () => {
  function choice(modelValue: { mode: 'off' | 'full' | 'percent'; percent: number | null }) {
    const component = new Function(...Object.keys(globals), compile('SalesPaymentChoice.vue', false))(...Object.values(globals))
    const emitted: [string, unknown][] = []
    const state = component.setup({ modelValue, disabled: false }, { expose: () => {}, emit: (name: string, payload: unknown) => emitted.push([name, payload]) })
    return { state, emitted }
  }

  it('offers the three ways with their hints, in order', () => {
    const { state } = choice({ mode: 'off', percent: 50 })
    expect(state.items.value.map((item: { value: string }) => item.value)).toEqual(['off', 'full', 'percent'])
    expect(state.items.value[2]).toMatchObject({ label: 'sales.form.payment.percent', description: 'sales.form.payment.percentHint' })
  })

  it('reports a new mode or percentage with the other value kept', () => {
    const { state, emitted } = choice({ mode: 'percent', percent: 50 })
    state.mode.value = 'full'
    state.percent.value = 25
    expect(emitted).toEqual([['update:modelValue', { mode: 'full', percent: 50 }], ['update:modelValue', { mode: 'percent', percent: 25 }]])
  })
})

describe('SalesOrderRefund', () => {
  const PAYMENT = { ...STAFF, amount_received: 90, amount_refundable: 60, can_refund: true } as SalesOrderPayment
  function form(amountRefundable = 60) {
    const calls: unknown[] = []
    const mutation = { behaviour: async (args: unknown) => { calls.push(args) }, isPending: Vue.ref(false) }
    const scope = { ...globals, useHydrated: () => Vue.ref(true), useRefundSalesOrder: () => ({ mutateAsync: (args: unknown) => mutation.behaviour(args), isPending: mutation.isPending }), saveErrorMessage: () => 'generic', SalesOrderRefundBodySchema }
    const component = new Function(...Object.keys(scope), compile('SalesOrderRefund.vue', false))(...Object.values(scope))
    const emitted: string[] = []
    const state = component.setup({ order: { id: 7 }, payment: { ...PAYMENT, amount_refundable: amountRefundable } }, { expose: () => {}, emit: (name: string) => emitted.push(name) })
    return { state, calls, emitted, mutation }
  }

  it('starts at the most that may go back and sends the amount with its trimmed reference', async () => {
    const { state, calls, emitted } = form()
    expect(state.amount.value).toBe(60)
    state.amount.value = 25
    state.reference.value = 'RF-1'
    await state.save()
    expect(calls).toEqual([{ id: 7, refund: { amount: 25, reference: 'RF-1' } }])
    expect(emitted).toEqual(['done'])
  })

  it('sends nothing for an amount above the limit, a zero amount or an empty reference, and says which', async () => {
    const { state, calls } = form()
    state.reference.value = 'RF-1'
    for (const amount of [60.01, 0, null]) {
      state.amount.value = amount
      await state.save()
      expect(state.amountError.value).toBe('sales.refund.errors.amount')
      expect(state.referenceError.value).toBeUndefined()
    }
    state.amount.value = 10
    state.reference.value = '   '
    await state.save()
    expect(state.referenceError.value).toBe('sales.refund.errors.reference')
    expect(state.amountError.value).toBeUndefined()
    state.reference.value = 'x'.repeat(129)
    await state.save()
    expect(state.referenceError.value).toBe('sales.refund.errors.reference')
    expect(calls).toEqual([])
  })

  it('shows a refusal at its field, or under the form, and stays open', async () => {
    const { state, emitted, mutation } = form()
    state.reference.value = 'RF-1'
    mutation.behaviour = async () => { throw Object.assign(new Error('x'), { status: 422, code: 'invalid', field: 'amount' }) }
    await state.save()
    expect(state.amountError.value).toBe('sales.refund.errors.amount')
    expect(state.alertMessage.value).toBe('')
    mutation.behaviour = async () => { throw Object.assign(new Error('x'), { status: 409, code: 'conflict' }) }
    await state.save()
    expect(state.alertMessage.value).toBe('sales.refund.errors.conflict')
    mutation.behaviour = async () => { throw Object.assign(new Error('x'), { status: 403, code: 'feature_not_included' }) }
    await state.save()
    expect(state.alertMessage.value).toBe('sales.errors.featureNotIncluded')
    expect(emitted).toEqual([])
  })
})
