import {
  PaymentProviderListSchema,
  PaymentProviderSchema,
  PaymentProviderSyncSchema,
  PaymentProviderUpdateSchema,
} from '../index'

const PROVIDER = {
  id: 7,
  code: 'paymob',
  name: 'Paymob',
  state: 'test',
  credentials: [{ field: 'paymob_secret_key', present: true }],
  configured: true,
  methods: ['card'],
  webhook_url: 'https://tenant.example.test/payment/paymob/webhook',
}

describe('PaymentProviderSchema', () => {
  it('is strict and carries no credential value', () => {
    expect(PaymentProviderSchema.parse(PROVIDER)).toEqual(PROVIDER)
    expect(Object.keys(PaymentProviderSchema.shape).sort()).toEqual(
      ['code', 'configured', 'credentials', 'id', 'methods', 'name', 'state', 'webhook_url'],
    )
    expect(() => PaymentProviderSchema.parse({ ...PROVIDER, paymob_secret_key: 'x' })).toThrow()
    expect(() => PaymentProviderSchema.parse({
      ...PROVIDER, credentials: [{ field: 'paymob_secret_key', present: true, value: 'x' }],
    })).toThrow()
  })

  it('rejects an unknown code or state and a non-url webhook', () => {
    expect(() => PaymentProviderSchema.parse({ ...PROVIDER, code: 'stripe' })).toThrow()
    expect(() => PaymentProviderSchema.parse({ ...PROVIDER, state: 'paused' })).toThrow()
    expect(() => PaymentProviderSchema.parse({ ...PROVIDER, webhook_url: '/payment/paymob/webhook' })).toThrow()
  })
})

describe('PaymentProviderListSchema', () => {
  it('wraps providers with a total and rejects extra keys', () => {
    expect(PaymentProviderListSchema.parse({ items: [PROVIDER], total: 1 })).toEqual({ items: [PROVIDER], total: 1 })
    expect(() => PaymentProviderListSchema.parse({ items: [PROVIDER], total: 1, next: 2 })).toThrow()
  })
})

describe('PaymentProviderUpdateSchema', () => {
  it('accepts a state, credentials or both, and nothing else', () => {
    expect(PaymentProviderUpdateSchema.parse({ state: 'enabled' })).toEqual({ state: 'enabled' })
    expect(PaymentProviderUpdateSchema.parse({ credentials: { paymob_api_key: ' k ' } }))
      .toEqual({ credentials: { paymob_api_key: 'k' } })
    expect(() => PaymentProviderUpdateSchema.parse({})).toThrow()
    expect(() => PaymentProviderUpdateSchema.parse({ name: 'x' })).toThrow()
    expect(() => PaymentProviderUpdateSchema.parse({ credentials: { paymob_api_key: '  ' } })).toThrow()
  })
})

describe('PaymentProviderSyncSchema', () => {
  it('returns the provider and a synced or partial status', () => {
    expect(PaymentProviderSyncSchema.parse({ provider: PROVIDER, status: 'partial' }).status).toBe('partial')
    expect(() => PaymentProviderSyncSchema.parse({ provider: PROVIDER, status: 'failed' })).toThrow()
  })
})
