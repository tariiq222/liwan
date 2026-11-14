import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import * as Vue from 'vue'
import { renderShared } from '@liwan/ui/test/helpers/renderShared'
import * as card from '@liwan/commercial-ui/app/utils/paymentMethod'

const component = resolve(__dirname, '../PaymentMethodPanel.vue')
const locale = JSON.parse(readFileSync(resolve(__dirname, '../../../../i18n/locales/en/subscription.json'), 'utf8')).subscription.paymentMethod as Record<string, unknown>
const flatten = (value: Record<string, unknown>, prefix: string): Record<string, string> => Object.fromEntries(Object.entries(value).flatMap(([key, item]) =>
  typeof item === 'object' ? Object.entries(flatten(item as Record<string, unknown>, `${prefix}${key}.`)) : [[`${prefix}${key}`, String(item)]]))
const messages = flatten(locale, 'subscription.paymentMethod.')
const Badge = Vue.defineComponent({ inheritAttrs: false, props: { label: String }, setup: (p, { attrs }) => () => Vue.h('span', attrs, p.label) })
const saved = { id: 'pm-secret-id', brand: 'visa', last_four: '4242', exp_month: 3, exp_year: 2028, status: 'active', is_default: true }
const before = new Date('2027-01-15T00:00:00Z')
const render = (props: Record<string, unknown>) => renderShared(component, props, {}, {
  messages,
  modules: { '@liwan/commercial-ui/app/utils/paymentMethod': card },
  stubs: { SharedStatusBadge: Badge },
  globals: { ref: Vue.ref, computed: Vue.computed, useI18n: () => ({ t: (key: string) => messages[key] ?? key, te: (key: string) => key in messages }) },
})

describe('PaymentMethodPanel', () => {
  it('shows the brand, masked digits, expiry and an active badge, and says renewals are charged to the card', async () => {
    const html = await render({ card: saved, autoRenew: true, now: before })
    expect(html).toContain('Visa')
    expect(html).toContain('•••• 4242')
    expect(html).toContain('03/28')
    expect(html).toContain('data-state="active"')
    expect(html).toContain(messages['subscription.paymentMethod.chargedToCard'])
    expect(html).not.toContain('card-state-hint')
  })
  it('says renewals are paid manually when auto-renew is off', async () => {
    expect(await render({ card: saved, autoRenew: false, now: before })).toContain(messages['subscription.paymentMethod.paidManually'])
  })
  it('never prints the card id, and reads inactive and expired cards as such with a reason', async () => {
    const inactive = await render({ card: { ...saved, status: 'inactive' }, autoRenew: false, now: before })
    expect(inactive).toContain('data-state="inactive"')
    expect(inactive).toContain(messages['subscription.paymentMethod.stateHint.inactive'])
    expect(inactive).not.toContain('pm-secret-id')
    const expired = await render({ card: saved, autoRenew: true, now: new Date('2028-04-01T00:00:00Z') })
    expect(expired).toContain('data-state="expired"')
    expect(expired).toContain(messages['subscription.paymentMethod.stateHint.expired'])
  })
  it('keeps the digits and the expiry left to right inside right-to-left text', async () => {
    const html = await render({ card: saved, autoRenew: true, now: before })
    expect(html).toMatch(/<bdi dir="ltr"[^>]*>•••• 4242<\/bdi>/)
    expect(html).toMatch(/<bdi dir="ltr"[^>]*>03\/28<\/bdi>/)
  })
  it('without a card, says none is saved and that paying an invoice by card offers to save one', async () => {
    const html = await render({ card: null, autoRenew: false })
    expect(html).toContain(messages['subscription.paymentMethod.none'])
    expect(html).toContain(messages['subscription.paymentMethod.noneHint'])
    expect(html).not.toContain('data-slot="saved-card"')
  })
})
