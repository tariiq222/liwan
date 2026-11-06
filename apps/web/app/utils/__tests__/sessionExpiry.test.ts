import { describe, expect, it } from 'vitest'
import { ApiError } from '../../composables/useApi'
import { sessionIdentityKey, sessionViewKey, isPossibleSessionExpiry } from '../sessionExpiry'

describe('isPossibleSessionExpiry', () => {
  it.each(['forbidden', 'tenant_read_only', 'feature_not_included', 'transition_forbidden', 'status_forbidden', 'tenant_suspended'])(
    'does not re-check the session for the %s refusal of a still valid session',
    code => expect(isPossibleSessionExpiry(new ApiError(403, code, 'x'))).toBe(false),
  )

  it.each(['session_required', 'unauthorized'])('re-checks the session for the 401 %s', code => {
    expect(isPossibleSessionExpiry(new ApiError(401, code, 'x'))).toBe(true)
  })

  it('ignores other statuses and errors that are not API errors', () => {
    expect(isPossibleSessionExpiry(new ApiError(404, 'not_found', 'x'))).toBe(false)
    expect(isPossibleSessionExpiry(new Error('x'))).toBe(false)
  })
})

describe('session view identity', () => {
  it('names user and company separately and keeps equal identities stable', () => {
    const first = { id: 1, company: { id: 2 } }
    expect(sessionIdentityKey(first)).toBe(sessionIdentityKey({ ...first }))
    expect(sessionIdentityKey(first)).not.toBe(sessionIdentityKey({ id: 2, company: { id: 2 } }))
    expect(sessionIdentityKey(first)).not.toBe(sessionIdentityKey({ id: 1, company: { id: 3 } }))
  })
  it.each([null, undefined])('names an absent identity consistently (%s)', absent => {
    expect(sessionIdentityKey(absent)).toBe('anonymous')
  })
  it.each(['public', 'guest'])('keeps the %s view independent of private identity', access => {
    expect(sessionViewKey('1:1', access)).toBe(sessionViewKey('2:2', access))
    expect(sessionViewKey('anonymous', access)).toBe('public')
  })
})
