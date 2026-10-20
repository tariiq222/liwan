import { describe, expect, it } from 'vitest'
import { ApiError } from '../../../../composables/useApi'
import { backlogTone, isOtpValid, otpDigits, zatcaErrorMessage } from '../zatcaOnboarding'

const t = (key: string) => key

describe('ZATCA one-time password', () => {
  it('keeps digits only and at most six of them', () => {
    expect(otpDigits('12a3-45 6789')).toBe('123456')
    expect(otpDigits('')).toBe('')
  })

  it('accepts exactly six digits', () => {
    expect(isOtpValid('123456')).toBe(true)
    expect(isOtpValid('12345')).toBe(false)
    expect(isOtpValid('1234567')).toBe(false)
    expect(isOtpValid('12345a')).toBe(false)
  })
})

describe('ZATCA onboarding errors', () => {
  it('explains a known code in the user language and falls back to the server text', () => {
    expect(zatcaErrorMessage(new ApiError(422, 'zatca_rejected', 'raw'), t)).toBe('financeGovernance.zatca.errors.zatca_rejected')
    expect(zatcaErrorMessage(new ApiError(502, 'zatca_unavailable', 'raw'), t)).toBe('financeGovernance.zatca.errors.zatca_unavailable')
    expect(zatcaErrorMessage(new ApiError(422, 'invalid', 'otp must be six digits'), t)).toBe('otp must be six digits')
    expect(zatcaErrorMessage('boom', t)).toBe('errors.generic')
  })
})

describe('ZATCA backlog tone', () => {
  it('turns rejected and blocked red only when there is one', () => {
    expect(backlogTone('rejected', 1)).toBe('danger')
    expect(backlogTone('blocked', 2)).toBe('danger')
    expect(backlogTone('rejected', 0)).toBe('neutral')
    expect(backlogTone('to_send', 9)).toBe('neutral')
    expect(backlogTone('retry', 9)).toBe('neutral')
  })
})
