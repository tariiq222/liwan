import { describe, expect, it } from 'vitest'
import { hrDepartmentKeys } from '../useHrDepartments'
import { hrEmployeeKeys } from '../useHrEmployees'
import { hrLeaveKeys, hrLeaveRequestQuery } from '../useHrLeave'

describe('hr query keys', () => {
  it('departments list is [hr, departments]', () => {
    expect(hrDepartmentKeys.list).toEqual(['hr', 'departments'])
  })

  it('employees list includes params', () => {
    const params = { q: 'سارة', department_id: 4 }
    expect(hrEmployeeKeys.list(params)).toEqual(['hr', 'employees', params])
  })

  it('employee detail is [hr, employee, id]', () => {
    expect(hrEmployeeKeys.detail(10)).toEqual(['hr', 'employee', 10])
  })

  it('leave keys share one root so a decision refreshes balances and every list', () => {
    const params = { scope: 'pending' as const, limit: 25, offset: 0 }
    expect(hrLeaveKeys.requests(params).slice(0, 2)).toEqual(hrLeaveKeys.all)
    expect(hrLeaveKeys.balances(null).slice(0, 2)).toEqual(hrLeaveKeys.all)
    expect(hrLeaveKeys.types.slice(0, 2)).toEqual(hrLeaveKeys.all)
  })

  it('maps each leave scope to its request query', () => {
    expect(hrLeaveRequestQuery({ scope: 'mine', limit: 25, offset: 0 })).toEqual({ mine: '1', state: undefined, limit: 25, offset: 0 })
    expect(hrLeaveRequestQuery({ scope: 'pending', limit: 25, offset: 25 })).toEqual({ mine: undefined, state: 'confirm', limit: 25, offset: 25 })
    expect(hrLeaveRequestQuery({ scope: 'all', limit: 25, offset: 0 })).toEqual({ mine: undefined, state: undefined, limit: 25, offset: 0 })
  })
})
