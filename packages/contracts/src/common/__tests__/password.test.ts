import { MIN_PASSWORD_LENGTH, PasswordChangeSchema } from '../password'

describe('PasswordChangeSchema', () => {
  it('exports the minimum and accepts valid changes', () => {
    expect(MIN_PASSWORD_LENGTH).toBe(8)
    expect(PasswordChangeSchema.parse({ current: 'current', new: '12345678' })).toEqual({ current: 'current', new: '12345678' })
  })

  it('preserves surrounding spaces in the current credential exactly', () => {
    const current = '  current password  '
    expect(PasswordChangeSchema.parse({ current, new: '12345678' }).current).toBe(current)
  })

  it('rejects missing, short-after-trim, and extra values', () => {
    expect(() => PasswordChangeSchema.parse({ new: '12345678' })).toThrow()
    expect(() => PasswordChangeSchema.parse({ current: '', new: '12345678' })).toThrow()
    expect(() => PasswordChangeSchema.parse({ current: 'current', new: '  1234567  ' })).toThrow()
    expect(() => PasswordChangeSchema.parse({ current: 'current', new: '12345678', extra: true })).toThrow()
  })
})
