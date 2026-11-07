import { MIN_PASSWORD_LENGTH, PasswordChangeSchema } from '../password'

describe('PasswordChangeSchema', () => {
  it('exports the minimum and accepts valid changes', () => {
    expect(MIN_PASSWORD_LENGTH).toBe(12)
    expect(PasswordChangeSchema.parse({ current: 'current', new: '123456789012' })).toEqual({ current: 'current', new: '123456789012' })
  })

  it('preserves surrounding spaces in the current credential exactly', () => {
    const current = '  current password  '
    expect(PasswordChangeSchema.parse({ current, new: '123456789012' }).current).toBe(current)
  })

  it('rejects missing, short-after-trim, and extra values', () => {
    expect(() => PasswordChangeSchema.parse({ new: '123456789012' })).toThrow()
    expect(() => PasswordChangeSchema.parse({ current: '', new: '123456789012' })).toThrow()
    expect(() => PasswordChangeSchema.parse({ current: 'current', new: '  12345678901  ' })).toThrow()
    expect(() => PasswordChangeSchema.parse({ current: 'current', new: '123456789012', extra: true })).toThrow()
  })
})
