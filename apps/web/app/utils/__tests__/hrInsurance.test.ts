import { describe, expect, it } from 'vitest'
import {
  canChangeHrInsuranceEnrollment,
  hrInsuranceCoverage,
  hrInsuranceEnrollmentBadge,
  hrInsurancePlanBadge,
  hrInsuranceShareTotal,
  isHrInsurancePlanExpiring,
} from '../hrInsurance'

describe('hrInsurance badges', () => {
  it('colours a plan by its derived state', () => {
    expect(hrInsurancePlanBadge('active')).toEqual({ tone: 'success', labelKey: 'hrInsurance.planState.active' })
    expect(hrInsurancePlanBadge('expired').tone).toBe('warning')
    expect(hrInsurancePlanBadge('archived').tone).toBe('neutral')
  })

  it('colours an enrollment by its state', () => {
    expect(hrInsuranceEnrollmentBadge('active').tone).toBe('success')
    expect(hrInsuranceEnrollmentBadge('ended').labelKey).toBe('hrInsurance.enrollmentState.ended')
    expect(hrInsuranceEnrollmentBadge('cancelled').tone).toBe('neutral')
  })
})

describe('hrInsurance rules', () => {
  it('flags only a running plan inside the alert window', () => {
    expect(isHrInsurancePlanExpiring({ state: 'active', expires_in_days: 30 }, 60)).toBe(true)
    expect(isHrInsurancePlanExpiring({ state: 'active', expires_in_days: 61 }, 60)).toBe(false)
    expect(isHrInsurancePlanExpiring({ state: 'expired', expires_in_days: -3 }, 60)).toBe(false)
    expect(isHrInsurancePlanExpiring({ state: 'archived', expires_in_days: null }, 60)).toBe(false)
  })

  it('lets a manager change an active enrollment only', () => {
    expect(canChangeHrInsuranceEnrollment({ state: 'active' }, true)).toBe(true)
    expect(canChangeHrInsuranceEnrollment({ state: 'active' }, false)).toBe(false)
    expect(canChangeHrInsuranceEnrollment({ state: 'ended' }, true)).toBe(false)
  })

  it('reads the coverage end from the plan while the enrollment is open', () => {
    expect(hrInsuranceCoverage({ date_from: '2026-02-01', date_to: null, date_end: '2026-12-31' })).toEqual({ from: '2026-02-01', to: '2026-12-31', open: true })
    expect(hrInsuranceCoverage({ date_from: '2026-02-01', date_to: '2026-06-01', date_end: '2026-06-01' }).open).toBe(false)
  })

  it('adds the shares and keeps none as null', () => {
    expect(hrInsuranceShareTotal({ employee_share: 100, company_share: 300 })).toBe(400)
    expect(hrInsuranceShareTotal({ employee_share: null, company_share: 300 })).toBe(300)
    expect(hrInsuranceShareTotal({ employee_share: null, company_share: null })).toBeNull()
  })
})
