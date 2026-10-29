import { afterEach, describe, expect, it, vi } from 'vitest'
import { PayableInvoiceSchema, PayableOrderSchema } from '@webvue/contracts'
import { PAY_POLL_INTERVAL_MS } from '../paymentPay'
import { payableDocumentKeys, usePayableDocument, useStartPayment } from '../usePayableDocument'

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
type Read = ReturnType<typeof usePayableDocument> & QueryOptions & { kind: { value: unknown }; link: { value: unknown }; windowOpen: { value: boolean } }

function read(params: Record<string, string>, query: Record<string, unknown>, settle = false): Read {
  vi.stubGlobal('useRoute', () => ({ params, query }))
  vi.stubGlobal('useApi', () => ({ $api: mocks.api }))
  return usePayableDocument({ settle }) as unknown as Read
}

afterEach(() => {
  vi.unstubAllGlobals()
  vi.clearAllMocks()
})

describe('usePayableDocument', () => {
  it('reads an invoice with its access token through the invoice contract, with no session and no retry', async () => {
    const invoice = read({ kind: 'invoice', id: '42' }, { access_token: 'tok-42' })
    expect(invoice.kind.value).toBe('invoice')
    expect(invoice.link.value).toEqual({ kind: 'invoice', id: 42, token: 'tok-42' })
    expect(invoice.enabled.value).toBe(true)
    expect(invoice.retry).toBe(false)
    expect(invoice.queryKey.value).toEqual(payableDocumentKeys.record({ kind: 'invoice', id: 42, token: 'tok-42' }))
    mocks.api.mockResolvedValue({})
    await invoice.queryFn().catch(() => undefined)
    expect(mocks.api).toHaveBeenCalledWith('/api/v1/public/payments/invoices/42', { query: { access_token: 'tok-42' }, schema: PayableInvoiceSchema })
  })

  it('reads an order from the orders route through the order contract', async () => {
    const order = read({ kind: 'order', id: '17' }, { access_token: 'tok-17' })
    expect(order.kind.value).toBe('order')
    expect(order.link.value).toEqual({ kind: 'order', id: 17, token: 'tok-17' })
    mocks.api.mockResolvedValue({})
    await order.queryFn().catch(() => undefined)
    expect(mocks.api).toHaveBeenCalledWith('/api/v1/public/payments/orders/17', { query: { access_token: 'tok-17' }, schema: PayableOrderSchema })
  })

  it('makes no request for an address without a usable kind, token or id', () => {
    expect(read({ kind: 'invoice', id: '42' }, {}).enabled.value).toBe(false)
    expect(read({ kind: 'invoice', id: 'x' }, { access_token: 'tok' }).enabled.value).toBe(false)
    expect(read({ kind: 'invoice', id: '42' }, { access_token: ['a', 'b'] }).enabled.value).toBe(false)
    expect(read({ kind: 'refund', id: '42' }, { access_token: 'tok' }).enabled.value).toBe(false)
  })

  it('still names the kind of an address whose id or token is unusable, and none for an unknown kind', () => {
    expect(read({ kind: 'order', id: 'x' }, {}).kind.value).toBe('order')
    expect(read({ kind: 'refund', id: '42' }, { access_token: 'tok' }).kind.value).toBeNull()
  })

  it('keeps a different cache entry per kind, id and token', () => {
    const base = { kind: 'invoice', id: 1, token: 'a' } as const
    expect(payableDocumentKeys.record(base)).not.toEqual(payableDocumentKeys.record({ ...base, token: 'b' }))
    expect(payableDocumentKeys.record(base)).not.toEqual(payableDocumentKeys.record({ ...base, id: 2 }))
    expect(payableDocumentKeys.record(base)).not.toEqual(payableDocumentKeys.record({ ...base, kind: 'order' }))
  })

  it('does not re-read a document on its own page, but the status page re-reads one still waiting for its payment', () => {
    const plain = read({ kind: 'invoice', id: '42' }, { access_token: 'tok-42' })
    expect(plain.windowOpen.value).toBe(false)
    expect(plain.refetchInterval({ state: { data: { status: 'payable' } } })).toBe(false)
    const settling = read({ kind: 'order', id: '42' }, { access_token: 'tok-42' }, true)
    expect(settling.windowOpen.value).toBe(true)
    expect(settling.refetchInterval({ state: { data: { status: 'payable' } } })).toBe(PAY_POLL_INTERVAL_MS)
    expect(settling.refetchInterval({ state: { data: { status: 'processing' } } })).toBe(PAY_POLL_INTERVAL_MS)
    expect(settling.refetchInterval({ state: { data: { status: 'paid' } } })).toBe(false)
    expect(settling.refetchInterval({ state: {} })).toBe(false)
  })
})

describe('useStartPayment', () => {
  const option = { provider_id: 7, provider: 'paymob', method_id: 12, method: 'mada', method_name: 'مدى' }
  const answer = { redirect: { method: 'get', url: 'https://pay.example', fields: {} } }

  async function start(link: { kind: 'invoice' | 'order'; id: number; token: string }) {
    vi.stubGlobal('useApi', () => ({ $api: mocks.api }))
    const mutation = useStartPayment() as unknown as { mutationFn: (input: unknown) => Promise<unknown> }
    mocks.api.mockResolvedValue(answer)
    await mutation.mutationFn({ link, option })
  }

  it('posts the token and the chosen option to the invoice\'s transactions route and reads the redirect through its contract', async () => {
    await start({ kind: 'invoice', id: 42, token: 'tok-42' })
    expect(mocks.api).toHaveBeenCalledWith('/api/v1/public/payments/invoices/42/transactions', {
      method: 'POST',
      body: { access_token: 'tok-42', provider_id: 7, payment_method_id: 12 },
      schema: expect.anything(),
    })
  })

  it('posts the same body to the order\'s transactions route', async () => {
    await start({ kind: 'order', id: 17, token: 'tok-17' })
    expect(mocks.api).toHaveBeenCalledWith('/api/v1/public/payments/orders/17/transactions', {
      method: 'POST',
      body: { access_token: 'tok-17', provider_id: 7, payment_method_id: 12 },
      schema: expect.anything(),
    })
  })
})
