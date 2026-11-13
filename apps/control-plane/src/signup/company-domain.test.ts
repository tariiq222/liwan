import { describe, expect, it } from 'vitest'
import { companyDomain } from './company-domain.js'

describe('companyDomain', () => {
  it('lowercases and ignores the local part and plus-addressing', () => {
    expect(companyDomain('A@ACME.SA')).toBe('acme.sa')
    expect(companyDomain('a+1@acme.sa')).toBe('acme.sa')
    expect(companyDomain('b.c@acme.sa')).toBe('acme.sa')
  })
  it('drops trailing dots and converts IDN to punycode', () => {
    expect(companyDomain('a@acme.sa.')).toBe('acme.sa')
    expect(companyDomain('a@شركة.السعودية')).toBe('xn--ogbpi5d.xn--mgberp4a5d4ar')
    expect(companyDomain('a@mail.شركة.السعودية')).toBe('xn--ogbpi5d.xn--mgberp4a5d4ar')
  })
  it('treats subdomains as the registrable domain', () => {
    expect(companyDomain('a@mail.acme.sa')).toBe('acme.sa')
    expect(companyDomain('a@eu.mail.acme.com')).toBe('acme.com')
  })
  it('keeps second-level suffixes apart', () => {
    expect(companyDomain('a@x.com.sa')).toBe('x.com.sa')
    expect(companyDomain('b@y.com.sa')).toBe('y.com.sa')
    expect(companyDomain('a@mail.x.com.sa')).toBe('x.com.sa')
    for (const [address, expected] of [['a@foo.co.uk', 'foo.co.uk'], ['a@foo.com.eg', 'foo.com.eg'], ['a@w.foo.com.au', 'foo.com.au'],
      ['a@foo.edu.sa', 'foo.edu.sa'], ['a@foo.gov.sa', 'foo.gov.sa'], ['a@foo.med.sa', 'foo.med.sa'], ['a@foo.sch.sa', 'foo.sch.sa'],
      ['a@foo.net.sa', 'foo.net.sa'], ['a@foo.org.sa', 'foo.org.sa']] as const) {
      expect(companyDomain(address)).toBe(expected)
    }
  })
  it('a bare listed suffix or a single label is returned as is', () => {
    expect(companyDomain('a@com.sa')).toBe('com.sa')
    expect(companyDomain('a@localhost')).toBe('localhost')
  })
  it('returns null when there is no domain', () => {
    expect(companyDomain('a@')).toBeNull()
  })
})
