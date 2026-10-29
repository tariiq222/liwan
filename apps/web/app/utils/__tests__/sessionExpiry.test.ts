import { describe, expect, it } from 'vitest'
import { ApiError } from '../../composables/useApi'
import { isDifferentUser, isPossibleSessionExpiry } from '../sessionExpiry'

describe('isPossibleSessionExpiry', () => {
  it.each(['tenant_read_only', 'feature_not_included', 'transition_forbidden', 'status_forbidden', 'tenant_suspended'])(
    'does not re-check the session for the %s refusal of a still valid session',
    code => expect(isPossibleSessionExpiry(new ApiError(403, code, 'x'))).toBe(false),
  )

  it.each([['session_required', 403], ['forbidden', 403], ['session_required', 401], ['unauthorized', 401]] as const)('re-checks the session for %s', (code, status) => {
    expect(isPossibleSessionExpiry(new ApiError(status, code, 'x'))).toBe(true)
  })

  it('ignores other statuses and errors that are not API errors', () => {
    expect(isPossibleSessionExpiry(new ApiError(404, 'not_found', 'x'))).toBe(false)
    expect(isPossibleSessionExpiry(new Error('x'))).toBe(false)
  })
})

describe('isDifferentUser', () => {
  it('flags only a switch from one signed-in user to another', () => {
    expect(isDifferentUser({ id: 1 }, { id: 2 })).toBe(true)
    expect(isDifferentUser({ id: 1 }, { id: 1 })).toBe(false)
    expect(isDifferentUser(null, { id: 2 })).toBe(false)
    expect(isDifferentUser({ id: 1 }, null)).toBe(false)
  })
})
