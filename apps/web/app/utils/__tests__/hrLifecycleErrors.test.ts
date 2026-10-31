import { describe, expect, it } from 'vitest'
import { ApiError } from '../../composables/useApi'
import { lifecycleLaunchErrorMessage } from '../hrLifecycleErrors'

const t = (key: string) => key

describe('lifecycleLaunchErrorMessage', () => {
  it('words a missing manager or coach in the page language', () => {
    expect(lifecycleLaunchErrorMessage(new ApiError(422, 'manager_missing', 'English', 'employee_id'), t, 'fallback')).toBe('hr.lifecycleErrors.manager_missing')
    expect(lifecycleLaunchErrorMessage(new ApiError(422, 'coach_missing', 'English', 'employee_id'), t, 'fallback')).toBe('hr.lifecycleErrors.coach_missing')
  })

  it('keeps the server message of any other refusal and the fallback for a non-API failure', () => {
    expect(lifecycleLaunchErrorMessage(new ApiError(422, 'invalid', 'plan is inactive'), t, 'fallback')).toBe('plan is inactive')
    expect(lifecycleLaunchErrorMessage(new Error('boom'), t, 'fallback')).toBe('fallback')
  })
})
