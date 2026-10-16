import { describe, expect, it } from 'vitest'
import { hashToken, newRecoveryCodes, newToken, open, seal, totpBoxAad } from '../crypto.js'
import { checkTotp, totpAt, totpStep } from '../totp.js'
import { hashPassword, passwordAcceptable, verifyPassword } from '../passwords.js'

describe('tokens and boxes', () => {
  it('makes unique 256-bit tokens and stable hashes', () => {
    const a = newToken(); const b = newToken()
    expect(a).toMatch(/^[A-Za-z0-9_-]{43}$/); expect(a).not.toBe(b)
    expect(hashToken(a)).toBe(hashToken(a)); expect(hashToken(a)).toMatch(/^[a-f0-9]{64}$/)
  })
  it('seals and refuses tampering', () => {
    const key = Buffer.alloc(32, 7)
    const box = seal(key, Buffer.from('secret'), totpBoxAad(1))
    expect(open(key, box, totpBoxAad(1)).toString()).toBe('secret')
    box[box.length - 1] ^= 1
    expect(() => open(key, box, totpBoxAad(1))).toThrow()
    expect(() => open(Buffer.alloc(32, 8), seal(key, Buffer.from('x'), totpBoxAad(1)), totpBoxAad(1))).toThrow()
  })
  it('binds a box to its account: replay across accounts fails', () => {
    const key = Buffer.alloc(32, 7)
    const box = seal(key, Buffer.from('secret'), totpBoxAad(1))
    expect(() => open(key, box, totpBoxAad(2))).toThrow()
    expect(() => open(key, box, Buffer.from('totp|account:1 '))).toThrow()
    expect(totpBoxAad(7).toString()).toBe('totp|account:7')
  })
  it('refuses truncated, tag-flipped and iv-flipped boxes', () => {
    const key = Buffer.alloc(32, 7)
    const box = seal(key, Buffer.from('secret'), totpBoxAad(1))
    expect(() => open(key, box.subarray(0, 27), totpBoxAad(1))).toThrow('too short')
    expect(() => open(key, Buffer.alloc(0), totpBoxAad(1))).toThrow()
    for (const index of [0, 12, 27]) {
      const flipped = Buffer.from(box); flipped[index] ^= 1
      expect(() => open(key, flipped, totpBoxAad(1))).toThrow()
    }
    expect(open(key, box, totpBoxAad(1)).toString()).toBe('secret')
  })
  it('makes ten distinct recovery codes', () => {
    const codes = newRecoveryCodes()
    expect(codes).toHaveLength(10); expect(new Set(codes).size).toBe(10)
    for (const c of codes) expect(c).toMatch(/^[a-z2-7]{4}-[a-z2-7]{4}-[a-z2-7]{4}$/)
  })
})

describe('TOTP (RFC 6238 SHA-1 vectors, 8 digits)', () => {
  const secret = Buffer.from('12345678901234567890')
  it.each([[59, '94287082'], [1111111109, '07081804'], [1111111111, '14050471'], [1234567890, '89005924'], [2000000000, '69279037']])('t=%i', (t, code) => {
    expect(totpAt(secret, totpStep(t * 1000), 8)).toBe(code)
  })
  it('accepts a 6-digit code once and refuses replay', () => {
    const now = 1_760_000_000_000
    const code = totpAt(secret, totpStep(now), 6)
    const step = checkTotp(secret, code, now, 0)
    expect(step).toBe(totpStep(now))
    expect(checkTotp(secret, code, now, step!)).toBeNull()
    expect(checkTotp(secret, '000000', now, 0)).toBeNull()
    expect(checkTotp(secret, totpAt(secret, totpStep(now) - 2, 6), now, 0)).toBeNull()
  })
})

describe('passwords', () => {
  it('hashes with argon2id and verifies', async () => {
    const h = await hashPassword('correct horse battery')
    expect(h.startsWith('$argon2id$')).toBe(true)
    expect(await verifyPassword(h, 'correct horse battery')).toBe(true)
    expect(await verifyPassword(h, 'wrong horse battery')).toBe(false)
  })
  it('enforces length', () => {
    expect(passwordAcceptable('short')).toBe(false)
    expect(passwordAcceptable('a'.repeat(12))).toBe(true)
    expect(passwordAcceptable('a'.repeat(257))).toBe(false)
  })
})
