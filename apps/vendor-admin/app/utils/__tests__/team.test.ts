import { describe, expect, it } from 'vitest'
import { StepUpCancelled } from '../../composables/useStepUp'
import { VENDOR_ROLES } from '@webvue/commercial-contracts'
import { invitationLink, reasonValid, sortedRoles, teamErrorKey } from '../team'

describe('team vocabulary', () => {
  it('knows exactly the six control-plane roles', () => {
    expect([...VENDOR_ROLES]).toEqual(['owner', 'customer_success', 'finance', 'product', 'operations', 'support'])
  })

  it('keeps known roles in canonical order and drops anything else', () => {
    expect(sortedRoles(['support', 'owner', 'admin', 'support'])).toEqual(['owner', 'support'])
  })

  it('accepts a reason of 3 to 1000 characters after trimming', () => {
    expect(reasonValid('  ab ')).toBe(false)
    expect(reasonValid(' abc ')).toBe(true)
    expect(reasonValid('x'.repeat(1000))).toBe(true)
    expect(reasonValid('x'.repeat(1001))).toBe(false)
  })

  it('puts the secret in the fragment of the enrollment address', () => {
    expect(invitationLink('https://admin.example.test', 'tok')).toBe('https://admin.example.test/enroll#tok')
  })
})

describe('team error messages', () => {
  const failure = (statusCode: number, code?: string) => ({ statusCode, data: code ? { code } : undefined })

  it('names the last-owner and duplicate-email refusals', () => {
    expect(teamErrorKey(failure(409, 'last_owner'))).toBe('team.errors.lastOwner')
    expect(teamErrorKey(failure(409, 'conflict'))).toBe('team.errors.conflict')
  })

  it('maps the other control-plane answers', () => {
    expect(teamErrorKey(failure(422, 'invalid'))).toBe('team.errors.invalid')
    expect(teamErrorKey(failure(403))).toBe('team.errors.forbidden')
    expect(teamErrorKey(failure(403, 'step_up_required'))).toBe('team.errors.stepUpRequired')
    expect(teamErrorKey(failure(429, 'rate_limited'))).toBe('team.errors.rateLimited')
    expect(teamErrorKey(failure(503, 'vendor_unavailable'))).toBe('team.errors.unavailable')
    expect(teamErrorKey(new Error('boom'))).toBe('team.errors.generic')
  })

  it('tells a cancelled step-up apart from a failed call', () => {
    expect(teamErrorKey(new StepUpCancelled())).toBe('team.errors.stepUpCancelled')
  })
})
