import { describe, expect, it } from 'vitest'
import * as Vue from 'vue'
import * as card from '@liwan/commercial-ui/app/utils/paymentMethod'
import { loadSfc } from './sfc'

const noop = () => ''
const view = (paymentMethod: unknown, enabled = true) => ({ state: 'active', applied: null, target: null, pending_order: null, renewal_at: null, trial_ends_at: null, grace_ends_at: null, auto_renew: { enabled, consent_at: null, payment_method: paymentMethod } })
const savedCard = { id: 'pm-secret-id', brand: 'visa', last_four: '4242', exp_month: 3, exp_year: 2099, status: 'active', is_default: true }
const sfc = loadSfc('components/vendor/SubscriptionSummary.vue', {
  useI18n: () => ({ t: (key: string) => key, locale: Vue.ref('en') }),
  customerDisplayBadge: () => ({ tone: 'neutral', labelKey: 'badge' }), orderFulfillmentBadge: noop, orderPaymentBadge: noop,
  subscriptionDisplayState: () => 'active', targetStatus: () => 'none', cadenceLabel: noop, formatCommercialMoney: noop, formatLiwanDate: noop,
  ...card,
})

describe('SubscriptionSummary saved card', () => {
  it('shows brand, masked digits, expiry and status, never the card id', async () => {
    const html = await sfc.html({ subscription: view(savedCard) })
    expect(html).toContain('visa')
    expect(html).toContain('•••• 4242')
    expect(html).toContain('03/99')
    expect(html).not.toContain('pm-secret-id')
    expect(html).toContain('vendor.customers.sub.cardState.active')
  })
  it('reads an expired card as expired', async () => {
    expect(await sfc.html({ subscription: view({ ...savedCard, exp_year: 2020 }) })).toContain('vendor.customers.sub.cardState.expired')
  })
  it('says no card is saved when there is none', async () => {
    const html = await sfc.html({ subscription: view(null, false) })
    expect(html).toContain('vendor.customers.sub.cardNone')
    expect(html).not.toContain('vendor.customers.sub.cardExpiry')
  })
})
