import { describe, expect, it } from 'vitest'
import { pickAcceptBody } from '../invitation-accept'

describe('pickAcceptBody', () => {
  it('keeps only token and password', () => {
    expect(pickAcceptBody({ token: 't', password: 'p', tenant_id: 'x', extra: 1 })).toEqual({ token: 't', password: 'p' })
  })
  it('rejects malformed bodies', () => {
    for (const b of [null, [], 'x', {}, { token: 't' }, { token: 1, password: 'p' }, { token: '', password: 'p' }, { token: 't', password: 'p'.repeat(300) }]) expect(pickAcceptBody(b)).toBeNull()
  })
})
