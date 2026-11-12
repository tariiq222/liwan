import { describe, expect, it } from 'vitest'
import { contentSecurityPolicy, createNonce, nonceScripts } from '../content-security-policy'

describe('vendor admin content security policy (AUDIT-039)', () => {
  it('allows only same-origin scripts and the response nonce', () => {
    const policy = contentSecurityPolicy('abc123')
    const scriptSrc = policy.split('; ').find(directive => directive.startsWith('script-src '))
    expect(scriptSrc).toBe("script-src 'self' 'nonce-abc123'")
    expect(policy).not.toMatch(/script-src[^;]*'unsafe-(inline|eval)'/)
    for (const directive of ["default-src 'self'", "connect-src 'self'", "object-src 'none'", "frame-ancestors 'none'", "form-action 'self'"]) {
      expect(policy).toContain(directive)
    }
  })

  it('creates a different nonce for every response', () => {
    const nonces = new Set(Array.from({ length: 20 }, createNonce))
    expect(nonces.size).toBe(20)
    for (const nonce of nonces) expect(nonce).toMatch(/^[A-Za-z0-9+/]{24}$/)
  })

  it('tags every script element and nothing else', () => {
    const html = '<script type="module" src="/_nuxt/a.js"></script><script>window.__NUXT__={}</script><SCRIPT>x</SCRIPT><scripts></scripts><noscript>n</noscript>'
    expect(nonceScripts(html, 'n0')).toBe('<script nonce="n0" type="module" src="/_nuxt/a.js"></script><script nonce="n0">window.__NUXT__={}</script><script nonce="n0">x</SCRIPT><scripts></scripts><noscript>n</noscript>')
  })
})
