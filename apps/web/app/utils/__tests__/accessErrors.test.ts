import { describe, expect, it } from 'vitest'
import { ApiError } from '../../composables/useApi'
import { accessErrorMessage, accessSaveError } from '../accessErrors'

const messages: Record<string, string> = {
  'errors.generic': 'generic',
  'access.errors.conflict': 'conflict text',
  'access.errors.weakPassword': 'weak',
  'access.errors.last_access_admin': 'last admin',
  'access.errors.self_access_change': 'self change text',
  'access.errors.role_disabled': 'role disabled text',
}
const t = (key: string) => messages[key] ?? key

describe('access error messages', () => {
  it('translates a known code, even on a 409', () => {
    expect(accessErrorMessage(new ApiError(409, 'last_access_admin', 'raw'), t)).toBe('last admin')
  })
  it('translates self_access_change and role_disabled, not the raw code', () => {
    expect(accessErrorMessage(new ApiError(422, 'self_access_change', 'self_access_change'), t)).toBe('self change text')
    expect(accessErrorMessage(new ApiError(422, 'role_disabled', 'role_disabled'), t)).toBe('role disabled text')
  })
  it('maps weak_password to its text', () => {
    expect(accessErrorMessage(new ApiError(422, 'weak_password', 'raw'), t)).toBe('weak')
  })
  it('falls back to the conflict text for a 409 with an unknown code, then to the server message', () => {
    expect(accessErrorMessage(new ApiError(409, 'other', 'raw'), t)).toBe('conflict text')
    expect(accessErrorMessage(new ApiError(422, 'missing_dependency', 'server text'), t)).toBe('server text')
    expect(accessErrorMessage(new ApiError(500, '', ''), t)).toBe('generic')
  })
  it('answers the generic text for anything that is not an ApiError', () => {
    expect(accessErrorMessage(new Error('x'), t)).toBe('generic')
  })
  it('rethrows the same status, code and field with the translated message, and leaves a network failure alone', () => {
    const saved = accessSaveError(new ApiError(409, 'last_access_admin', 'raw', 'roles'), t) as ApiError
    expect(saved).toMatchObject({ status: 409, code: 'last_access_admin', field: 'roles', message: 'last admin' })
    const offline = new ApiError(0, 'network', 'offline')
    expect(accessSaveError(offline, t)).toBe(offline)
  })
})
