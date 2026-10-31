import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import { HR_PAYROLL_AUDIT_ACTIONS } from '@liwan/contracts'
import {
  PAYROLL_AUDIT_PAGE_SIZE, formatPayrollAuditTime, payrollAuditActiveFilterCount, payrollAuditFiltersFromQuery, payrollAuditParams,
} from '../payroll/payrollAuditParams'

describe('payroll audit filters', () => {
  it('reads a known action, ordered days and the page from the route query', () => {
    const filters = payrollAuditFiltersFromQuery({ action: 'run_approved', date_from: '2026-10-01', date_to: '2026-10-31', page: '3' })
    expect(filters).toEqual({ action: 'run_approved', dateFrom: '2026-10-01', dateTo: '2026-10-31', page: 3 })
    expect(payrollAuditActiveFilterCount(filters)).toBe(3)
    expect(payrollAuditParams(filters)).toEqual({
      action: 'run_approved', date_from: '2026-10-01', date_to: '2026-10-31', limit: PAYROLL_AUDIT_PAGE_SIZE, offset: 2 * PAYROLL_AUDIT_PAGE_SIZE,
    })
  })

  it('drops what the API would refuse', () => {
    const filters = payrollAuditFiltersFromQuery({ action: 'nope', date_from: '2026-10-31', date_to: '2026-10-01', page: '-1' })
    expect(filters).toEqual({ action: null, dateFrom: '2026-10-31', dateTo: null, page: 1 })
    expect(payrollAuditParams(filters)).toEqual({ date_from: '2026-10-31', limit: PAYROLL_AUDIT_PAGE_SIZE, offset: 0 })
  })

  it('formats the time with Latin digits', () => {
    expect(formatPayrollAuditTime('2026-10-28T08:02:56Z', 'ar')).toMatch(/2026/)
  })
})

describe('payroll audit page wiring', () => {
  const read = (path: string) => readFileSync(resolve(import.meta.dirname, '../../..', path), 'utf8')
  it('labels every audit action in both languages', () => {
    for (const lang of ['ar', 'en']) {
      const actions = JSON.parse(read(`../i18n/locales/${lang}/hr-payroll.json`)).hrPayroll.audit.actions
      expect(Object.keys(actions).sort()).toEqual([...HR_PAYROLL_AUDIT_ACTIONS].sort())
    }
  })
  it('gates the list with the audit capability and renders it as a list card', () => {
    const list = read('components/hr/payroll/PayrollAuditList.vue')
    for (const part of ["can('hr.payroll.audit.read')", '<SharedListCard', '<SharedFilterBar', '<SharedDataTable', ' bare', '#mobile-row', '<SharedListFooter', '<SharedForbiddenState']) expect(list).toContain(part)
    expect(read('pages/settings/apps/hr/audit.vue')).toContain('<PayrollAuditList')
    expect(read('modules/hr/manifest.ts')).toContain("capability: 'hr.payroll.audit.read', to: '/settings/apps/hr/audit'")
  })
})
