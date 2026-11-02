import { describe, expect, it } from 'vitest'
import { ApiError } from '../useApi'
import {
  hrInsuranceEnrollmentQuery,
  hrInsuranceKeys,
  hrInsurancePlanQuery,
  isHrInsuranceConflict,
  nextOwnHrInsuranceOffset,
} from '../useHrInsurance'

describe('hrInsuranceKeys', () => {
  it('keeps one stable root per resource under hr/insurance', () => {
    expect(hrInsuranceKeys.all).toEqual(['hr', 'insurance'])
    expect(hrInsuranceKeys.enrollment(5)).toEqual(['hr', 'insurance', 'enrollment', 5])
    expect(hrInsuranceKeys.plan(3)).toEqual(['hr', 'insurance', 'plan', 3])
    expect(hrInsuranceKeys.providers).toEqual(['hr', 'insurance', 'providers'])
    expect(hrInsuranceKeys.summary).toEqual(['hr', 'insurance', 'summary'])
    expect(hrInsuranceKeys.plans({ limit: 25, offset: 0 })).toEqual(['hr', 'insurance', 'plans', { limit: 25, offset: 0 }])
  })
})

describe('the list queries', () => {
  it('drops unset enrollment filters and clamps paging', () => {
    expect(hrInsuranceEnrollmentQuery({ employeeId: null, planId: null, state: 'all', expiring: false })).toEqual({
      employee_id: undefined, plan_id: undefined, state: undefined, expiring: undefined, limit: 25, offset: 0,
    })
    expect(hrInsuranceEnrollmentQuery({ employeeId: 7, planId: 3, state: 'active', expiring: true, limit: 500, offset: -3 })).toEqual({
      employee_id: 7, plan_id: 3, state: 'active', expiring: 'true', limit: 100, offset: 0,
    })
    expect(hrInsuranceEnrollmentQuery({ limit: 0, offset: 10 })).toMatchObject({ limit: 25, offset: 10 })
  })

  it('drops unset plan filters', () => {
    expect(hrInsurancePlanQuery({ providerId: null, state: 'all' })).toEqual({ provider_id: undefined, state: undefined, limit: 25, offset: 0 })
    expect(hrInsurancePlanQuery({ providerId: 1, state: 'archived' })).toMatchObject({ provider_id: 1, state: 'archived' })
  })
})

describe('conflicts and own paging', () => {
  it('knows a 409 from any other failure', () => {
    expect(isHrInsuranceConflict(new ApiError(409, 'conflict', 'changed'))).toBe(true)
    expect(isHrInsuranceConflict(new ApiError(422, 'invalid', 'bad'))).toBe(false)
    expect(isHrInsuranceConflict(new Error('x'))).toBe(false)
  })

  it('asks for the next own page until the total is loaded', () => {
    expect(nextOwnHrInsuranceOffset([{ items: [1, 2], total: 5 }])).toBe(2)
    expect(nextOwnHrInsuranceOffset([{ items: [1, 2], total: 5 }, { items: [3, 4, 5], total: 5 }])).toBeUndefined()
    expect(nextOwnHrInsuranceOffset([])).toBeUndefined()
  })
})
