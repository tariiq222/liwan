import { afterEach, describe, expect, it, vi } from 'vitest'
import { getHeader } from 'h3'

vi.mock('../tenantRequest', () => ({ tenantRequest: () => null }))

import { INVITATION_CLIENT_HEADER, invitationAcceptHeaders } from '../customer-commercial'

const config = {
  customerCommercialIssuer: 'issuer-1',
  customerCommercialServiceKey: 'k'.repeat(48),
  customerCommercialTenantId: 'b1f0d3a4-0000-4000-8000-000000000001',
} as never

const event = { node: { req: { headers: { [INVITATION_CLIENT_HEADER]: '203.0.113.9' } } } } as never
const target = new URL('https://control.example.test/v1/invitations/accept')

afterEach(() => vi.unstubAllGlobals())

describe('invitationAcceptHeaders', () => {
  it('signs the workspace and the visitor address together and sends both', () => {
    vi.stubGlobal('getHeader', (e: unknown, name: string) => getHeader(e as never, name))
    const headers = invitationAcceptHeaders(event, config, target)
    expect(headers[INVITATION_CLIENT_HEADER]).toBe('203.0.113.9')
    expect(headers['x-liwan-signature']).toMatch(/^[A-Za-z0-9_-]{20,}$/)
    expect(headers['x-liwan-nonce']).toBeTruthy()
  })

  it('refuses a visitor with no signed address instead of sending an unsigned accept', () => {
    vi.stubGlobal('getHeader', (e: unknown, name: string) => getHeader(e as never, name))
    const bare = { node: { req: { headers: {} } } } as never
    expect(() => invitationAcceptHeaders(bare, config, target)).toThrow()
  })
})
