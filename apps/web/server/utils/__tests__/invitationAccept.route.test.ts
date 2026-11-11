import http from 'node:http'
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'
import { verifyServiceRequest } from '@liwan/commercial-contracts/server'
import { createApp, createError, defineEventHandler, getHeader, readRawBody, setResponseHeader, setResponseStatus, toNodeListener } from 'h3'

let upstream: http.Server
let app: http.Server
let base: string
let controlUrl = ''
let seen: http.IncomingHttpHeaders = {}
const KEY = 'k'.repeat(40)

beforeAll(async () => {
  for (const [name, value] of Object.entries({ createError, defineEventHandler, getHeader, readRawBody, setResponseHeader, setResponseStatus })) vi.stubGlobal(name, value)
  vi.stubGlobal('useRuntimeConfig', () => ({ customerCommercialPublicOrigin: 'https://app.example.test', customerCommercialControlUrl: controlUrl, customerCommercialIssuer: 'liwan-web', customerCommercialServiceKey: KEY }))
  vi.stubGlobal('$fetch', {
    raw: async (url: string, options: RequestInit) => {
      const res = await fetch(url, options)
      const data = await res.json()
      if (!res.ok) throw Object.assign(new Error('upstream'), { statusCode: res.status, data })
      return Object.assign(res, { _data: data })
    },
  })
  // The token names the upstream answer, so each case drives one control-plane status.
  upstream = http.createServer(async (req, res) => {
    const chunks: Buffer[] = []
    for await (const chunk of req) chunks.push(Buffer.from(chunk))
    seen = req.headers
    const status = Number(JSON.parse(Buffer.concat(chunks).toString()).token.split('-')[1])
    res.writeHead(status, { 'content-type': 'application/json' })
    res.end(JSON.stringify(status === 200 ? { login: 'invitee@example.test' } : { code: 'refused', message: 'refused' }))
  })
  await new Promise<void>(resolve => upstream.listen(0, '127.0.0.1', resolve))
  controlUrl = `http://127.0.0.1:${(upstream.address() as { port: number }).port}`
  const h3 = createApp()
  h3.use('/accept', (await import('../../api/invitations/accept.post')).default)
  app = http.createServer(toNodeListener(h3))
  await new Promise<void>(resolve => app.listen(0, '127.0.0.1', resolve))
  base = `http://127.0.0.1:${(app.address() as { port: number }).port}`
})
afterAll(async () => {
  await Promise.all([upstream, app].map(s => new Promise<void>(resolve => s.close(() => resolve()))))
  vi.unstubAllGlobals()
})

async function accept(upstreamStatus: number, extra: Record<string, string> = {}) {
  const res = await fetch(`${base}/accept`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', origin: 'https://app.example.test', 'sec-fetch-site': 'same-origin', ...extra },
    body: JSON.stringify({ token: `status-${upstreamStatus}-${'x'.repeat(24)}`, password: 'a-long-enough-password' }),
  })
  return { status: res.status, body: await res.json() }
}

describe('invitation accept route', () => {
  it('treats a rate-limited accept as a temporary outage, not an invalid link', async () => {
    const { status, body } = await accept(429)
    expect(status).toBe(503)
    expect(body.data?.code ?? body.code).toBe('unavailable')
  })

  it('still answers an unusable link as invalid', async () => {
    const { status } = await accept(410)
    expect(status).toBe(400)
  })

  it('signs the edge-derived visitor address for the control plane', async () => {
    await accept(200, { 'x-liwan-client-ip': '203.0.113.7' })
    expect(seen['x-liwan-client-ip']).toBe('203.0.113.7')
    expect(verifyServiceRequest({ method: 'POST', path: '/v1/invitations/accept', body: 'liwan-invitation-client:203.0.113.7\n', headers: seen, key: KEY, anonymous: true })).toMatchObject({ issuer: 'liwan-web' })
  })

  it('sends no address or signature when the edge supplied none', async () => {
    await accept(200)
    expect(seen['x-liwan-client-ip']).toBeUndefined()
    expect(seen['x-liwan-signature']).toBeUndefined()
  })
})
