import { describe, expect, it } from 'vitest'
import { hrLifecycleKeys, hrPlanListQuery, hrRunListQuery } from '../useHrOnboarding'

describe('hr lifecycle plan and run queries', () => {
  it('maps the plan list params onto the API query', () => {
    expect(hrPlanListQuery({ active: 'all', limit: 25, offset: 50 })).toEqual({ active: 'all', limit: 25, offset: 50 })
    expect(hrPlanListQuery({ active: 'true', limit: 25, offset: 0 })).toEqual({ active: 'true', limit: 25, offset: 0 })
  })

  it('leaves unset run filters out of the query', () => {
    expect(hrRunListQuery({ limit: 25, offset: 0 })).toEqual({
      employee_id: undefined, state: undefined, limit: 25, offset: 0,
    })
    expect(hrRunListQuery({ employee_id: 7, state: 'open', limit: 25, offset: 25 })).toEqual({
      employee_id: 7, state: 'open', limit: 25, offset: 25,
    })
  })

  it('keeps the area, plan and run keys distinct', () => {
    expect(hrLifecycleKeys.area('onboarding')).toEqual(['hr', 'onboarding'])
    expect(hrLifecycleKeys.plans('onboarding', { active: 'true', limit: 25, offset: 0 }))
      .toEqual(['hr', 'onboarding', 'plans', { active: 'true', limit: 25, offset: 0 }])
    expect(hrLifecycleKeys.plan('onboarding', 4)).toEqual(['hr', 'onboarding', 'plan', 4])
    expect(hrLifecycleKeys.runs('onboarding', { limit: 25, offset: 0 }))
      .toEqual(['hr', 'onboarding', 'runs', { limit: 25, offset: 0 }])
    expect(hrLifecycleKeys.run('offboarding', 8)).toEqual(['hr', 'offboarding', 'run', 8])
  })
})
