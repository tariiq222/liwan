import { afterEach, describe, expect, it, vi } from 'vitest'
import { PAY_POLL_INTERVAL_MS } from '../paymentPay'
import { payableInvoiceKeys, usePayableInvoice, useStartPayment } from '../usePayableInvoice'

const mocks = vi.hoisted(() => ({ api: vi.fn() }))
vi.mock('@tanstack/vue-query', async original => ({
  ...await original<object>(),
  useQuery: (options: unknown) => options,
  useMutation: (options: unknown) => options,
}))

type QueryOptions = {
  queryKey: { value: unknown }
  enabled: { value: boolean }
  queryFn: () => Promise<unknown>
  retry: boolean
  refetchInterval: (query: { state: { data?: { status: string } } }) => number | false
}
type Read = ReturnType<typeof usePayableInvoice> & QueryOptions & { link: { value: unknown }; windowOpen: { value: boolean } }

function read(params: Record<string, string>, query: Record<string, unknown>, settle = false): Read {
  vi.stubGlobal('useRoute', () => ({ params, query }))
  vi.stubGlobal('useApi', () => ({ $api: mocks.api }))
  return usePayableInvoice({ settle }) as unknown as Read
}

afterEach(() => {
  vi.unstubAllGlobals()
  vi.clearAllMocks()
})

describe('usePayableInvoice', () => {
  it('reads the invoice with its access token through the contract, with no session and no retry', async () => {
    const invoice = read({ id: '42' }, { access_token: 'tok-42' })
    expect(invoice.link.value).toEqual({ id: 42, token: 'tok-42' })
    expect(invoice.enabled.value).toBe(true)
    expect(invoice.retry).toBe(false)
    expect(invoice.queryKey.value).toEqual(payableInvoiceKeys.record({ id: 42, token: 'tok-42' }))
    mocks.api.mockResolvedValue({})
    await invoice.queryFn().catch(() => undefined)
    expect(mocks.api).toHaveBeenCalledWith('/api/v1/public/payments/invoices/42', { query: { access_token: 'tok-42' }, schema: expect.anything() })
  })

  it('makes no request for an address without a usable token or id', () => {
    expect(read({ id: '42' }, {}).enabled.value).toBe(false)
    expect(read({ id: 'x' }, { access_token: 'tok' }).enabled.value).toBe(false)
    expect(read({ id: '42' }, { access_token: ['a', 'b'] }).enabled.value).toBe(false)
  })

  it('keeps a different cache entry per invoice and token', () => {
    expect(payableInvoiceKeys.record({ id: 1, token: 'a' })).not.toEqual(payableInvoiceKeys.record({ id: 1, token: 'b' }))
    expect(payableInvoiceKeys.record({ id: 1, token: 'a' })).not.toEqual(payableInvoiceKeys.record({ id: 2, token: 'a' }))
  })

  it('does not re-read an invoice on its own page, but the status page re-reads one still waiting for its payment', () => {
    const plain = read({ id: '42' }, { access_token: 'tok-42' })
    expect(plain.windowOpen.value).toBe(false)
    expect(plain.refetchInterval({ state: { data: { status: 'payable' } } })).toBe(false)
    const settling = read({ id: '42' }, { access_token: 'tok-42' }, true)
    expect(settling.windowOpen.value).toBe(true)
    expect(settling.refetchInterval({ state: { data: { status: 'payable' } } })).toBe(PAY_POLL_INTERVAL_MS)
    expect(settling.refetchInterval({ state: { data: { status: 'processing' } } })).toBe(PAY_POLL_INTERVAL_MS)
    expect(settling.refetchInterval({ state: { data: { status: 'paid' } } })).toBe(false)
    expect(settling.refetchInterval({ state: {} })).toBe(false)
  })
})

describe('useStartPayment', () => {
  it('posts the token and the chosen option to the invoice\'s transactions route and reads the redirect through its contract', async () => {
    vi.stubGlobal('useApi', () => ({ $api: mocks.api }))
    const start = useStartPayment() as unknown as { mutationFn: (input: unknown) => Promise<unknown> }
    mocks.api.mockResolvedValue({ redirect: { method: 'get', url: 'https://pay.example', fields: {} } })
    await start.mutationFn({
      link: { id: 42, token: 'tok-42' },
      option: { provider_id: 7, provider: 'paymob', method_id: 12, method: 'mada', method_name: 'مدى' },
    })
    expect(mocks.api).toHaveBeenCalledWith('/api/v1/public/payments/invoices/42/transactions', {
      method: 'POST',
      body: { access_token: 'tok-42', provider_id: 7, payment_method_id: 12 },
      schema: expect.anything(),
    })
  })
})
