import { describe, expect, it } from 'vitest'
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
    expect(AUDIT_ACTIONS).toEqual(['chart_loaded', 'account_created', 'account_changed', 'account_archived', 'account_unarchived', 'journal_created', 'journal_changed', 'journal_archived', 'journal_unarchived', 'company_written', 'fiscal_year_closed', 'zatca_onboarded', 'zatca_submitted'])
  })

  it('counts the applied filters', () => {
    expect(auditActiveFilterCount(auditFiltersFromQuery({}))).toBe(0)
    expect(auditActiveFilterCount(auditFiltersFromQuery({ action: 'chart_loaded', date_from: '2026-10-01' }))).toBe(2)
  })

  it('asks the server for one page at the right offset', () => {
    expect(auditListParams(auditFiltersFromQuery({ page: '2', action: 'chart_loaded' })))
      .toEqual({ action: 'chart_loaded', limit: AUDIT_PAGE_SIZE, offset: AUDIT_PAGE_SIZE })
    expect(auditListParams(auditFiltersFromQuery({}))).toEqual({ limit: AUDIT_PAGE_SIZE, offset: 0 })
  })
})

describe('audit time', () => {
  it('formats the moment with Latin digits in the locale of the user', () => {
    expect(formatAuditTime('2026-10-19T09:30:00Z', 'en')).toMatch(/2026/)
    expect(formatAuditTime('2026-10-19T09:30:00Z', 'ar')).toMatch(/2026/)
  })
})
