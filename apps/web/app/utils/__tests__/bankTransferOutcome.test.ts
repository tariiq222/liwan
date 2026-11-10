import { describe, expect, it, vi } from 'vitest'
import { resolve } from 'node:path'
import * as Vue from 'vue'
import { renderToString } from '@vue/server-renderer'
import { DEFAULT_STUBS, loadShared } from '@liwan/ui/test/helpers/renderShared'
import * as subscription from '../subscription'
import { bankTransferOutcome, invoiceWantsTransfer, transferNotice } from '../subscription'

/**
 * The customer invoice page asks the control plane where to transfer while an invoice is unpaid. Three answers must
 * stay distinguishable — instructions, "the vendor has not set an account yet" (409 `bank_account_unavailable`), and a
 * real failure. The page used to swallow every error with `catch { return null }`, which showed a customer nothing at
 * all when the request was actually broken.
 */
const page = resolve(import.meta.dirname, '../../pages/subscription/invoices/[id].vue')

const instructions = {
  reference: 'INV-1001', amount_minor: 9900, currency: 'SAR', exponent: 2,
  bank: { account_name: 'Example', account_number: '123', iban: 'SA4420000001234567891234', instructions_ar: 'حوّل', instructions_en: 'Transfer' },
}
const refuse = (code: string) => ({ data: { code } })

describe('bank-transfer instructions on an invoice', () => {
  it('is asked for only by a permitted reader of an issued invoice', () => {
    expect(invoiceWantsTransfer(true, { status: 'issued' })).toBe(true)
    expect(invoiceWantsTransfer(true, { status: 'paid' })).toBe(false)
    expect(invoiceWantsTransfer(false, { status: 'issued' })).toBe(false)
    expect(invoiceWantsTransfer(true, null)).toBe(false)
  })

  it('shows the instructions when the request resolves', () => {
    const outcome = bankTransferOutcome(true, { instructions })
    expect(outcome).toEqual({ kind: 'instructions', instructions })
  })

  it('reads a 409 bank_account_unavailable as "not configured", never as a failure', () => {
    expect(bankTransferOutcome(true, { cause: refuse('bank_account_unavailable') })).toEqual({ kind: 'unavailable' })
  })

  it('reports any other refusal as a failure instead of swallowing it', () => {
    for (const cause of [refuse('forbidden'), refuse('not_found'), new Error('network'), { status: 500 }])
      expect(bankTransferOutcome(true, { cause }).kind, JSON.stringify(cause)).toBe('failed')
  })

  it('asks for nothing, and so shows neither note, when the invoice is not issued', () => {
    expect(bankTransferOutcome(false, {})).toEqual({ kind: 'not_requested' })
  })

  it('treats a resolved-but-empty answer as "not configured" rather than a crash', () => {
    expect(bankTransferOutcome(true, { instructions: null })).toEqual({ kind: 'unavailable' })
  })

  it('turns each answer into exactly one thing the page shows', () => {
    // The page renders `transferNotice(outcome)`, so this is the decision itself, not a reading of the page's source.
    expect(transferNotice(bankTransferOutcome(true, { instructions }))).toBe('none')
    expect(transferNotice(bankTransferOutcome(true, { cause: refuse('bank_account_unavailable') }))).toBe('unavailable')
    expect(transferNotice(bankTransferOutcome(true, { cause: refuse('payment_charge_in_progress') }))).toBe('charge_in_progress')
    expect(transferNotice(bankTransferOutcome(true, { cause: refuse('forbidden') }))).toBe('failed')
    expect(transferNotice(bankTransferOutcome(true, { cause: new Error('network') }))).toBe('failed')
    expect(transferNotice(bankTransferOutcome(false, {}))).toBe('none')
  })
})

/**
 * Renders the real invoice page twice from one fetch, the way Nuxt does: the server runs the fetcher and stores its return
 * value; the client reuses that payload and never runs the fetcher. A notice held outside the payload would show on the
 * server and vanish on the client.
 */
const invoice = {
  number: 'INV-1001', status: 'issued', tax_label: null,
  lines: [{ key: 'plan', kind: 'plan', description: 'Plan', quantity: 1, amount: { currency: 'SAR', exponent: 2, minor: 9900 } }],
  subtotal: { currency: 'SAR', exponent: 2, minor: 9900 }, tax: { currency: 'SAR', exponent: 2, minor: 0 }, total: { currency: 'SAR', exponent: 2, minor: 9900 },
}

async function renderPage(bankTransfer: () => Promise<unknown>, payload: Record<string, unknown>, reuse: boolean) {
  const api = { invoice: vi.fn(async () => invoice), bankTransfer: vi.fn(bankTransfer) }
  const asyncData = async (key: string | (() => string), fetcher: () => Promise<unknown>) => {
    const name = typeof key === 'function' ? key() : key
    if (!reuse) payload[name] = await fetcher()
    return { data: Vue.ref(payload[name]), error: Vue.ref(undefined), pending: Vue.ref(false), refresh: () => {} }
  }
  const component = loadShared(page, {
    messages: { 'subscription.bankTransfer.error': 'transfer failed', 'subscription.bankTransfer.unavailable': 'transfer unavailable' },
    globals: { useAsyncData: asyncData, useRoute: () => ({ path: '/subscription/invoices/inv-1', params: { id: 'inv-1' } }), definePageMeta: () => {} },
    modules: {
      '@/composables/useSubscription': { useSubscriptionApi: () => api, useCustomerCapabilities: () => ({ can: () => true }) },
      '@/utils/subscription': subscription,
    },
  })
  const slotted = Vue.defineComponent({ inheritAttrs: false, setup: (_, { attrs, slots }) => () => Vue.h('div', attrs, slots.default?.()) })
  const app = Vue.createSSRApp(component)
  app.config.warnHandler = () => {}
  for (const [tag, stub] of Object.entries({ ...DEFAULT_STUBS, SharedRecordPage: slotted, SharedRecordSection: slotted, SharedInvoiceLines: slotted, SharedForbiddenState: slotted })) app.component(tag, stub)
  return { html: await renderToString(app), api }
}

describe('the invoice page shows the transfer notice from the server payload alone', () => {
  const cases = [
    ['a 409 bank_account_unavailable', async () => { throw refuse('bank_account_unavailable') }, 'bank-transfer-unavailable', 'bank-transfer-error'],
    ['any other failure', async () => { throw new Error('network') }, 'bank-transfer-error', 'bank-transfer-unavailable'],
  ] as const

  for (const [name, bankTransfer, shown, hidden] of cases) {
    it(`keeps the notice for ${name} when the client reuses the payload and the fetcher does not run`, async () => {
      const payload: Record<string, unknown> = {}
      const server = await renderPage(bankTransfer, payload, false)
      expect(server.html).toContain(`data-testid="${shown}"`)
      expect(server.html).not.toContain(`data-testid="${hidden}"`)
      const client = await renderPage(bankTransfer, payload, true)
      expect(client.api.bankTransfer).not.toHaveBeenCalled()
      expect(client.html).toContain(`data-testid="${shown}"`)
      expect(client.html).not.toContain(`data-testid="${hidden}"`)
    })
  }

  it('shows the instructions, and no notice, when the transfer details resolve', async () => {
    const payload: Record<string, unknown> = {}
    await renderPage(async () => instructions, payload, false)
    const client = await renderPage(async () => instructions, payload, true)
    expect(client.html).toContain('data-testid="bank-transfer"')
    expect(client.html).toContain('INV-1001')
    expect(client.html).not.toContain('data-testid="bank-transfer-unavailable"')
    expect(client.html).not.toContain('data-testid="bank-transfer-error"')
  })
})
