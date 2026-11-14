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
    expect(companyDomain('a@السعودية')).toBeNull()
  })
  it('treats subdomains as the registrable domain', () => {
    expect(companyDomain('a@mail.acme.sa')).toBe('acme.sa')
    expect(companyDomain('a@eu.mail.acme.com')).toBe('acme.com')
  })
  it('keeps companies under a country second-level suffix apart, listed or not', () => {
    expect(companyDomain('a@x.com.sa')).toBe('x.com.sa')
    expect(companyDomain('b@y.com.sa')).toBe('y.com.sa')
    expect(companyDomain('a@mail.x.com.sa')).toBe('x.com.sa')
    for (const [address, expected] of [['a@foo.co.uk', 'foo.co.uk'], ['a@foo.com.eg', 'foo.com.eg'], ['a@w.foo.com.au', 'foo.com.au'],
      ['a@foo.edu.sa', 'foo.edu.sa'], ['a@foo.gov.sa', 'foo.gov.sa'], ['a@foo.med.sa', 'foo.med.sa'], ['a@foo.sch.sa', 'foo.sch.sa'],
      ['a@firm.com.ng', 'firm.com.ng'], ['b@other.com.ng', 'other.com.ng'], ['a@x.co.ke', 'x.co.ke'], ['a@x.org.pk', 'x.org.pk'],
      ['a@x.or.jp', 'x.or.jp'], ['a@x.gob.mx', 'x.gob.mx'], ['a@x.k12.tr', 'x.k12.tr']] as const) {
      expect(companyDomain(address)).toBe(expected)
    }
  })
  it('a generic label under a three-letter or longer top level is an ordinary company label', () => {
    expect(companyDomain('a@co.com')).toBe('co.com')
    expect(companyDomain('a@acme.co.com')).toBe('co.com')
  })
  it('refuses an address directly on a public suffix or without a domain', () => {
    for (const address of ['a@com.sa', 'a@co.uk', 'a@com.ng', 'a@sa', 'a@localhost', 'a@', 'a@.']) expect(companyDomain(address)).toBeNull()
  })
  it('refuses shared-hosting suffixes and their subdomains', () => {
    for (const host of ['github.io', 'acme.github.io', 'a.b.web.app', 'x.pages.dev', 'x.vercel.app', 'x.netlify.app', 'x.herokuapp.com',
      'x.blogspot.com', 'x.wordpress.com', 'x.gitlab.io', 'x.firebaseapp.com', 'x.workers.dev']) {
      expect(companyDomain(`a@${host}`)).toBeNull()
    }
    expect(companyDomain('a@notgithub.io')).toBe('notgithub.io')
  })
})
