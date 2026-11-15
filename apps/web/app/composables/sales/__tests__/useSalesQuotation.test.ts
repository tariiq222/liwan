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

const { useSalesQuotation, useSalesQuotationAnswer } = await import('../useSalesQuotation')

type Read = { link: { value: unknown }; queryKey: { value: unknown }; enabled: { value: boolean }; queryFn: () => Promise<unknown>; retry: boolean; refetchOnWindowFocus: boolean }
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

describe('useSalesQuotationAnswer', () => {
  const link = { id: 42, token: 'tok-42' }

  it('accepts with the token alone, or with the name and the signature', async () => {
    mocks.api.mockResolvedValue({})
    await answers().accept.mutationFn({ link })
    expect(mocks.api).toHaveBeenLastCalledWith('/api/v1/public/sales/quotations/42/accept', { method: 'POST', body: { access_token: 'tok-42' }, schema: SalesPublicQuotationSchema })
    await answers().accept.mutationFn({ link, signedBy: 'Mona', signature: 'iVBOR' })
    expect(mocks.api).toHaveBeenLastCalledWith('/api/v1/public/sales/quotations/42/accept', { method: 'POST', body: { access_token: 'tok-42', signed_by: 'Mona', signature: 'iVBOR' }, schema: SalesPublicQuotationSchema })
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
