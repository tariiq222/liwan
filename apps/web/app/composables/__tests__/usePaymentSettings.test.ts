import { QueryClient } from '@tanstack/vue-query'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { PaymentSettingsSchema, type PaymentSettings } from '@liwan/contracts'
import { paymentSettingsKeys, usePaymentSettings, useSavePaymentSettings } from '../usePaymentSettings'

const mocks = vi.hoisted(() => ({ api: vi.fn(), client: null as unknown }))
vi.mock('@tanstack/vue-query', async original => ({
  ...await original<object>(),
  useQuery: (options: unknown) => options,
  useMutation: (options: unknown) => options,
  useQueryClient: () => mocks.client,
}))

const SAVED: PaymentSettings = { unpaid_order_expiry_minutes: 60, invoice_when_paid: true, refund_policy: 'full', refund_amounts: 'due', tax_mode: 'included', system_admin_links: false, revision: 3 }

function setup(companyId: number | undefined = 5) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  mocks.client = client
  vi.stubGlobal('useApi', () => ({ $api: mocks.api }))
  vi.stubGlobal('useMe', () => ({ me: { value: { company: { id: companyId } } } }))
  return client
}

afterEach(() => {
  vi.unstubAllGlobals()
  vi.clearAllMocks()
  mocks.client = null
})

describe('usePaymentSettings', () => {
  type Query = { queryKey: { value: unknown }; enabled: { value: boolean }; queryFn: () => Promise<unknown>; retry: boolean }

  it('reads the settings through their contract, once per company, and only while enabled', async () => {
    setup(5)
    mocks.api.mockResolvedValue(SAVED)
    const query = usePaymentSettings(() => false) as unknown as Query
    expect(query.queryKey.value).toEqual(paymentSettingsKeys.company(5))
    expect(paymentSettingsKeys.company(5)).not.toEqual(paymentSettingsKeys.company(6))
    expect(query.enabled.value).toBe(false)
    expect(query.retry).toBe(false)
    await query.queryFn()
    expect(mocks.api).toHaveBeenCalledWith('/api/v1/payments/settings', { schema: PaymentSettingsSchema })
  })

  it('is enabled for a signed-in user when asked', () => {
    setup()
    expect((usePaymentSettings() as unknown as Query).enabled.value).toBe(true)
  })
})

describe('useSavePaymentSettings', () => {
  type Mutation = { mutationFn: (body: unknown) => Promise<PaymentSettings> }

  it('PATCHes the body with the revision and replaces the cached settings with the answer', async () => {
    const client = setup(5)
    client.setQueryData(paymentSettingsKeys.company(5), SAVED)
    const saved = { unpaid_order_expiry_minutes: 90, invoice_when_paid: true, refund_policy: 'full', refund_amounts: 'due', tax_mode: 'included', system_admin_links: false, revision: 4 }
    mocks.api.mockResolvedValue(saved)
    const body = { revision: 3, unpaid_order_expiry_minutes: 90 }
    const answer = await (useSavePaymentSettings() as unknown as Mutation).mutationFn(body)
    expect(mocks.api).toHaveBeenCalledWith('/api/v1/payments/settings', { method: 'PATCH', body, schema: PaymentSettingsSchema })
    expect(answer).toEqual(saved)
    expect(client.getQueryData(paymentSettingsKeys.company(5))).toEqual(saved)
  })

  it('leaves the cache alone when the server refuses, so a stale save never shows as saved', async () => {
    const client = setup(5)
    client.setQueryData(paymentSettingsKeys.company(5), SAVED)
    mocks.api.mockRejectedValue({ status: 409, code: 'conflict' })
    await expect((useSavePaymentSettings() as unknown as Mutation).mutationFn({ revision: 2, invoice_when_paid: false })).rejects.toMatchObject({ status: 409 })
    expect(client.getQueryData(paymentSettingsKeys.company(5))).toEqual(SAVED)
  })
})
