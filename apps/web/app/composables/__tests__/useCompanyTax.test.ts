import { QueryClient } from '@tanstack/vue-query'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { CompanyTaxSchema, type CompanyTax } from '@liwan/contracts'
import { companyTaxKeys, useCompanyTax, useSaveCompanyTax } from '../useCompanyTax'

const mocks = vi.hoisted(() => ({ api: vi.fn(), client: null as unknown, me: { value: { company: { id: 5 } } } as unknown }))
vi.mock('@tanstack/vue-query', async original => ({
  ...await original<object>(),
  useQuery: (options: unknown) => options,
  useMutation: (options: unknown) => options,
  useQueryClient: () => mocks.client,
}))

const SAVED: CompanyTax = { registered: true, price_mode: 'included', choice: 'included', locked: false, can_change: true, is_root_session: true }

function setup(companyId = 5) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  mocks.client = client
  mocks.me = { value: { company: { id: companyId } } }
  vi.stubGlobal('useApi', () => ({ $api: mocks.api }))
  vi.stubGlobal('useMe', () => ({ me: mocks.me }))
  return client
}

afterEach(() => {
  vi.unstubAllGlobals()
  vi.clearAllMocks()
  mocks.client = null
})

describe('useCompanyTax', () => {
  type Query = { queryKey: { value: unknown }; enabled: { value: boolean }; queryFn: () => Promise<unknown>; retry: boolean }

  it('reads the establishment choice through its contract, once per working company, and only while enabled', async () => {
    setup(5)
    mocks.api.mockResolvedValue(SAVED)
    const query = useCompanyTax(() => false) as unknown as Query
    expect(query.queryKey.value).toEqual(companyTaxKeys.establishment(5))
    expect(companyTaxKeys.establishment(5)).not.toEqual(companyTaxKeys.establishment(6))
    expect(query.enabled.value).toBe(false)
    expect(query.retry).toBe(false)
    await query.queryFn()
    expect(mocks.api).toHaveBeenCalledWith('/api/v1/admin/company/tax', { schema: CompanyTaxSchema })
  })

  it('is enabled for a signed-in user when asked', () => {
    setup()
    expect((useCompanyTax() as unknown as Query).enabled.value).toBe(true)
  })
})

describe('useSaveCompanyTax', () => {
  type Mutation = { mutationFn: (body: unknown) => Promise<CompanyTax> }

  it('PATCHes only the changed fields and replaces the cached choice with the answer', async () => {
    const client = setup(5)
    client.setQueryData(companyTaxKeys.establishment(5), SAVED)
    const saved: CompanyTax = { ...SAVED, price_mode: 'added', choice: 'added' }
    mocks.api.mockResolvedValue(saved)
    const body = { price_mode: 'added' }
    const answer = await (useSaveCompanyTax() as unknown as Mutation).mutationFn(body)
    expect(mocks.api).toHaveBeenCalledWith('/api/v1/admin/company/tax', { method: 'PATCH', body, schema: CompanyTaxSchema })
    expect(answer).toEqual(saved)
    expect(client.getQueryData(companyTaxKeys.establishment(5))).toEqual(saved)
  })

  it('leaves the cache alone when the server refuses the locked change', async () => {
    const client = setup(5)
    client.setQueryData(companyTaxKeys.establishment(5), SAVED)
    mocks.api.mockRejectedValue({ status: 409, code: 'tax_mode_locked' })
    await expect((useSaveCompanyTax() as unknown as Mutation).mutationFn({ price_mode: 'added' })).rejects.toMatchObject({ status: 409 })
    expect(client.getQueryData(companyTaxKeys.establishment(5))).toEqual(SAVED)
  })
})
