import { describe, expect, it } from 'vitest'
import ar from '../../../../../i18n/locales/ar/finance-governance.json'
import en from '../../../../../i18n/locales/en/finance-governance.json'
import { FinanceAuditActionSchema } from '@liwan/contracts'
import { AUDIT_ACTIONS, AUDIT_PAGE_SIZE, auditActiveFilterCount, auditFiltersFromQuery, auditListParams, auditOutcome, auditRecordKey, formatAuditTime } from '../auditParams'

describe('audit list filters', () => {
  it('reads the action, the days and the page out of the query', () => {
    expect(auditFiltersFromQuery({ action: 'zatca_onboarded', date_from: '2026-10-01', date_to: '2026-10-20', page: '3' }))
      .toEqual({ action: 'zatca_onboarded', dateFrom: '2026-10-01', dateTo: '2026-10-20', page: 3 })
  })

  it('drops what the API would refuse', () => {
    expect(auditFiltersFromQuery({ action: 'delete_everything', date_from: 'yesterday', page: '0' }))
      .toEqual({ action: null, dateFrom: null, dateTo: null, page: 1 })
    expect(auditFiltersFromQuery({ date_from: '2026-10-20', date_to: '2026-10-01' }).dateTo).toBeNull()
  })

  it('offers every action of the contract, including the ones added for payments, assets, budgets and partners', () => {
    expect(AUDIT_ACTIONS).toEqual(FinanceAuditActionSchema.options)
    expect(AUDIT_ACTIONS).toEqual(expect.arrayContaining(['payment_cancelled', 'asset_validated', 'budget_confirmed', 'partner_created', 'analytic_account_changed', 'bank_line_reconciled']))
  })

  it('names every action of the contract in both locales', () => {
    for (const labels of [ar.financeGovernance.audit.actions, en.financeGovernance.audit.actions]) {
      expect(Object.keys(labels).sort()).toEqual([...AUDIT_ACTIONS].sort())
    }
  })

  it('counts the applied filters', () => {
    expect(auditActiveFilterCount(auditFiltersFromQuery({}))).toBe(0)
    expect(auditActiveFilterCount(auditFiltersFromQuery({ action: 'company_written', date_from: '2026-10-01' }))).toBe(2)
  })

  it('asks the server for one page at the right offset', () => {
    expect(auditListParams(auditFiltersFromQuery({ page: '2', action: 'company_written' })))
      .toEqual({ action: 'company_written', limit: AUDIT_PAGE_SIZE, offset: AUDIT_PAGE_SIZE })
    expect(auditListParams(auditFiltersFromQuery({}))).toEqual({ limit: AUDIT_PAGE_SIZE, offset: 0 })
  })
})

describe('audit time', () => {
  it('formats the moment with Latin digits in the locale of the user', () => {
    expect(formatAuditTime('2026-10-19T09:30:00Z', 'en')).toMatch(/2026/)
    expect(formatAuditTime('2026-10-19T09:30:00Z', 'ar')).toMatch(/2026/)
  })
})

describe('audit record and outcome text', () => {
  it('names the kind of record, telling an invoice from a journal entry', () => {
    expect(auditRecordKey({ action: 'invoice_posted', res_model: 'account.move' })).toBe('invoice')
    expect(auditRecordKey({ action: 'entry_posted', res_model: 'account.move' })).toBe('entry')
    expect(auditRecordKey({ action: 'zakat_reviewed', res_model: 'liwan.finance.zakat.review' })).toBe('liwan_finance_zakat_review')
    expect(auditRecordKey({ action: 'zakat_reviewed', res_model: 'something.else' })).toBe('other')
  })

  it('turns the stored outcome into a locale key with its figures', () => {
    expect(auditOutcome('base 2416.0')).toEqual({ key: 'zakatBase', params: { amount: '2416.0' } })
    expect(auditOutcome('12 lines, 3 reconciled')).toEqual({ key: 'linesReconciled', params: { lines: '12', reconciled: '3' } })
    expect(auditOutcome('add 10.5')).toEqual({ key: 'zakatAdjustment', params: { kind: 'add', amount: '10.5' } })
    expect(auditOutcome('2026:closed')).toEqual({ key: 'yearClosed', params: { year: '2026', state: 'closed' } })
    expect(auditOutcome('posted')).toBeNull()
  })

  it('has a label for every kind of record and every outcome shape in both locales', () => {
    for (const audit of [ar.financeGovernance.audit, en.financeGovernance.audit]) {
      const keys = ['invoice', 'entry', 'move', 'other', 'res_partner', 'mis_budget_by_account', 'account_bank_statement']
      for (const key of keys) expect(audit.records).toHaveProperty(key)
      for (const key of ['linesReconciled', 'lines', 'entries', 'statement', 'soldFor', 'zakatBase', 'zakatAdjustment', 'yearClosed']) expect(audit.outcomeShapes).toHaveProperty(key)
    }
  })
})
