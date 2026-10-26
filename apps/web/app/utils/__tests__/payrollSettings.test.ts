import { describe, expect, it } from 'vitest'
import { HrPayrollSettingsPatchSchema, type HrGosiRate, type HrPayrollSettings } from '@webvue/contracts'
import { gosiRatePatch, payrollSettingsPatch } from '../payrollSettings'

const settings: HrPayrollSettings = {
  day_divisor: 30, structure: { id: 1, name: 'هيكل' }, unpaid_leave_types: [{ id: 3, name: 'بدون راتب' }], annual_leave_type: { id: 1, name: 'سنوية' }, revision: 2,
}
const same = { dayDivisor: '30', unpaidLeaveTypes: ['3'], annualLeaveType: '1' }

describe('payrollSettingsPatch', () => {
  it('is empty for an untouched form', () => {
    expect(payrollSettingsPatch(settings, same)).toEqual({})
  })

  it('sends only what changed and always satisfies the contract', () => {
    const patch = payrollSettingsPatch(settings, { dayDivisor: '31', unpaidLeaveTypes: ['3', '2'], annualLeaveType: '2' })
    expect(patch).toEqual({ day_divisor: 31, unpaid_leave_type_ids: [2, 3], annual_leave_type_id: 2 })
    expect(HrPayrollSettingsPatchSchema.safeParse({ ...patch, revision: settings.revision }).success).toBe(true)
  })

  it('never sends a null annual leave type, and sends none while none is chosen', () => {
    const patch = payrollSettingsPatch({ ...settings, annual_leave_type: null }, { ...same, annualLeaveType: undefined })
    expect(patch).toEqual({})
    expect(HrPayrollSettingsPatchSchema.safeParse({ annual_leave_type_id: null, revision: settings.revision }).success).toBe(false)
  })
})

describe('gosiRatePatch', () => {
  const rate = { id: 2, branch: 'saned', nationality_class: 'gcc', date_from: '2026-01-01', employee_rate: 1, employer_rate: 2, wage_min: 0, wage_max: 100, shared: false, revision: 1 } as HrGosiRate
  const { id: _id, shared: _shared, revision: _revision, ...data } = rate

  it('keeps only the changed fields', () => {
    expect(gosiRatePatch(rate, data)).toEqual({})
    expect(gosiRatePatch(rate, { ...data, employee_rate: 1.5, wage_max: 200 })).toEqual({ employee_rate: 1.5, wage_max: 200 })
  })
})
