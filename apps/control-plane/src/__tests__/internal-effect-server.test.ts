import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createServer, request, type Server } from 'node:http'
import type { AddressInfo } from 'node:net'
import { signServiceRequest } from '@nasq/commercial-contracts/server'
import { handleInternalEffect, type InternalEffectDeps } from '../shared/internal-effect-server.js'
import { EFFECT_ACTOR, EFFECT_ISSUER, EFFECT_PATH, type EffectRequest } from '../shared/internal-effect-protocol.js'

const KEY = 'k'.repeat(40)
const PASSWORD = 'correct-horse-battery-staple'
const TOKEN = 't'.repeat(43)
const TENANT = '11111111-1111-4111-8111-111111111111'
const valid = (): EffectRequest => ({ tenant_id: TENANT, admin_login: 'admin@example.test', password: PASSWORD, token: TOKEN })

let server: Server, port = 0
let deps: InternalEffectDeps
let run: ReturnType<typeof vi.fn>
const seen = new Set<string>()

beforeEach(async () => {
  seen.clear()
  run = vi.fn(async () => ({ login: 'admin@example.test', user_id: 2, changed_at: '2026-10-02T12:00:00Z' }))
  deps = { key: KEY, run: run as unknown as InternalEffectDeps['run'], inFlight: new Set(), claimNonce: async (i, n) => { const k = i + n; if (seen.has(k)) return false; seen.add(k); return true } }
  server = createServer((req, res) => { void handleInternalEffect(req, res, deps) })
  await new Promise<void>(r => server.listen(0, '127.0.0.1', r))
  port = (server.address() as AddressInfo).port
})
afterEach(async () => { server.closeAllConnections(); await new Promise(r => server.close(r)); vi.restoreAllMocks() })

function send(opts: { path?: string; method?: string; body?: string; headers?: Record<string, string>; contentLength?: boolean }): Promise<{ status: number; body: string }> {
  return new Promise((resolve, reject) => {
    const body = opts.body ?? ''
    const headers: Record<string, string | number> = { ...opts.headers }
    if (opts.contentLength !== false) headers['content-length'] = Buffer.byteLength(body)
    const req = request({ host: '127.0.0.1', port, path: opts.path ?? EFFECT_PATH, method: opts.method ?? 'POST', headers }, res => {
      const chunks: Buffer[] = []
      res.on('data', c => chunks.push(c))
      res.on('end', () => resolve({ status: res.statusCode!, body: Buffer.concat(chunks).toString() }))
    })
    req.on('error', reject)
    req.end(body)
  })
}
const signed = (body: string, over: Partial<Parameters<typeof signServiceRequest>[0]> = {}) =>
  signServiceRequest({ method: 'POST', path: EFFECT_PATH, body, actor: EFFECT_ACTOR, issuer: EFFECT_ISSUER, key: KEY, ...over })

describe('internal effect server', () => {
  it('runs a valid signed request with exactly the input', async () => {
    const body = JSON.stringify(valid())
    const res = await send({ body, headers: signed(body) })
    expect(res.status).toBe(200)
    expect(JSON.parse(res.body).result.user_id).toBe(2)
    expect(run).toHaveBeenCalledTimes(1)
    expect(run.mock.calls[0][0]).toEqual(valid())
  })
  it.each([
    ['wrong key', (b: string) => signed(b, { key: 'z'.repeat(40) })],
    ['wrong issuer', (b: string) => signed(b, { issuer: 'other-issuer' })],
    ['stale timestamp', (b: string) => signed(b, { timestamp: Math.floor(Date.now() / 1000) - 120 })],
  ])('rejects %s with 401 and never runs', async (_name, make) => {
    const body = JSON.stringify(valid())
    expect((await send({ body, headers: make(body) })).status).toBe(401)
    expect(run).not.toHaveBeenCalled()
  })
  it('rejects a changed body and a different signed path', async () => {
    const body = JSON.stringify(valid())
    const headers = signed(body)
    expect((await send({ body: body.replace('admin@', 'root@'), headers })).status).toBe(401)
    expect((await send({ body, headers: signed(body, { path: '/v1/internal/other' }) })).status).toBe(401)
    expect(run).not.toHaveBeenCalled()
  })
  it('rejects a replayed nonce', async () => {
    const body = JSON.stringify(valid())
    const headers = signed(body)
    expect((await send({ body, headers })).status).toBe(200)
    expect((await send({ body, headers })).status).toBe(401)
    expect(run).toHaveBeenCalledTimes(1)
  })
  it('answers 413 for an oversized body with and without content-length', async () => {
    const body = JSON.stringify({ ...valid(), password: 'p'.repeat(4097) })
    expect(Buffer.byteLength(body)).toBeGreaterThan(4096)
    expect((await send({ body, headers: signed(body) })).status).toBe(413)
    expect((await send({ body, headers: signed(body), contentLength: false })).status).toBe(413)
    expect(run).not.toHaveBeenCalled()
  })
  it('answers 404 for other methods and paths', async () => {
    expect((await send({ method: 'GET' })).status).toBe(404)
    expect((await send({ path: '/v1/internal/other', body: '{}' })).status).toBe(404)
  })
  it('answers 400 invalid for a signed body that fails the schema', async () => {
    const body = JSON.stringify({ ...valid(), extra: 1 })
    const res = await send({ body, headers: signed(body) })
    expect(res.status).toBe(400)
    expect(JSON.parse(res.body)).toEqual({ code: 'invalid' })
    expect(run).not.toHaveBeenCalled()
  })
  it('refuses a concurrent request for the same tenant with 409 busy', async () => {
    let release!: () => void
    run.mockImplementationOnce(() => new Promise(r => { release = () => r({}) }))
    const body = JSON.stringify(valid())
    const first = send({ body, headers: signed(body) })
    await vi.waitFor(() => expect(run).toHaveBeenCalledTimes(1))
    const second = await send({ body, headers: signed(body) })
    expect(second.status).toBe(409)
    expect(JSON.parse(second.body)).toEqual({ code: 'busy' })
    release()
    expect((await first).status).toBe(200)
    // The lock is released afterwards.
    expect((await send({ body, headers: signed(body) })).status).toBe(200)
  })
  it('aborts the runner when the client disconnects', async () => {
    let signal!: AbortSignal
    run.mockImplementationOnce((_i: unknown, s: AbortSignal) => { signal = s; return new Promise(() => {}) })
    const body = JSON.stringify(valid())
    const req = request({ host: '127.0.0.1', port, path: EFFECT_PATH, method: 'POST', headers: { ...signed(body), 'content-length': Buffer.byteLength(body) } })
    req.on('error', () => {})
    req.end(body)
    await vi.waitFor(() => expect(run).toHaveBeenCalledTimes(1))
    req.destroy()
    await vi.waitFor(() => expect(signal.aborted).toBe(true))
  })
  it('reports only script_failed for arbitrary errors and logs neither password nor token', async () => {
    const log = vi.spyOn(console, 'error').mockImplementation(() => {})
    const out = vi.spyOn(console, 'log').mockImplementation(() => {})
    run.mockRejectedValueOnce(Error(PASSWORD + TOKEN))
    const body = JSON.stringify(valid())
    const res = await send({ body, headers: signed(body) })
    expect(res.status).toBe(422)
    expect(JSON.parse(res.body)).toEqual({ code: 'script_failed' })
    const logged = JSON.stringify([log.mock.calls, out.mock.calls])
    expect(logged.includes(PASSWORD)).toBe(false)
    expect(logged.includes(TOKEN)).toBe(false)
    expect(log).toHaveBeenCalledWith('internal_effect', 'script_failed')
  })
  it('passes known effect codes through', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {})
    run.mockRejectedValueOnce(Error('password_policy'))
    const body = JSON.stringify(valid())
    const res = await send({ body, headers: signed(body) })
    expect(res.status).toBe(422)
    expect(JSON.parse(res.body)).toEqual({ code: 'password_policy' })
  })
})
