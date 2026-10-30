import { QueryClient } from '@tanstack/vue-query'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { PaymentProviderSchema, type PaymentProviderList } from '@liwan/contracts'
import { paymentProviderKeys, usePaymentProviders, useSyncPaymentProvider, useUpdatePaymentProvider } from '../usePaymentProviders'

const mocks = vi.hoisted(() => ({ api: vi.fn(), client: null as unknown }))
vi.mock('@tanstack/vue-query', async original => ({
  ...await original<object>(),
  useQuery: (options: unknown) => options,
  useMutation: (options: unknown) => options,
  useQueryClient: () => mocks.client,
}))

const FIELDS = ['paymob_public_key', 'paymob_secret_key', 'paymob_hmac_key', 'paymob_api_key']
const wire = (state: string, present: boolean) => ({
  id: 4, code: 'paymob', name: 'Paymob', state,
  credentials: FIELDS.map(field => ({ field, present })),
  configured: present, methods: present ? ['card'] : [], account_country: 'SA', account_country_options: ['SA', 'AE', 'OM', 'EG'],
})

function setup(list: PaymentProviderList | undefined) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  if (list) client.setQueryData(paymentProviderKeys.all, list)
  mocks.client = client
  vi.stubGlobal('useApi', () => ({ $api: mocks.api }))
  return client
}

afterEach(() => {
  vi.unstubAllGlobals()
  vi.clearAllMocks()
  mocks.client = null
})

describe('usePaymentProviders', () => {
  it('reads the gateway list through its contract and only while enabled', async () => {
    setup(undefined)
    mocks.api.mockResolvedValue({ items: [], total: 0 })
    const query = usePaymentProviders(() => false) as unknown as { queryKey: unknown; enabled: () => boolean; queryFn: () => Promise<unknown> }
    expect(query.queryKey).toEqual(['payments', 'providers'])
    expect(query.enabled()).toBe(false)
    await query.queryFn()
    expect(mocks.api).toHaveBeenCalledWith('/api/v1/payments/providers', expect.objectContaining({ schema: expect.anything() }))
  })
})

describe('gateway mutations', () => {
  const list = (state: string): PaymentProviderList => ({ items: [PaymentProviderSchema.parse(wire(state, false))], total: 1 })
  type Mutation<T> = { mutationFn: (input: T) => Promise<unknown>; onSuccess: (answer: never) => Promise<void> }

  it('PATCHes the mode with only the state and replaces the cached gateway with the answer', async () => {
    const client = setup(list('disabled'))
    const saved = wire('test', true)
    mocks.api.mockResolvedValue(PaymentProviderSchema.parse(saved))
    const mutation = useUpdatePaymentProvider() as unknown as Mutation<{ id: number; body: unknown }>
    const answer = await mutation.mutationFn({ id: 4, body: { state: 'test' } })
    expect(mocks.api).toHaveBeenCalledWith('/api/v1/payments/providers/4', expect.objectContaining({ method: 'PATCH', body: { state: 'test' } }))
    await mutation.onSuccess(answer as never)
    const cached = client.getQueryData<PaymentProviderList>(paymentProviderKeys.all)!
    expect(cached.items[0]).toMatchObject({ state: 'test', configured: true, methods: ['card'] })
    expect(cached.total).toBe(1)
  })

  it('PATCHes the account country and keeps the answer', async () => {
    const client = setup(list('test'))
    mocks.api.mockResolvedValue(PaymentProviderSchema.parse({ ...wire('test', true), account_country: 'EG' }))
    const mutation = useUpdatePaymentProvider() as unknown as Mutation<{ id: number; body: unknown }>
    const answer = await mutation.mutationFn({ id: 4, body: { account_country: 'EG' } })
    expect(mocks.api).toHaveBeenCalledWith('/api/v1/payments/providers/4', expect.objectContaining({ method: 'PATCH', body: { account_country: 'EG' } }))
    await mutation.onSuccess(answer as never)
    expect(client.getQueryData<PaymentProviderList>(paymentProviderKeys.all)!.items[0]!.account_country).toBe('EG')
  })

  it('PATCHes credentials as typed and never receives a key value back', async () => {
    setup(list('disabled'))
    mocks.api.mockResolvedValue(PaymentProviderSchema.parse(wire('disabled', true)))
    const mutation = useUpdatePaymentProvider() as unknown as Mutation<{ id: number; body: unknown }>
    const answer = await mutation.mutationFn({ id: 4, body: { credentials: { paymob_secret_key: 'sk_live_1' } } })
    expect(mocks.api.mock.calls[0]![1]).toMatchObject({ body: { credentials: { paymob_secret_key: 'sk_live_1' } } })
    expect(JSON.stringify(answer)).not.toContain('sk_live_1')
  })

  it('POSTs the connection test and stores the refreshed gateway from its answer', async () => {
    const client = setup(list('test'))
    mocks.api.mockResolvedValue({ provider: PaymentProviderSchema.parse(wire('test', true)), status: 'methods_missing' })
    const mutation = useSyncPaymentProvider() as unknown as Mutation<number>
    const answer = await mutation.mutationFn(4)
    expect(mocks.api).toHaveBeenCalledWith('/api/v1/payments/providers/4/sync', expect.objectContaining({ method: 'POST', body: {} }))
    await mutation.onSuccess(answer as never)
    expect(client.getQueryData<PaymentProviderList>(paymentProviderKeys.all)!.items[0]).toMatchObject({ configured: true, methods: ['card'] })
    expect((answer as { status: string }).status).toBe('methods_missing')
  })

  it('cancels a list read still in flight so it cannot bring the old state back', async () => {
    const client = setup(list('disabled'))
    let finishOldRead: (value: PaymentProviderList) => void = () => {}
    const oldRead = client.fetchQuery({ queryKey: paymentProviderKeys.all, staleTime: 0, queryFn: () => new Promise<PaymentProviderList>((resolve) => { finishOldRead = resolve }) }).catch(() => {})
    mocks.api.mockResolvedValue(PaymentProviderSchema.parse(wire('enabled', true)))
    const mutation = useUpdatePaymentProvider() as unknown as Mutation<{ id: number; body: unknown }>
    const answer = await mutation.mutationFn({ id: 4, body: { state: 'enabled' } })
    await mutation.onSuccess(answer as never)
    finishOldRead(list('disabled'))
    await oldRead
    expect(client.getQueryData<PaymentProviderList>(paymentProviderKeys.all)!.items[0]!.state).toBe('enabled')
  })

  it('leaves the cache empty when the list was never loaded', async () => {
    const client = setup(undefined)
    mocks.api.mockResolvedValue(PaymentProviderSchema.parse(wire('enabled', true)))
    const mutation = useUpdatePaymentProvider() as unknown as Mutation<{ id: number; body: unknown }>
    const answer = await mutation.mutationFn({ id: 4, body: { state: 'enabled' } })
    await mutation.onSuccess(answer as never)
    expect(client.getQueryData(paymentProviderKeys.all)).toBeUndefined()
  })
})
