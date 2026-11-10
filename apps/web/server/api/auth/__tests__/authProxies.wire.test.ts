import http from 'node:http'
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { appendResponseHeader, createApp, createError, defineEventHandler, getHeader, getRequestHeader, getRequestProtocol, toNodeListener } from 'h3'

// The auth proxies on the wire: a real HTTP hop to a stub Odoo, the real H3 app, the real
// `Secure`-when-https cookie rule, and the machine code a refusal carries.
let upstream: http.Server
let app: http.Server
let base: string
let odooUrl: string
let configuredHeader = ''
let calls: { path: string, method: string, headers: http.IncomingHttpHeaders, body: string }[] = []
let answer: { status: number, body: unknown } = { status: 200, body: {} }

beforeAll(async () => {
  for (const [name, value] of Object.entries({ appendResponseHeader, createError, defineEventHandler, getHeader, getRequestHeader, getRequestProtocol })) vi.stubGlobal(name, value)
  vi.stubGlobal('useRuntimeConfig', () => ({ odooUrl, odooDb: 'scratch_two_step', authProxyClientIpHeader: configuredHeader }))
  const { assertSameSiteJson } = await import('../../../utils/same-site')
  vi.stubGlobal('assertSameSiteJson', assertSameSiteJson)

  upstream = http.createServer(async (req, res) => {
    const chunks: Buffer[] = []
    for await (const chunk of req) chunks.push(Buffer.from(chunk))
    calls.push({ path: req.url!, method: req.method!, headers: req.headers, body: Buffer.concat(chunks).toString() })
    res.setHeader('content-type', 'application/json')
    res.setHeader('set-cookie', 'liwan_device=synthetic-token; HttpOnly; Path=/api/auth; SameSite=Lax')
    res.writeHead(answer.status)
    res.end(JSON.stringify(answer.body))
  })
  await new Promise<void>(resolve => upstream.listen(0, '127.0.0.1', resolve))
  odooUrl = `http://127.0.0.1:${(upstream.address() as { port: number }).port}`

  const h3 = createApp()
  h3.use('/channels', (await import('../channels.get')).default)
  h3.use('/code', (await import('../code.post')).default)
  h3.use('/verify', (await import('../verify.post')).default)
  // One path, two methods: `use` matches by prefix and would route DELETE to the POST handler.
  const rememberDevice = (await import('../device.post')).default
  const forgetDevices = (await import('../device.delete')).default
  h3.use('/device', defineEventHandler(event => (event.method === 'DELETE' ? forgetDevices(event) : rememberDevice(event))))
  app = http.createServer(toNodeListener(h3))
  await new Promise<void>(resolve => app.listen(0, '127.0.0.1', resolve))
  base = `http://127.0.0.1:${(app.address() as { port: number }).port}`
})

beforeEach(() => {
  calls = []
  configuredHeader = ''
  answer = { status: 200, body: {} }
  vi.stubEnv('LIWAN_TENANCY_MODE', 'dedicated')
})

afterAll(async () => {
  for (const server of [app, upstream]) {
    server?.closeAllConnections()
    if (server) await new Promise<void>(resolve => server.close(() => resolve()))
  }
  vi.unstubAllEnvs()
  vi.unstubAllGlobals()
})

function request(path: string, options: { method?: string, body?: string, headers?: Record<string, string> } = {}): Promise<Response> {
  return new Promise((resolve, reject) => {
    const req = http.request(base + path, { method: options.method ?? 'POST', headers: { 'content-type': 'application/json', cookie: 'session_id=pre-session', 'sec-fetch-site': 'same-origin', ...options.headers } }, res => {
      const chunks: Buffer[] = []
      res.on('data', chunk => chunks.push(chunk))
      res.on('end', () => {
        const headers = new Headers()
        for (const [key, value] of Object.entries(res.headers)) for (const item of Array.isArray(value) ? value : value ? [value] : []) headers.append(key, item)
        resolve(new Response(chunks.length ? Buffer.concat(chunks) : null, { status: res.statusCode, headers }))
      })
    })
    req.on('error', reject)
    // A POST test body defaults to an empty JSON object; a GET or DELETE carries none unless the test sends one.
    req.end(options.body ?? ((options.method ?? 'POST') === 'POST' ? '{}' : undefined))
  })
}

describe('the second sign-in step on the wire', () => {
  it('asks for the channels with the pending cookie and no body', async () => {
    answer = { status: 200, body: { channels: ['email'], sms_available: false, has_mobile: false, has_email: true } }
    const response = await request('/channels', { method: 'GET' })
    expect(response.status).toBe(200)
    expect(await response.json()).toMatchObject({ channels: ['email'], sms_available: false })
    expect(calls[0]).toMatchObject({ path: '/api/v1/auth/channels', method: 'GET', headers: { cookie: 'session_id=pre-session' } })
  })

  it('sends the chosen channel and forwards the masked destination back', async () => {
    answer = { status: 200, body: { channel: 'email', destination: 's***@example.test', resend_after: 60 } }
    const response = await request('/code', { body: JSON.stringify({ channel: 'email' }) })
    expect(response.status).toBe(200)
    expect(await response.json()).toEqual({ channel: 'email', destination: 's***@example.test', resend_after: 60 })
    expect(calls[0]?.body).toBe('{"channel":"email"}')
  })

  it('refuses a channel the contract does not name, before contacting Odoo', async () => {
    const response = await request('/code', { body: JSON.stringify({ channel: 'pigeon' }) })
    expect(response.status).toBe(422)
    expect((await response.json() as { data: { code: string } }).data.code).toBe('invalid_channel')
    expect(calls).toEqual([])
  })

  it('refuses a malformed code with its own machine code', async () => {
    const response = await request('/verify', { body: JSON.stringify({ code: '' }) })
    expect(response.status).toBe(422)
    expect((await response.json() as { data: { code: string } }).data.code).toBe('invalid_code_format')
    expect(calls).toEqual([])
  })

  it('forwards a Set-Cookie from Odoo, and adds Secure only when the browser reached us over https', async () => {
    answer = { status: 200, body: {} }
    const plain = await request('/device')
    expect(plain.headers.getSetCookie()).toEqual(['liwan_device=synthetic-token; HttpOnly; Path=/api/auth; SameSite=Lax'])
    configuredHeader = 'x-liwan-client-ip'
    const secure = await request('/device', { headers: {
      'x-liwan-client-ip': '203.0.113.7',
      'x-liwan-client-host': 'liwan.example.test',
      'x-liwan-client-proto': 'https',
    } })
    expect(secure.headers.getSetCookie()).toEqual(['liwan_device=synthetic-token; HttpOnly; Path=/api/auth; SameSite=Lax; Secure'])
  })

  it('passes the machine code and the cooldown seconds, never Odoo prose', async () => {
    answer = { status: 429, body: { code: 'resend_cooldown', message: 'Wait before asking for another code', details: { resend_after: 42 } } }
    const response = await request('/code', { body: JSON.stringify({ channel: 'sms' }) })
    expect(response.status).toBe(429)
    const body = await response.json() as { data: { code: string, details?: { resend_after: number } } }
    expect(body.data.code).toBe('resend_cooldown')
    expect(body.data.details).toEqual({ resend_after: 42 })
    expect(JSON.stringify(body)).not.toContain('Wait before asking')
  })

  it('finishes with the code, remembering the device only when asked', async () => {
    answer = { status: 200, body: { id: 7, remembered: true } }
    expect((await request('/verify', { body: JSON.stringify({ code: '123456', remember: true, label: 'Chrome' }) })).status).toBe(200)
    expect(JSON.parse(calls[0]!.body)).toEqual({ code: '123456', remember: true, label: 'Chrome' })

    answer = { status: 200, body: { id: 7, remembered: false } }
    await request('/verify', { body: JSON.stringify({ code: '123456' }) })
    expect(JSON.parse(calls[1]!.body)).toEqual({ code: '123456' })
  })

  it('answers a refused code with its own code', async () => {
    answer = { status: 401, body: { code: 'invalid_code', message: 'Verification failed' } }
    const response = await request('/verify', { body: JSON.stringify({ code: '000000' }) })
    expect(response.status).toBe(401)
    expect((await response.json() as { data: { code: string } }).data.code).toBe('invalid_code')
  })

  it('forgets the remembered devices with DELETE and returns the ids that stay', async () => {
    answer = { status: 200, body: { device_ids: [4] } }
    const response = await request('/device', { method: 'DELETE', headers: { cookie: 'session_id=live; liwan_device=in-use' } })
    expect(response.status).toBe(200)
    expect(await response.json()).toEqual({ device_ids: [4] })
    // The Odoo route that exists for the holder's own devices, with the cookie that names the browser in use.
    expect(calls[0]).toMatchObject({ path: '/api/v1/me/devices', method: 'DELETE', body: '' })
    expect(calls[0]!.headers.cookie).toBe('session_id=live; liwan_device=in-use')
  })

  it('refuses a cross-site or non-JSON mutation before contacting Odoo', async () => {
    for (const headers of [{ 'content-type': 'text/plain' }, { 'sec-fetch-site': 'cross-site' }] as Record<string, string>[]) {
      const response = await request('/code', { body: JSON.stringify({ channel: 'email' }), headers })
      expect(response.status).toBeGreaterThanOrEqual(403)
    }
    expect(calls).toEqual([])
  })
})
