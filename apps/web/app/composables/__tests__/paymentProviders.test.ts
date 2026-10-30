import { describe, expect, it } from 'vitest'
import { PaymentProviderSchema, type PaymentProvider, type PaymentProviderList } from '@liwan/contracts'
import {
  PAYMENT_PROVIDER_STATES,
  SYNC_OUTCOMES,
  countryName,
  credentialLabelKey,
  credentialsPatch,
  failedCredential,
  paymentProviderState,
  paymentStateBadge,
  providerErrorKey,
  replaceProvider,
} from '../paymentProviders'

const FIELDS = ['paymob_public_key', 'paymob_secret_key', 'paymob_hmac_key', 'paymob_api_key']

function provider(id: number, state: PaymentProvider['state'] = 'disabled'): PaymentProvider {
  return PaymentProviderSchema.parse({
    id, code: 'paymob', name: 'Paymob', state,
    credentials: FIELDS.map(field => ({ field, present: false })),
    configured: false, methods: [], account_country: 'SA', account_country_options: ['SA', 'AE', 'OM', 'EG'],
  })
}

describe('payment provider modes', () => {
  it('lists the modes off, test, live in that order', () => {
    expect(PAYMENT_PROVIDER_STATES).toEqual(['disabled', 'test', 'enabled'])
  })

  it('maps each mode to a badge and keeps an unknown one neutral with its raw value', () => {
    expect(paymentStateBadge('disabled')).toEqual({ tone: 'neutral', labelKey: 'payments.state.disabled' })
    expect(paymentStateBadge('test')).toEqual({ tone: 'info', labelKey: 'payments.state.test' })
    expect(paymentStateBadge('enabled')).toEqual({ tone: 'success', labelKey: 'payments.state.enabled' })
    expect(paymentStateBadge('sandbox')).toEqual({ tone: 'neutral', labelKey: '' })
  })

  it('narrows a control value to a mode, and refuses anything else', () => {
    expect(paymentProviderState('enabled')).toBe('enabled')
    expect(paymentProviderState('live')).toBeNull()
    expect(paymentProviderState('')).toBeNull()
  })
})

describe('credentialsPatch', () => {
  it('sends only the fields the user typed, trimmed', () => {
    expect(credentialsPatch({ paymob_public_key: '  pk_1  ', paymob_secret_key: 'sk_1' })).toEqual({ paymob_public_key: 'pk_1', paymob_secret_key: 'sk_1' })
  })

  it('leaves a blank or whitespace-only field out so its saved key stays', () => {
    expect(credentialsPatch({ paymob_public_key: '', paymob_secret_key: '   ', paymob_hmac_key: 'h' })).toEqual({ paymob_hmac_key: 'h' })
    expect(credentialsPatch({})).toEqual({})
  })
})

describe('credentialLabelKey', () => {
  it('names the four Paymob keys and leaves a field a newer server adds to its own name', () => {
    for (const field of FIELDS) expect(credentialLabelKey(field)).toBe(`payments.credentials.${field}`)
    expect(credentialLabelKey('stripe_key')).toBeUndefined()
    expect(credentialLabelKey('constructor')).toBeUndefined()
  })
})

describe('refusals', () => {
  it('reads the credential input a refusal names', () => {
    expect(failedCredential({ status: 422, code: 'provider_not_configured', field: 'credentials.paymob_hmac_key' })).toBe('paymob_hmac_key')
    expect(failedCredential({ code: 'invalid', field: 'state' })).toBeNull()
    expect(failedCredential({ code: 'invalid', field: 'credentials.' })).toBeNull()
    expect(failedCredential({ code: 'invalid' })).toBeNull()
    expect(failedCredential(new Error('offline'))).toBeNull()
    expect(failedCredential(null)).toBeNull()
  })

  it('words the refusals this page knows and leaves the rest to the API text', () => {
    expect(providerErrorKey({ code: 'provider_not_configured' })).toBe('payments.errors.notConfigured')
    expect(providerErrorKey({ code: 'provider_disabled' })).toBe('payments.errors.disabled')
    expect(providerErrorKey({ code: 'provider_sync_failed' })).toBe('payments.errors.syncFailed')
    expect(providerErrorKey({ code: 'methods_missing' })).toBe('payments.errors.methodsMissing')
    expect(providerErrorKey({ code: 'invalid' })).toBe('payments.errors.invalid')
    expect(providerErrorKey({ code: 'unknown_field' })).toBe('payments.errors.invalid')
    expect(providerErrorKey({ code: 'forbidden' })).toBeNull()
    expect(providerErrorKey({ code: 'toString' })).toBeNull()
    expect(providerErrorKey(undefined)).toBeNull()
  })
})

describe('SYNC_OUTCOMES', () => {
  it('shows a working connection as success and a gateway account missing methods as a warning', () => {
    expect(SYNC_OUTCOMES.synced.color).toBe('success')
    expect(SYNC_OUTCOMES.methods_missing.color).toBe('warning')
    expect(SYNC_OUTCOMES.methods_missing.titleKey).toBe('payments.sync.methodsMissing.title')
  })
})

describe('countryName', () => {
  it('names a country in the UI language from its code', () => {
    expect(countryName('EG', 'en')).toBe('Egypt')
    expect(countryName('SA', 'ar')).toBe('المملكة العربية السعودية')
  })
})

describe('replaceProvider', () => {
  const list: PaymentProviderList = { items: [provider(1), provider(2)], total: 2 }

  it('puts the server answer in the place of the same gateway and keeps the rest', () => {
    const saved = provider(2, 'test')
    const next = replaceProvider(list, saved)
    expect(next.items).toEqual([list.items[0], saved])
    expect(next.total).toBe(2)
  })

  it('does not change the list it was given', () => {
    replaceProvider(list, provider(1, 'enabled'))
    expect(list.items[0]!.state).toBe('disabled')
  })

  it('ignores a gateway that is not in the list', () => {
    expect(replaceProvider(list, provider(9, 'enabled')).items).toEqual(list.items)
  })
})
