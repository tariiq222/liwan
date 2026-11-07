import { describe, expect, it } from 'vitest'
import { COMMERCIAL_ERROR_CODES, commercialErrorKey } from '../vendorCommercial'

/**
 * A8: every code the control-plane billing surface can refuse with must resolve to its own message in the vendor
 * console, in both languages. A code missing from the known list falls back to "generic", which tells the operator
 * nothing about what to do next.
 */
const RELEASE1_BILLING_CODES = [
  // the 100-user sales cap
  'users_limit_exceeded',
  // bank transfer recording
  'transfer_amount_mismatch', 'transfer_reference_in_use', 'invoice_not_payable', 'order_not_payable',
  'bank_account_unavailable', 'invalid_value_date',
  // step-up, refunds and settlements
  'step_up_required', 'refund_window_closed', 'refund_not_first_payment', 'refund_not_full', 'invoice_already_refunded',
  // first-order and catalog rules
  'admin_login_required', 'storage_step_invalid', 'onboarding_first_order_only', 'onboarding_unavailable',
  'catalog_source_not_publishable', 'tenant_required',
] as const

type VendorLocales = { vendor: { pricing: { errors: Record<string, string> } } }
const GENERIC = 'vendor.pricing.errors.generic'

describe('commercial error codes', () => {
  it('knows every Release 1 billing refusal code', () => {
    const known = new Set<string>(COMMERCIAL_ERROR_CODES)
    expect(RELEASE1_BILLING_CODES.filter(code => !known.has(code))).toEqual([])
  })

  it('maps each refusal code to its own message key, never the generic one', () => {
    expect(RELEASE1_BILLING_CODES.map(code => [code, commercialErrorKey({ data: { code } })]))
      .toEqual(RELEASE1_BILLING_CODES.map(code => [code, `vendor.pricing.errors.${code}`]))
    expect(RELEASE1_BILLING_CODES.filter(code => commercialErrorKey({ data: { code } }) === GENERIC)).toEqual([])
  })

  it('has a non-empty message for each mapped key in both languages, with identical key sets', async () => {
    const en = (await import('../../../i18n/locales/en/vendor.json')).default as VendorLocales
    const ar = (await import('../../../i18n/locales/ar/vendor.json')).default as VendorLocales
    const messages = (locale: VendorLocales) => locale.vendor.pricing.errors
    for (const code of RELEASE1_BILLING_CODES) {
      const key = commercialErrorKey({ data: { code } }).replace('vendor.pricing.errors.', '')
      expect({ code, en: messages(en)[key]?.trim(), ar: messages(ar)[key]?.trim() })
        .toEqual({ code, en: expect.any(String), ar: expect.any(String) })
      expect(messages(en)[key]!.trim()).not.toBe('')
      expect(messages(ar)[key]!.trim()).not.toBe('')
    }
    // The generic fallback itself stays defined in both languages so an unknown code still renders a message.
    expect(messages(en).generic).toBeTruthy()
    expect(messages(ar).generic).toBeTruthy()
    // Every known code, not only the new ones, has both translations: one language cannot drift from the other.
    expect(COMMERCIAL_ERROR_CODES.filter(code => !messages(en)[code] || !messages(ar)[code])).toEqual([])
  })

  it('falls back to the generic key for an unknown code', () => {
    expect(commercialErrorKey({ data: { code: 'not_a_real_code' } })).toBe(GENERIC)
    // A refusal shaped the way the vendor proxy nests it behaves the same way.
    expect(commercialErrorKey({ data: { data: { code: 'not_a_real_code' } } })).toBe(GENERIC)
    expect(commercialErrorKey({})).toBe(GENERIC)
    expect(commercialErrorKey(new Error('offline'))).toBe(GENERIC)
  })
})
