import { describe, expect, it } from 'vitest'
import { DOUBLE_STEP_ERROR_CODES } from '@liwan/contracts'
import {
  asciiDigits,
  errorCode,
  errorDetails,
  errorKey,
  errorSeconds,
  isCompleteCode,
  normalizeCode,
  offeredChannels,
  preferredChannel,
  secondsLeft,
  smsUnavailable,
} from '../loginFlow'

const channels = (over: Partial<Parameters<typeof offeredChannels>[0]> = {}) => ({
  channels: ['sms', 'email'] as ('sms' | 'email')[],
  sms_available: true,
  has_mobile: true,
  has_email: true,
  ...over,
})

describe('the refusal vocabulary of the two steps', () => {
  it('maps every machine code the server may answer with', () => {
    for (const code of DOUBLE_STEP_ERROR_CODES) {
      expect(errorKey(code), code).not.toBe('auth.loginFailed')
      expect(errorKey(code), code).toMatch(/^auth\./)
    }
  })

  it('maps the codes listed in the sign-in brief, each to its own sentence', () => {
    const keys = [
      'invalid_code', 'invalid_code_format', 'invalid_device', 'no_pending_login', 'resend_cooldown',
      'send_limit_reached', 'daily_send_cap', 'channel_unavailable', 'tenant_suspended',
      'login_refused', 'invalid_credentials',
    ].map(code => errorKey(code))
    // A shared sentence would hide which refusal happened.
    expect(new Set(keys).size).toBe(keys.length)
    // The one deliberate pair: the page only sends a channel the server offered, so an unknown channel is the
    // same state as an unavailable one.
    expect(errorKey('invalid_channel')).toBe(errorKey('channel_unavailable'))
  })

  it('falls back to the generic sign-in failure for anything unmapped', () => {
    expect(errorKey('http_error')).toBe('auth.loginFailed')
    expect(errorKey(undefined)).toBe('auth.loginFailed')
    expect(errorKey('')).toBe('auth.loginFailed')
  })

  it('reads the code and its details out of the Nitro envelope, nested or not', () => {
    expect(errorCode({ data: { code: 'invalid_code' } })).toBe('invalid_code')
    expect(errorCode({ data: { data: { code: 'invalid_device' } } })).toBe('invalid_device')
    expect(errorCode({ data: { message: 'no code' } })).toBeUndefined()
    expect(errorCode(null)).toBeUndefined()
    expect(errorDetails({ data: { details: { resend_after: 42 } } })).toEqual({ resend_after: 42 })
    expect(errorDetails({ data: { data: { details: { resend_after: 42 } } } })).toEqual({ resend_after: 42 })
    expect(errorDetails({ data: {} })).toBeUndefined()
  })

  it('turns a cooldown into the seconds the button must wait, never a negative or invented one', () => {
    expect(errorSeconds({ data: { details: { resend_after: 42 } } })).toBe(42)
    expect(errorSeconds({ data: { details: { resend_after: 42.2 } } })).toBe(43)
    expect(errorSeconds({ data: { details: { resend_after: 0 } } })).toBe(0)
    expect(errorSeconds({ data: { details: { resend_after: -5 } } })).toBe(0)
    expect(errorSeconds({ data: {} })).toBe(0)
    expect(errorSeconds(new Error('network'))).toBe(0)
  })
})

describe('the code the person types', () => {
  it('accepts Arabic-Indic and Eastern Arabic-Indic digits, as the server normalizes them', () => {
    expect(normalizeCode('١٢٣٤٥٦')).toBe('123456')
    expect(normalizeCode('۱۲۳۴۵۶')).toBe('123456')
    expect(normalizeCode('⁦123456⁩')).toBe('123456')
    expect(normalizeCode('12 34 56')).toBe('123456')
    expect(isCompleteCode('١٢٣٤٥٦')).toBe(true)
  })

  it('refuses anything that is not exactly six digits', () => {
    for (const value of ['', '12345', '1234567', 'abcdef', '１２３４５', '12345a']) {
      expect(normalizeCode(value), value).toBeNull()
      expect(isCompleteCode(value), value).toBe(false)
    }
  })

  it('translates only the two digit blocks', () => {
    expect(asciiDigits('a١b۲c')).toBe('a1b2c')
    expect(asciiDigits('0123456789')).toBe('0123456789')
  })
})

describe('the resend countdown', () => {
  it('counts whole seconds down to exactly zero at the deadline', () => {
    const start = 1_000_000
    expect(secondsLeft(start + 60_000, start)).toBe(60)
    expect(secondsLeft(start + 60_000, start + 1)).toBe(60)
    expect(secondsLeft(start + 60_000, start + 59_000)).toBe(1)
    expect(secondsLeft(start + 60_000, start + 59_001)).toBe(1)
    expect(secondsLeft(start + 60_000, start + 60_000)).toBe(0)
    expect(secondsLeft(start + 60_000, start + 61_000)).toBe(0)
  })

  it('never counts below zero, whatever the clock says', () => {
    expect(secondsLeft(0, 5_000)).toBe(0)
    expect(secondsLeft(-1_000, 0)).toBe(0)
  })
})

describe('the channels the screen may offer', () => {
  it('hides SMS when the tenant has no provider, and says so', () => {
    const answer = channels({ channels: ['email'], sms_available: false })
    expect(offeredChannels(answer)).toEqual(['email'])
    expect(smsUnavailable(answer)).toBe(true)
  })

  it('hides SMS when the account has no mobile number, without claiming the tenant lacks one', () => {
    const answer = channels({ has_mobile: false })
    expect(offeredChannels(answer)).toEqual(['email'])
    expect(smsUnavailable(answer)).toBe(false)
  })

  it('keeps the server order and drops email when the account has no address', () => {
    expect(offeredChannels(channels())).toEqual(['sms', 'email'])
    expect(offeredChannels(channels({ has_email: false }))).toEqual(['sms'])
  })

  it('starts on the first channel the server offers and answers null when it offers none', () => {
    expect(preferredChannel(['sms', 'email'])).toBe('sms')
    expect(preferredChannel(['email'])).toBe('email')
    expect(preferredChannel([])).toBeNull()
  })
})
