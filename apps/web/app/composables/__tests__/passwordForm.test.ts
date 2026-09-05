import { describe, expect, it } from 'vitest'
import { clearPasswordRefs, passwordErrorField, validatePasswordForm } from '../passwordForm'

describe('password form helpers', () => {
  it('reports mismatched confirmation separately from password strength', () => {
    expect(validatePasswordForm('current-password', 'new-password', 'different')).toEqual({
      valid: false,
      mismatch: true,
      weak: false,
    })
  })

  it('checks the effective trimmed password length', () => {
    expect(validatePasswordForm('current-password', ' 1234567 ', ' 1234567 ')).toEqual({
      valid: false,
      mismatch: false,
      weak: true,
    })
    expect(validatePasswordForm('current-password', ' 12345678 ', ' 12345678 ')).toEqual({
      valid: true,
      mismatch: false,
      weak: false,
    })
  })

  it('maps only credential errors to their corresponding field', () => {
    expect(passwordErrorField('wrong_password')).toBe('current')
    expect(passwordErrorField('weak_password')).toBe('new')
    expect(passwordErrorField('invalid')).toBeNull()
    expect(passwordErrorField('http_error')).toBeNull()
  })

  it('clears every password ref after settlement or close', () => {
    const fields = {
      current: { value: 'current-password' },
      next: { value: 'new-password' },
      confirm: { value: 'new-password' },
    }

    clearPasswordRefs(fields)

    expect(fields).toEqual({
      current: { value: '' },
      next: { value: '' },
      confirm: { value: '' },
    })
  })
})
