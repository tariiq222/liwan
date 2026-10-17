import { defineEventHandler, type EventHandler } from 'h3'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { clientIp } from '../client-ip'
import { bffHandler } from '../errors'
import { send, stubConfig } from './harness'

const handler = bffHandler('ip-test', event => ({ ip: clientIp(event) ?? null }))

/** Runs a handler as the `nuxt dev` proxy hands requests over: no socket peer, the address only in the headers it adds. */
const behindDevProxy = (inner: EventHandler): EventHandler => defineEventHandler((event) => {
  Object.defineProperty(event.node.req.socket, 'remoteAddress', { value: undefined, configurable: true })
  return inner(event)
})
const devProxyHeaders = (forwardedFor: string) => ({ 'x-nuxt-dev-request-id': 'req-1', 'x-forwarded-for': forwardedFor })

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

  describe('behind the nuxt dev proxy (no socket peer)', () => {
    const viaProxy = behindDevProxy(handler)

    it('takes the address the proxy appended, never one the browser sent', async () => {
      stubConfig()
      expect((await send(viaProxy, '/x', { method: 'GET', headers: devProxyHeaders('6.6.6.6, ::1') })).body.ip).toBe('::1')
    })

    it('stays unknown without the proxy marker header', async () => {
      stubConfig()
      expect((await send(viaProxy, '/x', { method: 'GET', headers: { 'x-forwarded-for': '::1' } })).body.ip).toBeNull()
    })

    it('stays unknown unless the admin origin is loopback http', async () => {
      stubConfig({ adminOrigin: 'https://admin.example.com', trustProxy: false })
      expect((await send(viaProxy, '/x', { method: 'GET', headers: devProxyHeaders('::1') })).status).toBe(503)
    })

    it('drops a forwarded value that is not an IP address', async () => {
      stubConfig()
      expect((await send(viaProxy, '/x', { method: 'GET', headers: devProxyHeaders('a b; drop') })).body.ip).toBeNull()
    })
  })
})
