import { describe, expect, it } from 'vitest'
import { MailDomainSchema } from '@liwan/contracts'
import { ApiError } from '../../useApi'
import { mailDomainErrorKey, mailDomainShown, returnPathHoursLeft } from '../useMailDomain'

const domain = (overrides: Record<string, unknown> = {}) => MailDomainSchema.parse({
  state: 'not_started', domain: null, from_local_part: null, sender_address: null, records: [],
  return_path_expires_at: null, return_path_recreated_at: null, verified_at: null, last_error: null,
  paused: false, pause_reason: null, provider_configured: true, ...overrides,
})

describe('mailDomainErrorKey', () => {
  it('maps each refusal code to its localized message', () => {
    expect(mailDomainErrorKey(new ApiError(403, 'forbidden', 'x'))).toBe('settings.mail.errors.forbidden')
    expect(mailDomainErrorKey(new ApiError(404, 'commercial_unavailable', 'x'))).toBe('settings.mail.errors.unavailable')
    expect(mailDomainErrorKey(new ApiError(404, 'not_found', 'x'))).toBe('settings.mail.errors.unavailable')
    expect(mailDomainErrorKey(new ApiError(409, 'domain_taken', 'x'))).toBe('settings.mail.errors.domainTaken')
    expect(mailDomainErrorKey(new ApiError(422, 'mail_domain_unverified', 'x'))).toBe('settings.mail.errors.unverified')
    expect(mailDomainErrorKey(new ApiError(422, 'invalid', 'x'))).toBe('settings.mail.errors.invalid')
    expect(mailDomainErrorKey(new ApiError(502, 'provider_error', 'x'))).toBe('settings.mail.errors.providerError')
    expect(mailDomainErrorKey(new ApiError(503, 'provider_unavailable', 'x'))).toBe('settings.mail.errors.providerUnavailable')
    expect(mailDomainErrorKey(new ApiError(422, 'mail_paused', 'x'))).toBe('settings.mail.errors.paused')
    expect(mailDomainErrorKey(new ApiError(409, 'mail_paused', 'x', undefined, { reason: 'bounces' }))).toBe('settings.mail.errors.paused')
    expect(mailDomainErrorKey(new ApiError(409, 'busy', 'x'))).toBe('settings.mail.errors.busy')
  })

  it('falls back on the status class, then on the generic message', () => {
    expect(mailDomainErrorKey(new ApiError(409, 'other', 'x'))).toBe('settings.mail.errors.domainTaken')
    expect(mailDomainErrorKey(new ApiError(422, 'other', 'x'))).toBe('settings.mail.errors.invalid')
    expect(mailDomainErrorKey(new ApiError(500, 'http_error', 'x'))).toBe('errors.generic')
    expect(mailDomainErrorKey(new Error('boom'))).toBe('errors.generic')
    expect(mailDomainErrorKey(null)).toBe('errors.generic')
  })
})

describe('mailDomainShown', () => {
  it('hides the card until the answer arrives and when the provider is not configured', () => {
    expect(mailDomainShown(undefined)).toBe(false)
    expect(mailDomainShown(domain({ provider_configured: false }))).toBe(false)
    expect(mailDomainShown(domain())).toBe(true)
  })
})

describe('returnPathHoursLeft', () => {
  const now = Date.parse('2026-11-16T00:00:00Z')
  it('counts whole hours to the expiry and never goes negative', () => {
    expect(returnPathHoursLeft(domain({ return_path_expires_at: '2026-11-17T06:30:00Z' }), now)).toBe(30)
    expect(returnPathHoursLeft(domain({ return_path_expires_at: '2026-11-15T00:00:00Z' }), now)).toBe(0)
  })

  it('returns null without an expiry or with an unreadable one', () => {
    expect(returnPathHoursLeft(domain(), now)).toBeNull()
    expect(returnPathHoursLeft(domain({ return_path_expires_at: 'soon' }), now)).toBeNull()
  })
})
