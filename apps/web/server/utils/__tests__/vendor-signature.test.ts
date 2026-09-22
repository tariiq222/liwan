import { describe, expect, it } from 'vitest'
import { verifyServiceRequest } from '@nasq/commercial-contracts/server'
import { signVendorForward } from '../vendor-signature'

describe('vendor BFF request signing', () => {
  it('signs the exact JSON body sent upstream, including query string in the path', () => {
    const key = 'a'.repeat(48)
    const rawBody = '{ "request_id": "abc", "reason": "browser payload" }'
    const input = { method: 'POST', path: '/v1/tenants/123/operations?source=console', rawBody, actor: 17, issuer: 'installation-a', key }
    const headers = signVendorForward(input)
    expect(verifyServiceRequest({ ...input, body: rawBody, headers, now: Number(headers['x-nasq-timestamp']) })).toMatchObject({ actor: 17, issuer: 'installation-a' })
    expect(verifyServiceRequest({ ...input, body: JSON.stringify(JSON.parse(rawBody)), headers, now: Number(headers['x-nasq-timestamp']) })).toBeNull()
  })
})
