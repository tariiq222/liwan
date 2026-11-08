import { describe, expect, it } from 'vitest'

import {
  DOUBLE_STEP_ERROR_CODES,
  LoginChannelsSchema,
  LoginCodeRequestSchema,
  LoginCodeSentSchema,
  LoginVerifySchema,
} from '../two-step'
import { ProfilePatchSchema, RememberedDeviceListSchema } from '../profile'

describe('login channels', () => {
  it('accepts the two channels and refuses an invented one', () => {
    const answer = { channels: ['email', 'sms'], sms_available: false, has_mobile: true, has_email: true }
    expect(LoginChannelsSchema.parse(answer)).toEqual(answer)
    expect(() => LoginChannelsSchema.parse({ ...answer, channels: ['pigeon'] })).toThrow()
  })

  it('requires a channel and refuses an extra field', () => {
    expect(LoginCodeRequestSchema.parse({ channel: 'sms' })).toEqual({ channel: 'sms' })
    expect(() => LoginCodeRequestSchema.parse({ channel: 'sms', extra: 1 })).toThrow()
    expect(() => LoginCodeRequestSchema.parse({})).toThrow()
  })

  it('reads a sent code answer with the masked destination and the wait', () => {
    const sent = { channel: 'sms', destination: '***011', resend_after: 60 }
    expect(LoginCodeSentSchema.parse(sent)).toEqual(sent)
    expect(() => LoginCodeSentSchema.parse({ ...sent, resend_after: -1 })).toThrow()
  })
})

describe('verifying a code', () => {
  it('takes the code alone, or with remember and a bounded label', () => {
    expect(LoginVerifySchema.parse({ code: '123456' })).toEqual({ code: '123456' })
    expect(LoginVerifySchema.parse({ code: '123456', remember: true, label: 'Chrome' })).toEqual({
      code: '123456', remember: true, label: 'Chrome',
    })
    expect(() => LoginVerifySchema.parse({ code: '123456', label: 'x'.repeat(81) })).toThrow()
    expect(() => LoginVerifySchema.parse({})).toThrow()
  })

  it('names every refusal the page must translate', () => {
    // A code the server can answer with but the page does not know renders as a generic failure.
    expect([...DOUBLE_STEP_ERROR_CODES].sort()).toEqual([
      'channel_unavailable', 'daily_send_cap', 'invalid_channel', 'invalid_code', 'invalid_code_format',
      'invalid_credentials', 'invalid_device', 'login_refused', 'no_pending_login', 'resend_cooldown',
      'send_limit_reached', 'tenant_suspended',
    ])
  })
})

describe('profile and devices', () => {
  it('requires at least one profile field and refuses an unknown one', () => {
    expect(ProfilePatchSchema.parse({ lang: 'en' })).toEqual({ lang: 'en' })
    expect(() => ProfilePatchSchema.parse({})).toThrow()
    expect(() => ProfilePatchSchema.parse({ name: 'x' })).toThrow()
  })

  it('lists remembered devices without any token', () => {
    const list = {
      items: [{ id: 1, label: 'Chrome', issued_at: '2026-01-01T00:00:00Z', expires_at: null, last_used_at: null }],
      total: 1,
    }
    expect(RememberedDeviceListSchema.parse(list)).toEqual(list)
    expect(() => RememberedDeviceListSchema.parse({ ...list, items: [{ id: 1, label: 'C', token: 'secret' }] })).toThrow()
  })
})
