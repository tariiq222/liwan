import { afterEach, describe, expect, it, vi } from 'vitest'
import * as Vue from 'vue'
import { renderToString } from 'vue/server-renderer'
import manifest from '../../../../modules/finance/manifest'
import PaymentExchangeDifference from '../PaymentExchangeDifference.vue'

// The component is rendered for real: the Nuxt auto-imports it relies on are the only things stubbed.
afterEach(() => vi.unstubAllGlobals())

async function render(exchange_difference: number) {
  vi.stubGlobal('computed', Vue.computed)
  vi.stubGlobal('useI18n', () => ({ t: (key: string) => key }))
  return renderToString(Vue.createSSRApp({ render: () => Vue.h(PaymentExchangeDifference, { payment: { id: 7, exchange_difference } }) }))
}

describe('the exchange difference line of a payment', () => {
  it('names a gain in the success colour with its amount', async () => {
    const html = await render(37.5)
    expect(html).toContain('financeDocuments.payments.exchange.gain')
    expect(html).toContain('text-success')
    expect(html).toContain('37.50')
    expect(html).toContain('data-testid="finance-payment-exchange-7"')
  })

  it('names a loss in the error colour, without a minus sign', async () => {
    const html = await render(-12.4)
    expect(html).toContain('financeDocuments.payments.exchange.loss')
    expect(html).toContain('text-error')
    expect(html).toContain('12.40')
    expect(html).not.toContain('-12')
  })

  it('draws nothing when there was no difference', async () => {
    expect(await render(0)).not.toContain('finance-payment-exchange')
  })
})

describe('the capability the transfer panel route needs', () => {
  const needed = (path: string) => manifest.routeCapabilities?.find(rule => rule.pattern.test(path))?.capability

  it('is the payments write capability, like the other payment write routes, while the list stays a read', () => {
    expect(needed('/finance/payments/transfer/new')).toBe('finance.payments.manage')
    expect(needed('/finance/payments/new')).toBe('finance.payments.manage')
    expect(needed('/finance/payments')).toBe('finance.payments.read')
  })
})
