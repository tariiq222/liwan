import { afterEach, describe, expect, it, vi } from 'vitest'
import { clientIp } from '../client-ip'
import { bffHandler } from '../errors'
import { send, stubConfig } from './harness'

const handler = bffHandler('ip-test', event => ({ ip: clientIp(event) ?? null }))

describe('clientIp', () => {
  afterEach(() => vi.unstubAllGlobals())

  it('ignores a browser-supplied x-webvue-client-ip and uses the observed socket address', async () => {
    stubConfig()
    expect((await send(handler, '/x', { method: 'GET', headers: { 'x-webvue-client-ip': '6.6.6.6' } })).body.ip).toBe('127.0.0.1')
    stubConfig({ trustProxy: true })
    expect((await send(handler, '/x', { method: 'GET', headers: { 'x-webvue-client-ip': '6.6.6.6', 'x-forwarded-for': '203.0.113.9' } })).body.ip).toBe('203.0.113.9')
  })

  it('ignores x-forwarded-for unless the proxy is trusted', async () => {
    stubConfig()
    expect((await send(handler, '/x', { method: 'GET', headers: { 'x-forwarded-for': '203.0.113.9' } })).body.ip).toBe('127.0.0.1')
  })

  it('uses x-forwarded-for behind a trusted proxy', async () => {
    stubConfig({ trustProxy: true })
    expect((await send(handler, '/x', { method: 'GET', headers: { 'x-forwarded-for': '203.0.113.9' } })).body.ip).toBe('203.0.113.9')
  })

  it('treats a string trustProxy from the environment as true', async () => {
    stubConfig({ trustProxy: 'true' })
    expect((await send(handler, '/x', { method: 'GET', headers: { 'x-forwarded-for': '2001:db8::1' } })).body.ip).toBe('2001:db8::1')
  })

  it('drops anything that is not an IP address', async () => {
    stubConfig({ trustProxy: true })
    for (const value of ['a b; drop', '1.2.3', '999.1.1.1', '::::', 'abcd', '1.2.3.4:80']) {
      expect((await send(handler, '/x', { method: 'GET', headers: { 'x-forwarded-for': value } })).body.ip, value).toBeNull()
    }
  })

  it('accepts IPv4, IPv6 and mapped addresses', async () => {
    stubConfig({ trustProxy: true })
    for (const value of ['192.0.2.1', '2001:db8::1', '::ffff:192.0.2.1']) {
      expect((await send(handler, '/x', { method: 'GET', headers: { 'x-forwarded-for': value } })).body.ip, value).toBe(value)
    }
  })
})
