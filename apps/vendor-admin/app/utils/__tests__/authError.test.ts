import { describe, expect, it } from 'vitest'
import { authErrorKey, statusOf } from '../authError'

const http = (statusCode: number, code?: string) => Object.assign(new Error('fetch failed'), { statusCode, data: code ? { code } : undefined })

describe('authErrorKey', () => {
  it('uses one generic message for every authentication failure', () => {
    expect(authErrorKey(http(401, 'auth_failed'))).toBe('adminAuth.errors.failed')
    expect(authErrorKey(http(401))).toBe('adminAuth.errors.failed')
  })

  it('names rate limiting and lockout distinctly', () => {
    expect(authErrorKey(http(429, 'rate_limited'))).toBe('adminAuth.errors.rateLimited')
    expect(authErrorKey(http(200, 'rate_limited'))).toBe('adminAuth.errors.rateLimited')
  })

  it.each([[503, 'vendor_unavailable'], [503, 'admin_unavailable'], [503, undefined]])('maps %s %s to unavailable', (status, code) => {
    expect(authErrorKey(http(status, code))).toBe('adminAuth.errors.unavailable')
  })

  it('maps a rejected input to the invalid message', () => {
    expect(authErrorKey(http(422, 'invalid'))).toBe('adminAuth.errors.invalid')
  })

  it('maps WebAuthn browser errors', () => {
    expect(authErrorKey(Object.assign(new Error('x'), { name: 'NotAllowedError' }))).toBe('adminAuth.errors.passkeyCancelled')
    expect(authErrorKey(Object.assign(new Error('x'), { name: 'InvalidStateError' }))).toBe('adminAuth.errors.passkeyExists')
    expect(authErrorKey(Object.assign(new Error('x'), { name: 'NotSupportedError' }))).toBe('adminAuth.errors.passkeyUnsupported')
  })

  it('falls back to a network message for anything else', () => {
    expect(authErrorKey(new TypeError('Failed to fetch'))).toBe('adminAuth.errors.generic')
    expect(authErrorKey(null)).toBe('adminAuth.errors.generic')
    expect(authErrorKey(http(500))).toBe('adminAuth.errors.generic')
  })

  it('never echoes the error message', () => {
    expect(authErrorKey(new Error('password=hunter2'))).not.toContain('hunter2')
  })
})

describe('statusOf', () => {
  it('reads the status of an ofetch error or a response error', () => {
    expect(statusOf(http(401))).toBe(401)
    expect(statusOf({ response: { status: 429 } })).toBe(429)
    expect(statusOf(null)).toBeUndefined()
  })
})
