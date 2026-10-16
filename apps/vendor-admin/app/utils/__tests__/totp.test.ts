import { describe, expect, it } from 'vitest'
import { groupedTotpSecret } from '../totp'

describe('groupedTotpSecret', () => {
  it('reads the secret from the otpauth link and groups it in fours', () => {
    const uri = 'otpauth://totp/WebVue%3Aa%40example.test?secret=JBSWY3DPEHPK3PXP&issuer=WebVue&algorithm=SHA1&digits=6&period=30'
    expect(groupedTotpSecret(uri)).toBe('JBSW Y3DP EHPK 3PXP')
  })

  it('returns null when the link carries no secret or is not a link', () => {
    expect(groupedTotpSecret('otpauth://totp/x?issuer=WebVue')).toBeNull()
    expect(groupedTotpSecret('not a url')).toBeNull()
  })
})
