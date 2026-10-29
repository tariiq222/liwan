import { describe, expect, it } from 'vitest'
import ar from '../../../../../i18n/locales/ar/finance-governance.json'
import en from '../../../../../i18n/locales/en/finance-governance.json'
import { AUDIT_ACTIONS, AUDIT_PAGE_SIZE, auditActiveFilterCount, auditFiltersFromQuery, auditListParams, formatAuditTime } from '../auditParams'

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

  it('offers every action of the contract', () => {
    expect(AUDIT_ACTIONS).toEqual(['account_created', 'account_changed', 'account_archived', 'account_unarchived', 'zakat_adjustment_added', 'zakat_adjustment_removed', 'zakat_reviewed', 'asset_profile_created', 'asset_profile_changed', 'asset_profile_archived', 'asset_profile_unarchived', 'asset_changed', 'asset_deleted', 'asset_disposed', 'bank_statement_imported', 'bank_statement_changed', 'bank_statement_deleted', 'bank_line_unreconciled', 'bank_statement_auto_reconciled', 'payment_created', 'payment_changed', 'payment_posted', 'payment_allocated', 'payment_unallocated', 'invoice_created', 'invoice_changed', 'invoice_deleted', 'invoice_debit_note_created', 'invoice_posted', 'invoice_cancelled', 'invoice_reset_to_draft', 'entry_created', 'entry_changed', 'entry_deleted', 'entry_posted', 'entry_reset_to_draft', 'entry_unreconciled', 'journal_created', 'journal_changed', 'journal_archived', 'journal_unarchived', 'tax_created', 'tax_changed', 'tax_archived', 'tax_unarchived', 'payment_term_created', 'payment_term_changed', 'payment_term_archived', 'payment_term_unarchived', 'company_written', 'fiscal_year_closed', 'zatca_onboarded', 'zatca_submitted'])
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
