import { MIN_PASSWORD_LENGTH } from '@nasq/contracts'

interface PasswordRef {
  value: string
}

export interface PasswordRefs {
  current: PasswordRef
  next: PasswordRef
  confirm: PasswordRef
}

export function validatePasswordForm(current: string, next: string, confirm: string) {
  const mismatch = next !== confirm
  const weak = next.trim().length < MIN_PASSWORD_LENGTH
  return {
    valid: current.length > 0 && !mismatch && !weak,
    mismatch,
    weak,
  }
}

export function passwordErrorField(code: string): 'current' | 'new' | null {
  if (code === 'wrong_password') return 'current'
  if (code === 'weak_password') return 'new'
  return null
}

export function clearPasswordRefs(fields: PasswordRefs) {
  fields.current.value = ''
  fields.next.value = ''
  fields.confirm.value = ''
}
