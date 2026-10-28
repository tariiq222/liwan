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
  account_country: 'SA',
  account_country_options: ['AE', 'EG', 'OM', 'SA'],
}

describe('PaymentProviderSchema', () => {
  it('is strict and carries no credential value', () => {
    expect(PaymentProviderSchema.parse(PROVIDER)).toEqual(PROVIDER)
    expect(Object.keys(PaymentProviderSchema.shape).sort()).toEqual(
      ['account_country', 'account_country_options', 'code', 'configured', 'credentials', 'id', 'methods', 'name', 'state'],
    )
    expect(() => PaymentProviderSchema.parse({ ...PROVIDER, paymob_secret_key: 'x' })).toThrow()
    expect(() => PaymentProviderSchema.parse({
      ...PROVIDER, credentials: [{ field: 'paymob_secret_key', present: true, value: 'x' }],
    })).toThrow()
  })

  it('rejects an unknown code or state and a non-ISO account country', () => {
    expect(() => PaymentProviderSchema.parse({ ...PROVIDER, code: 'stripe' })).toThrow()
    expect(() => PaymentProviderSchema.parse({ ...PROVIDER, state: 'paused' })).toThrow()
    expect(() => PaymentProviderSchema.parse({ ...PROVIDER, account_country: 'SAU' })).toThrow()
    expect(PaymentProviderSchema.parse({ ...PROVIDER, account_country: null }).account_country).toBeNull()
  })
})

describe('PaymentProviderListSchema', () => {
  it('wraps providers with a total and rejects extra keys', () => {
    expect(PaymentProviderListSchema.parse({ items: [PROVIDER], total: 1 })).toEqual({ items: [PROVIDER], total: 1 })
    expect(() => PaymentProviderListSchema.parse({ items: [PROVIDER], total: 1, next: 2 })).toThrow()
  })
})

describe('PaymentProviderUpdateSchema', () => {
  it('accepts a state, credentials, an account country or several, and nothing else', () => {
    expect(PaymentProviderUpdateSchema.parse({ state: 'enabled' })).toEqual({ state: 'enabled' })
    expect(PaymentProviderUpdateSchema.parse({ account_country: 'AE' })).toEqual({ account_country: 'AE' })
    expect(() => PaymentProviderUpdateSchema.parse({ credentials: {} })).toThrow()
    expect(PaymentProviderUpdateSchema.parse({ credentials: { paymob_api_key: ' k ' } }))
      .toEqual({ credentials: { paymob_api_key: 'k' } })
    expect(() => PaymentProviderUpdateSchema.parse({})).toThrow()
    expect(() => PaymentProviderUpdateSchema.parse({ name: 'x' })).toThrow()
    expect(() => PaymentProviderUpdateSchema.parse({ credentials: { paymob_api_key: '  ' } })).toThrow()
  })
})

describe('PaymentProviderSyncSchema', () => {
  it('returns the provider and a synced or methods_missing status', () => {
    expect(PaymentProviderSyncSchema.parse({ provider: PROVIDER, status: 'methods_missing' }).status)
      .toBe('methods_missing')
    expect(() => PaymentProviderSyncSchema.parse({ provider: PROVIDER, status: 'partial' })).toThrow()
    expect(() => PaymentProviderSyncSchema.parse({ provider: PROVIDER, status: 'failed' })).toThrow()
  })
})
