import { describe, expect, it } from 'vitest'
import {
  AcceptInvitationInputSchema,
  AccountLoginSchema,
  AccountTokenCheckInputSchema,
  AccountTokenCheckSchema,
  ForgotPasswordInputSchema,
  MobileInputSchema,
  PasswordInputSchema,
  TokenPasswordResetInputSchema,
} from '..'

const PASSWORD = 'twelve-chars!'
const MOBILE = '+966500000001'

describe('PasswordInputSchema', () => {
  it('needs twelve characters and keeps the exact text', () => {
    expect(PasswordInputSchema.parse(PASSWORD)).toBe(PASSWORD)
    expect(PasswordInputSchema.parse(`  ${PASSWORD}  `)).toBe(`  ${PASSWORD}  `)
    expect(() => PasswordInputSchema.parse('elevenchars')).toThrow()
    expect(() => PasswordInputSchema.parse('  elevenchars  ')).toThrow()
  })
})

describe('public account-link schemas', () => {
  it('accepts an invitation with a mobile number and a password', () => {
    expect(AcceptInvitationInputSchema.parse({ token: 'abc', mobile: MOBILE, password: PASSWORD })).toEqual({ token: 'abc', mobile: MOBILE, password: PASSWORD })
    expect(() => AcceptInvitationInputSchema.parse({ token: 'abc', mobile: '0500000001', password: PASSWORD })).toThrow()
    expect(() => AcceptInvitationInputSchema.parse({ token: 'abc', mobile: MOBILE, password: 'short' })).toThrow()
    expect(() => AcceptInvitationInputSchema.parse({ token: 'abc', password: PASSWORD })).toThrow()
    expect(() => AcceptInvitationInputSchema.parse({ token: '', mobile: MOBILE, password: PASSWORD })).toThrow()
    expect(() => AcceptInvitationInputSchema.parse({ token: 'abc', mobile: MOBILE, password: PASSWORD, login: 'x@example.com' })).toThrow()
  })

  it('resets a password with a token and nothing else', () => {
    expect(TokenPasswordResetInputSchema.parse({ token: 'abc', password: PASSWORD })).toEqual({ token: 'abc', password: PASSWORD })
    expect(() => TokenPasswordResetInputSchema.parse({ token: 'abc', password: 'short' })).toThrow()
    expect(() => TokenPasswordResetInputSchema.parse({ token: 'abc', password: PASSWORD, mobile: MOBILE })).toThrow()
  })

  it('checks a token for one purpose', () => {
    expect(AccountTokenCheckInputSchema.parse({ token: 'abc', purpose: 'invite' }).purpose).toBe('invite')
    expect(AccountTokenCheckInputSchema.parse({ token: 'abc', purpose: 'reset' }).purpose).toBe('reset')
    expect(() => AccountTokenCheckInputSchema.parse({ token: 'abc', purpose: 'login' })).toThrow()
    expect(AccountTokenCheckSchema.parse({ usable: false })).toEqual({ usable: false })
  })

  it('asks for a valid email on forgot-password and answers with a login', () => {
    expect(ForgotPasswordInputSchema.parse({ email: ' sara@example.com ' })).toEqual({ email: 'sara@example.com' })
    expect(() => ForgotPasswordInputSchema.parse({ email: 'not-an-email' })).toThrow()
    expect(AccountLoginSchema.parse({ login: 'sara@example.com' }).login).toBe('sara@example.com')
  })

  it('saves the holder\'s own mobile as E.164', () => {
    expect(MobileInputSchema.parse({ mobile: MOBILE })).toEqual({ mobile: MOBILE })
    expect(() => MobileInputSchema.parse({ mobile: '0500000001' })).toThrow()
  })
})
