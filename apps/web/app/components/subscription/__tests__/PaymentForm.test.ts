import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import * as Vue from 'vue'
import { renderShared } from '@liwan/ui/test/helpers/renderShared'
import * as cardPayment from '../../../utils/cardPayment'

const component = resolve(__dirname, '../PaymentForm.vue')
const session = {
  attempt_id: 'a-1', intent: { id: 'intent-1', client_secret: 'secret-1' }, publishable_key: 'pk_test_abc',
  amount: { minor: 12_500, currency: 'SAR', exponent: 2 }, expires_at: '2099-01-01T00:00:00.000Z',
}
const messages: Record<string, string> = {
  'subscription.pay.standIn.title': 'Stand-in for the card form (test environment)',
  'subscription.pay.standIn.saving': 'The card would be saved.', 'subscription.pay.standIn.notSaving': 'The card would not be saved.',
  'subscription.pay.standIn.description': 'Not contacted.', 'subscription.pay.loadFailed': 'Load failed',
}
const render = (props: Record<string, unknown>) => renderShared(component, props, {}, {
  messages,
  modules: { '@/utils/cardPayment': cardPayment },
  globals: {
    ref: Vue.ref, computed: Vue.computed, onMounted: () => {}, onBeforeUnmount: () => {},
    useI18n: () => ({ t: (key: string) => messages[key] ?? key, locale: Vue.ref('ar') }),
  },
})

describe('PaymentForm', () => {
  it('for the test stack key, shows a clearly labelled stand-in and never a provider form', async () => {
    const html = await render({ session: { ...session, publishable_key: cardPayment.STAND_IN_PUBLISHABLE_KEY }, saveCard: true })
    expect(html).toContain('data-testid="payment-form-stand-in"')
    expect(html).toContain(messages['subscription.pay.standIn.title'])
    expect(html).toContain(messages['subscription.pay.standIn.saving'])
    expect(html).not.toContain('secret-1')
  })
  it('for a real key renders only an empty left-to-right host and never the intent secret into the page', async () => {
    const html = await render({ session, saveCard: false })
    expect(html).toContain('data-testid="payment-form-host"')
    expect(html).toContain('dir="ltr"')
    expect(html).not.toContain('payment-form-stand-in')
    expect(html).not.toContain('secret-1')
  })
  it('watches a far-off session end in steps: one timer over 2^31-1 ms fires at once and would expire a live form', async () => {
    const { readFileSync } = await import('node:fs')
    const source = readFileSync(component, 'utf8')
    expect(source).toContain('Math.min(left, MAX_TIMER_MS)')
    expect(source).toContain('2 ** 31 - 1')
  })
  it('loads the provider package only in the browser, after mount, and only from this component', async () => {
    const { readFileSync, readdirSync, statSync } = await import('node:fs')
    const source = readFileSync(component, 'utf8')
    expect(source).toMatch(/onMounted\(\(\) => \{[^}]*mountForm/)
    expect(source).toContain("import('moyasar-payment-form')")
    const walk = (dir: string): string[] => readdirSync(dir).flatMap(name => (statSync(`${dir}/${name}`).isDirectory() ? (name === 'node_modules' || name === '.nuxt' ? [] : walk(`${dir}/${name}`)) : [`${dir}/${name}`]))
    const importers = walk(resolve(__dirname, '../../..')).filter(file => /\.(vue|ts)$/.test(file) && !file.includes('__tests__') && readFileSync(file, 'utf8').includes('moyasar-payment-form'))
    // The package's typings are declared beside the app's other type files; the only code that imports it is this component.
    expect(importers.map(file => file.replace(resolve(__dirname, '../../..'), '')).sort()).toEqual(['/components/subscription/PaymentForm.vue', '/types/moyasarPaymentForm.d.ts'])
  })
})
