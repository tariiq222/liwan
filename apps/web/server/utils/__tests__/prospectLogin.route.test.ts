import http from 'node:http'
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { createApp, createError, defineEventHandler, eventHandler, getHeader, getRequestURL, toNodeListener } from 'h3'

// On the LiwanOS public host /login leads to /find-workspace; on a tenant host /login is untouched and /find-workspace does not exist.
const TOKEN = 'p'.repeat(40)
const saved = { mode: process.env.LIWAN_TENANCY_MODE, token: process.env.LIWAN_SHARED_PROXY_TOKEN }
let app: http.Server
let port = 0
let reached: string[] = []

beforeAll(async () => {
  for (const [name, value] of Object.entries({ createError, defineEventHandler, getHeader, getRequestURL })) vi.stubGlobal(name, value)
  vi.stubGlobal('useRuntimeConfig', () => ({ customerCommercialEnabled: true, publicSignupEnabled: true, customerCommercialPublicOrigin: 'https://app.liwan.example' }))
  vi.doMock('../tenantRequest', () => ({ tenantRequest: () => { throw createError({ statusCode: 421 }) } }))
  vi.doMock('../releaseRequest', () => ({ installReleaseContext: () => {} }))
  vi.doMock('../releaseReadiness', () => ({ releaseProbeRequest: () => false }))
  const boundary = (await import('../../middleware/tenant-boundary')).default
  const h3 = createApp()
  h3.use(boundary)
  h3.use(eventHandler((event) => { reached.push(event.path); return 'page' }))
  app = http.createServer(toNodeListener(h3))
  await new Promise<void>(resolve => app.listen(0, '127.0.0.1', resolve))
  port = (app.address() as { port: number }).port
})
afterAll(async () => { await new Promise<void>(resolve => app.close(() => resolve())); vi.unstubAllGlobals(); vi.doUnmock('../tenantRequest') })
beforeEach(() => { process.env.LIWAN_TENANCY_MODE = 'shared'; process.env.LIWAN_SHARED_PROXY_TOKEN = TOKEN; reached = [] })
afterEach(() => {
  for (const [name, value] of [['LIWAN_TENANCY_MODE', saved.mode], ['LIWAN_SHARED_PROXY_TOKEN', saved.token]] as const) { if (value === undefined) delete process.env[name]; else process.env[name] = value }
})

const get = (path: string, headers: Record<string, string>) => new Promise<{ status: number; location?: string }>((resolve, reject) => {
  http.get({ host: '127.0.0.1', port, path, headers }, res => { res.resume(); res.on('end', () => resolve({ status: res.statusCode!, location: res.headers.location })) }).on('error', reject)
})
const common = { host: 'app.liwan.example', 'x-liwan-proxy-token': TOKEN }

describe('the common host sign-in', () => {
  it('redirects /login to /find-workspace without reaching the page', async () => {
    expect(await get('/login', common)).toEqual({ status: 302, location: '/find-workspace' })
    expect(await get('/login?next=/x', common)).toEqual({ status: 302, location: '/find-workspace' })
    expect(reached).toEqual([])
  })
  it('serves /find-workspace on the common host', async () => {
    expect((await get('/find-workspace', common)).status).toBe(200)
    expect(reached).toEqual(['/find-workspace'])
  })
  it('does not serve /find-workspace on a tenant host, and leaves its /login to the tenant boundary', async () => {
    const tenant = { host: 'tabc.liwan.example', 'x-liwan-proxy-token': TOKEN }
    expect((await get('/find-workspace', tenant)).status).toBe(404)
    expect((await get('/login', tenant)).status).toBe(421)
    expect(reached).toEqual([])
  })
})
