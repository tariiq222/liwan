import { describe, expect, it } from 'vitest'
import { acceptOutcome, pickAcceptBody } from '../invitation-accept'

describe('pickAcceptBody', () => {
  it('keeps only token and password', () => {
    expect(pickAcceptBody({ token: 't', password: 'p', tenant_id: 'x', extra: 1 })).toEqual({ token: 't', password: 'p' })
  })
  it('rejects malformed bodies', () => {
    for (const b of [null, [], 'x', {}, { token: 't' }, { token: 1, password: 'p' }, { token: '', password: 'p' }, { token: 't', password: 'p'.repeat(300) }]) expect(pickAcceptBody(b)).toBeNull()
  })
})

describe('acceptOutcome', () => {
  it('passes through the outcomes only a valid token reaches, with their control-plane status', () => {
    expect(acceptOutcome(422, 'password_rejected')).toMatchObject({ status: 422, code: 'password_rejected' })
    expect(acceptOutcome(409, 'account_unavailable')).toMatchObject({ status: 409, code: 'account_unavailable' })
    expect(acceptOutcome(409, 'in_progress')).toMatchObject({ status: 409, code: 'in_progress' })
  })
  it('keeps every other failure generic, so the token stays no oracle', () => {
    for (const [status, code] of [[400, 'invalid_invitation'], [409, 'password_rejected'], [422, 'in_progress'], [400, undefined], [404, 'not_found'], [503, 'unavailable']] as const) {
      expect(acceptOutcome(status, code)).toBeNull()
    }
  })
})
