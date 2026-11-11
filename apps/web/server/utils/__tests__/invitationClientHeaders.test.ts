import { afterEach, describe, expect, it, vi } from 'vitest'
import { verifyServiceRequest } from '@liwan/commercial-contracts/server'
import { INVITATION_CLIENT_HEADER, invitationClientHeaders } from '../customer-commercial'

afterEach(() => vi.unstubAllGlobals())

describe('invitationClientHeaders', () => {
  const key = 'k'.repeat(40)
  const config = { customerCommercialIssuer: 'liwan-web', customerCommercialServiceKey: key }
  const target = new URL('/v1/invitations/accept', 'https://control.example.test')
  const headersFor = (edgeIp: string | undefined, cfg = config) => {
    vi.stubGlobal('getHeader', (_event: unknown, name: string) => (name === 'x-liwan-client-ip' ? edgeIp : undefined))
    return invitationClientHeaders({} as never, cfg, target)
  }

  it('signs the edge address in the exact form the control plane verifies', () => {
    expect(INVITATION_CLIENT_HEADER).toBe('x-liwan-client-ip')
    for (const ip of ['203.0.113.7', '2001:db8::1']) {
      const headers = headersFor(ip)
      expect(headers['x-liwan-client-ip']).toBe(ip)
      const signed = verifyServiceRequest({ method: 'POST', path: '/v1/invitations/accept', body: `liwan-invitation-client:${ip}\n`, headers, key, anonymous: true })
      expect(signed).toMatchObject({ actor: 'anonymous', issuer: 'liwan-web' })
    }
  })
  it('does not verify for another address, path or key', () => {
    const headers = headersFor('203.0.113.7')
    expect(verifyServiceRequest({ method: 'POST', path: '/v1/invitations/accept', body: 'liwan-invitation-client:203.0.113.8\n', headers, key, anonymous: true })).toBeNull()
    expect(verifyServiceRequest({ method: 'POST', path: '/v1/invitations/check', body: 'liwan-invitation-client:203.0.113.7\n', headers, key, anonymous: true })).toBeNull()
    expect(verifyServiceRequest({ method: 'POST', path: '/v1/invitations/accept', body: 'liwan-invitation-client:203.0.113.7\n', headers, key: 'z'.repeat(40), anonymous: true })).toBeNull()
  })
  it('sends nothing without a valid edge address', () => {
    for (const ip of [undefined, '', 'not-an-ip', '203.0.113.7, 198.51.100.1']) expect(headersFor(ip)).toEqual({})
  })
  it('sends nothing, and does not throw, while the key or issuer is not configured', () => {
    for (const cfg of [{}, { customerCommercialIssuer: 'liwan-web' }, { customerCommercialServiceKey: key }, { ...config, customerCommercialServiceKey: 'short' }]) expect(headersFor('203.0.113.7', cfg)).toEqual({})
  })
})
