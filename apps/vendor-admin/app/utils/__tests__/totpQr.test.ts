import { describe, expect, it } from 'vitest'
import { QR_QUIET_ZONE, totpQr } from '../totpQr'

const uri = 'otpauth://totp/Nasq%3Aa?secret=JBSWY3DPEHPK3PXP&issuer=Nasq'

describe('totpQr', () => {
  it('draws the link as a square of modules with a quiet zone around it', () => {
    const { size, path } = totpQr(uri)
    // Version 4 at error correction M: 33 modules a side.
    expect(size).toBe(33 + 2 * QR_QUIET_ZONE)
    expect(path).toMatch(/^(M\d+ \d+h\d+v1h-\d+z)+$/)
  })

  it('keeps every dark module inside the quiet zone', () => {
    const { size, path } = totpQr(uri)
    for (const [, x, y, run] of path.matchAll(/M(\d+) (\d+)h(\d+)/g).map(m => m.map(Number))) {
      expect(x).toBeGreaterThanOrEqual(QR_QUIET_ZONE)
      expect(y).toBeGreaterThanOrEqual(QR_QUIET_ZONE)
      expect(x! + run!).toBeLessThanOrEqual(size - QR_QUIET_ZONE)
      expect(y!).toBeLessThan(size - QR_QUIET_ZONE)
    }
  })

  it('is deterministic and changes with the link', () => {
    expect(totpQr(uri)).toEqual(totpQr(uri))
    expect(totpQr(uri.replace('PXP', 'PXQ')).path).not.toBe(totpQr(uri).path)
  })

  it('matches the golden drawing for a fixed link', () => {
    expect(totpQr(uri).path).toMatchSnapshot()
  })

  it('refuses an empty link', () => {
    expect(() => totpQr('')).toThrow('The authenticator link is empty')
  })
})
