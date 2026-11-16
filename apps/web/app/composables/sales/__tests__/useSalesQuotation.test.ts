import { afterEach, describe, expect, it, vi } from 'vitest'
import { SalesPublicQuotationSchema } from '@liwan/contracts'
import { salesKeys } from '../salesKeys'

const mocks = vi.hoisted(() => ({ api: vi.fn(), setQueryData: vi.fn() }))
vi.mock('@tanstack/vue-query', async original => ({
  ...await original<object>(),
  useQuery: (options: unknown) => options,
  useMutation: (options: unknown) => options,
  useQueryClient: () => ({ setQueryData: mocks.setQueryData }),
}))

const { PROCESSING_REFETCH_LIMIT_MS, PROCESSING_REFETCH_MS, useSalesQuotation, useSalesQuotationAnswer } = await import('../useSalesQuotation')

type Read = { link: { value: unknown }; queryKey: { value: unknown }; enabled: { value: boolean }; queryFn: () => Promise<unknown>; retry: boolean; refetchOnWindowFocus: boolean; refetchInterval: (query: { state: { data?: { payment: { state: string } | null } } }) => number | false }
type Write = { mutationFn: (input: unknown) => Promise<unknown>; onSuccess: (saved: { id: number }, input: { link: { token: string } }) => void }

function read(params: Record<string, string>, query: Record<string, unknown>): Read {
  vi.stubGlobal('useRoute', () => ({ params, query }))
  vi.stubGlobal('useApi', () => ({ $api: mocks.api }))
  return useSalesQuotation() as unknown as Read
}

function answers() {
  vi.stubGlobal('useApi', () => ({ $api: mocks.api }))
  return useSalesQuotationAnswer() as unknown as { accept: Write; decline: Write }
}

afterEach(() => {
  vi.useRealTimers()
  vi.unstubAllGlobals()
  vi.clearAllMocks()
})

describe('useSalesQuotation', () => {
  it('reads the quotation with its access token through the public contract, with no session, no retry and no re-read on focus', async () => {
    const quote = read({ id: '42' }, { access_token: 'tok-42' })
    expect(quote.link.value).toEqual({ id: 42, token: 'tok-42' })
    expect(quote.enabled.value).toBe(true)
    expect(quote.retry).toBe(false)
    expect(quote.refetchOnWindowFocus).toBe(false)
    expect(quote.queryKey.value).toEqual(salesKeys.quote(42, 'tok-42'))
    mocks.api.mockResolvedValue({})
    await quote.queryFn()
    expect(mocks.api).toHaveBeenCalledWith('/api/v1/public/sales/quotations/42', { query: { access_token: 'tok-42' }, schema: SalesPublicQuotationSchema })
  })

  it('makes no request for an address without a usable id or token', () => {
    expect(read({ id: '42' }, {}).enabled.value).toBe(false)
    expect(read({ id: 'x' }, { access_token: 'tok' }).enabled.value).toBe(false)
    expect(read({ id: '42' }, { access_token: ['a', 'b'] }).enabled.value).toBe(false)
    expect(read({ id: '42' }, { access_token: 'tok' }).queryKey.value).not.toEqual(read({ id: '42' }, { access_token: 'other' }).queryKey.value)
  })
})

describe('useSalesQuotation refetch while the payment is processing', () => {
  const state = (payment: string | null) => ({ state: { data: { payment: payment ? { state: payment } : null } } })

  it('reads the quotation again every 8 seconds while the payment is processing, and never otherwise', () => {
    const { refetchInterval } = read({ id: '42' }, { access_token: 'tok-42' })
    expect(refetchInterval(state('processing'))).toBe(PROCESSING_REFETCH_MS)
    expect(PROCESSING_REFETCH_MS).toBe(8000)
    for (const other of ['payable', 'paid', 'awaiting_signature', 'unavailable', null]) expect(refetchInterval(state(other))).toBe(false)
    expect(refetchInterval({ state: {} })).toBe(false)
  })

  it('reads again while a payment was received and the order is not confirmed yet, with the same limits', () => {
    vi.useFakeTimers()
    const { refetchInterval } = read({ id: '42' }, { access_token: 'tok-42' })
    expect(refetchInterval(state('received'))).toBe(PROCESSING_REFETCH_MS)
    vi.advanceTimersByTime(PROCESSING_REFETCH_LIMIT_MS)
    expect(refetchInterval(state('received'))).toBe(false)
    const again = read({ id: '42' }, { access_token: 'tok-42' }).refetchInterval
    expect(again(state('received'))).toBe(PROCESSING_REFETCH_MS)
    // Confirmation follows: the state changes to paid and the reads stop.
    expect(again(state('paid'))).toBe(false)
  })

  it('stops after 5 minutes, and stops as soon as the state changes', () => {
    vi.useFakeTimers()
    const { refetchInterval } = read({ id: '42' }, { access_token: 'tok-42' })
    expect(refetchInterval(state('processing'))).toBe(8000)
    vi.advanceTimersByTime(PROCESSING_REFETCH_LIMIT_MS - 1)
    expect(refetchInterval(state('processing'))).toBe(8000)
    vi.advanceTimersByTime(1)
    expect(refetchInterval(state('processing'))).toBe(false)
    expect(PROCESSING_REFETCH_LIMIT_MS).toBe(300000)

    const again = read({ id: '42' }, { access_token: 'tok-42' }).refetchInterval
    expect(again(state('processing'))).toBe(8000)
    vi.advanceTimersByTime(60_000)
    expect(again(state('paid'))).toBe(false)
    // A later processing state gets a fresh five minutes.
    expect(again(state('processing'))).toBe(8000)
    vi.advanceTimersByTime(PROCESSING_REFETCH_LIMIT_MS - 1)
    expect(again(state('processing'))).toBe(8000)
  })
})

describe('useSalesQuotationAnswer', () => {
  const link = { id: 42, token: 'tok-42' }

  it('accepts with the token alone, or with the name, the signature and how it was made', async () => {
    mocks.api.mockResolvedValue({})
    await answers().accept.mutationFn({ link })
    expect(mocks.api).toHaveBeenLastCalledWith('/api/v1/public/sales/quotations/42/accept', { method: 'POST', body: { access_token: 'tok-42' }, schema: SalesPublicQuotationSchema })
    await answers().accept.mutationFn({ link, signedBy: 'Mona', signature: 'iVBOR', signatureMethod: 'typed' })
    expect(mocks.api).toHaveBeenLastCalledWith('/api/v1/public/sales/quotations/42/accept', { method: 'POST', body: { access_token: 'tok-42', signed_by: 'Mona', signature: 'iVBOR', signature_method: 'typed' }, schema: SalesPublicQuotationSchema })
  })

  it('declines with an optional reason', async () => {
    mocks.api.mockResolvedValue({})
    await answers().decline.mutationFn({ link })
    expect(mocks.api).toHaveBeenLastCalledWith('/api/v1/public/sales/quotations/42/decline', { method: 'POST', body: { access_token: 'tok-42' }, schema: SalesPublicQuotationSchema })
    await answers().decline.mutationFn({ link, reason: 'Too high' })
    expect(mocks.api).toHaveBeenLastCalledWith('/api/v1/public/sales/quotations/42/decline', { method: 'POST', body: { access_token: 'tok-42', reason: 'Too high' }, schema: SalesPublicQuotationSchema })
  })

  it('replaces the cached quotation with the answer it gets back', () => {
    const saved = { id: 42 }
    answers().accept.onSuccess(saved, { link })
    answers().decline.onSuccess(saved, { link })
    expect(mocks.setQueryData).toHaveBeenCalledTimes(2)
    expect(mocks.setQueryData).toHaveBeenCalledWith(salesKeys.quote(42, 'tok-42'), saved)
  })
})
