import {
  FinanceSetupCompanyInputSchema,
  FinanceSetupFiscalInputSchema,
  FinanceSetupSchema,
  FinanceVatSummarySchema,
  FinanceZatcaReadinessSchema,
} from '..'

const ZATCA = {
  installed: true,
  api_mode: 'sandbox',
  private_key_present: true,
  journals: [{ journal: { id: 7, name: 'Sales' }, onboarded: false, state: 'compliance_checked' }],
  onboarded: false,
}
const SETUP = {
  chart: { loaded: true, template: 'sa', accounts_count: 178 },
  company: {
    name: 'شركة النور',
    vat: '300000000000003',
    company_registry: '1010000000',
    street: 'طريق الملك فهد',
    city: 'الرياض',
    state: { id: 1, name: 'Riyadh' },
    country: { id: 192, name: 'Saudi Arabia' },
    currency: 'SAR',
    missing_fields: [],
  },
  fiscal: {
    fiscalyear_last_day: 31,
    fiscalyear_last_month: 12,
    fiscalyear_lock_date: null,
    tax_lock_date: '2026-06-30',
    sale_lock_date: null,
    purchase_lock_date: null,
    hard_lock_date: null,
  },
  journals: { sale: 1, purchase: 1, bank: 1, cash: 1 },
  taxes: { sale_count: 8, purchase_count: 8, vat_15_present: true },
  zatca: ZATCA,
  ready: false,
  blockers: ['zatca_not_onboarded'],
}
const ROW = { tax: { id: 2, name: 'VAT 15%' }, rate: 15, base: 1000, tax_amount: 150 }
const SECTION = { taxes: [ROW], base: 1000, tax_amount: 150 }
const SUMMARY = {
  date_from: '2026-10-01',
  date_to: '2026-10-31',
  currency: 'SAR',
  sales: SECTION,
  purchases: { taxes: [{ ...ROW, base: 400, tax_amount: 60 }], base: 400, tax_amount: 60 },
  net_payable: 90,
}

describe('finance setup contracts', () => {
  it('accepts the setup status, with and without ZATCA', () => {
    expect(FinanceSetupSchema.parse(SETUP)).toEqual(SETUP)
    const plain = { ...SETUP, zatca: { installed: false } }
    expect(FinanceSetupSchema.parse(plain)).toEqual(plain)
  })

  it('refuses an unknown blocker, a stray key and a secret smuggled into ZATCA', () => {
    expect(() => FinanceSetupSchema.parse({ ...SETUP, blockers: ['made_up'] })).toThrow()
    expect(() => FinanceSetupSchema.parse({ ...SETUP, extra: 1 })).toThrow()
    expect(() => FinanceZatcaReadinessSchema.parse({ ...ZATCA, private_key: 'x' })).toThrow()
    expect(() => FinanceZatcaReadinessSchema.parse({ installed: false, api_mode: 'prod' })).toThrow()
  })

  it('validates the two PATCH bodies', () => {
    expect(FinanceSetupCompanyInputSchema.parse({ vat: '300000000000003', state_id: null })).toBeTruthy()
    expect(() => FinanceSetupCompanyInputSchema.parse({ currency: 'USD' })).toThrow()
    expect(FinanceSetupFiscalInputSchema.parse({ fiscalyear_last_month: 6, tax_lock_date: null })).toBeTruthy()
    expect(() => FinanceSetupFiscalInputSchema.parse({ fiscalyear_last_month: 13 })).toThrow()
    expect(() => FinanceSetupFiscalInputSchema.parse({ hard_lock_date: '2026-01-01' })).toThrow()
  })
})

describe('finance VAT report contract', () => {
  it('accepts the summary and a fixed-amount tax with no rate', () => {
    expect(FinanceVatSummarySchema.parse(SUMMARY)).toEqual(SUMMARY)
    const fixed = { ...SUMMARY, sales: { ...SECTION, taxes: [{ ...ROW, rate: null }] } }
    expect(FinanceVatSummarySchema.parse(fixed)).toEqual(fixed)
  })

  it('refuses a malformed day and a stray key', () => {
    expect(() => FinanceVatSummarySchema.parse({ ...SUMMARY, date_from: '01/10/2026' })).toThrow()
    expect(() => FinanceVatSummarySchema.parse({ ...SUMMARY, total: 1 })).toThrow()
  })
})
