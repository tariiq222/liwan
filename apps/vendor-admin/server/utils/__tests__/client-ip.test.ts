import { afterEach, describe, expect, it, vi } from 'vitest'
import { clientIp } from '../client-ip'
import { bffHandler } from '../errors'
import { send, stubConfig } from './harness'

const handler = bffHandler('ip-test', event => ({ ip: clientIp(event) ?? null }))

describe('clientIp', () => {
  afterEach(() => vi.unstubAllGlobals())

  it('ignores a browser-supplied x-nasq-client-ip', async () => {
    stubConfig()
    expect((await send(handler, '/x', { method: 'GET', headers: { 'x-nasq-client-ip': '6.6.6.6' } })).body.ip).toBeNull()
    stubConfig({ trustProxy: true })
    expect((await send(handler, '/x', { method: 'GET', headers: { 'x-nasq-client-ip': '6.6.6.6' } })).body.ip).toBeNull()
  })

  it('ignores x-forwarded-for unless the proxy is trusted', async () => {
    stubConfig()
    expect((await send(handler, '/x', { method: 'GET', headers: { 'x-forwarded-for': '203.0.113.9' } })).body.ip).toBeNull()
  })

  it('uses x-forwarded-for behind a trusted proxy', async () => {
    stubConfig({ trustProxy: true })
    expect((await send(handler, '/x', { method: 'GET', headers: { 'x-forwarded-for': '203.0.113.9' } })).body.ip).toBe('203.0.113.9')
  })

  it('treats a string trustProxy from the environment as true', async () => {
    stubConfig({ trustProxy: 'true' })
    expect((await send(handler, '/x', { method: 'GET', headers: { 'x-forwarded-for': '2001:db8::1' } })).body.ip).toBe('2001:db8::1')
  })

  it('drops an address that is not an IP literal', async () => {
    stubConfig({ trustProxy: true })
    expect((await send(handler, '/x', { method: 'GET', headers: { 'x-forwarded-for': 'a b; drop' } })).body.ip).toBeNull()
  })
})
