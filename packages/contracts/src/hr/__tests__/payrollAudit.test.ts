import { describe, expect, it } from 'vitest'
import { HR_PAYROLL_AUDIT_ACTIONS, HrPayrollAuditEventListSchema, HrPayrollAuditEventSchema } from '../payroll'
import ACTIONS from './payroll-audit-actions.golden.json'

const EVENT = {
  id: 4,
  action: 'gosi_rate_changed',
  actor: { id: 7, name: 'مسؤول الرواتب' },
  created_at: '2026-10-25T10:00:00Z',
  res_model: 'webvue.hr.gosi.rate',
  res_id: 12,
  changes: [
    { field: 'employer_rate', old_value: '9.0', new_value: '10.0' },
    { field: 'basic_wage', old_value: null, new_value: null },
  ],
}

describe('payroll audit trail', () => {
  // The same golden file is compared with the Odoo action Selection in webvue_hr/tests/test_payroll_audit.py.
  it('lists exactly the actions the server records', () => {
    expect([...HR_PAYROLL_AUDIT_ACTIONS].sort()).toEqual([...ACTIONS].sort())
  })

  it('parses an event with policy values and name-only fields', () => {
    expect(HrPayrollAuditEventSchema.parse(EVENT)).toEqual(EVENT)
    expect(HrPayrollAuditEventListSchema.parse({ items: [EVENT], total: 1 }).total).toBe(1)
  })

  it('parses a payroll run event that names input codes without amounts', () => {
    const run = {
      ...EVENT, action: 'run_inputs_changed', res_model: 'hr.payslip.run',
      changes: [{ field: 'WV_BONUS', old_value: null, new_value: null }, { field: 'webvue_state', old_value: 'computed', new_value: 'draft' }],
    }
    expect(HrPayrollAuditEventSchema.parse(run)).toEqual(run)
    for (const action of ['run_approved', 'run_cancelled']) {
      expect(HrPayrollAuditEventSchema.parse({ ...run, action }).action).toBe(action)
    }
  })

  it('refuses unknown actions, keys and a change without a field name', () => {
    expect(HrPayrollAuditEventSchema.safeParse({ ...EVENT, action: 'unknown_action' }).success).toBe(false)
    expect(HrPayrollAuditEventSchema.safeParse({ ...EVENT, company_id: 1 }).success).toBe(false)
    expect(HrPayrollAuditEventSchema.safeParse({ ...EVENT, changes: [{ field: '', old_value: null, new_value: null }] }).success).toBe(false)
    expect(HrPayrollAuditEventListSchema.safeParse({ items: [EVENT] }).success).toBe(false)
  })
})
