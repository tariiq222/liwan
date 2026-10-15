import { afterEach, beforeAll, describe, expect, it } from 'vitest'
import { execFileSync } from 'node:child_process'
import { mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createServer, type Server } from 'node:https'
import type { IncomingMessage, ServerResponse } from 'node:http'
import type { AddressInfo } from 'node:net'
import { verifyServiceRequest } from '@nasq/commercial-contracts/server'
import { internalEffectPasswordAdapter } from '../commercial/invitation-effect-client.js'
import { EFFECT_ISSUER, EFFECT_PATH } from '../shared/internal-effect-protocol.js'

const KEY = 'k'.repeat(40)
const PASSWORD = 'correct-horse-battery-staple'
const TOKEN = 't'.repeat(43)
const input = { tenant_id: '11111111-1111-4111-8111-111111111111', admin_login: 'admin@example.test', password: PASSWORD, token: TOKEN }
const RESULT = { login: 'admin@example.test', user_id: 2, changed_at: '2026-10-02T12:00:00Z' }

let tls: { key: Buffer; cert: Buffer }
let dir = ''
beforeAll(() => {
  dir = mkdtempSync(join(tmpdir(), 'effect-test-'))
  execFileSync('openssl', ['req', '-x509', '-newkey', 'rsa:2048', '-nodes', '-days', '1', '-subj', '/CN=effect-worker', '-addext', 'subjectAltName=DNS:effect-worker',
    '-keyout', join(dir, 'k.pem'), '-out', join(dir, 'c.pem')], { stdio: 'ignore' })
  tls = { key: readFileSync(join(dir, 'k.pem')), cert: readFileSync(join(dir, 'c.pem')) }
  return () => rmSync(dir, { recursive: true, force: true })
})

let server: Server | undefined
const sockets = new Set<import('node:net').Socket>()
afterEach(async () => { for (const s of sockets) s.destroy(); sockets.clear(); if (server) await new Promise(r => server!.close(r)); server = undefined })

async function serve(handler: (req: IncomingMessage, res: ServerResponse, body: string) => void) {
  server = createServer(tls, (req, res) => {
    const chunks: Buffer[] = []
    req.on('data', c => chunks.push(c))
    req.on('end', () => handler(req, res, Buffer.concat(chunks).toString()))
  })
  server.on('connection', s => sockets.add(s as import('node:net').Socket))
  await new Promise<void>(r => server!.listen(0, '127.0.0.1', r))
  return internalEffectPasswordAdapter({ url: `https://127.0.0.1:${(server.address() as AddressInfo).port}`, key: KEY, ca: tls.cert, timeoutMs: 400 })
}
const json = (res: ServerResponse, status: number, data: unknown) => { res.writeHead(status, { 'content-type': 'application/json' }); res.end(JSON.stringify(data)) }
const fails = async (p: Promise<unknown>) => { const e = await p.then(() => null, e => e as Error); expect(e).toBeInstanceOf(Error); return e as Error }

describe('internal effect client', () => {
  it('sends a verifiable signed request with secrets only in the body', async () => {
    let captured: { headers: IncomingMessage['headers']; url: string; body: string } | undefined
    const adapter = await serve((req, res, body) => { captured = { headers: req.headers, url: req.url!, body }; json(res, 200, { result: RESULT }) })
    expect(await adapter.setAdminPassword(input)).toEqual(RESULT)
    const c = captured!
    expect(c.url).toBe(EFFECT_PATH)
    expect(JSON.parse(c.body)).toEqual(input)
    const verified = verifyServiceRequest({ method: 'POST', path: EFFECT_PATH, body: c.body, key: KEY, headers: c.headers })
    expect(verified?.issuer).toBe(EFFECT_ISSUER)
    const outside = JSON.stringify([c.url, c.headers])
    expect(outside.includes(PASSWORD)).toBe(false)
    expect(outside.includes(TOKEN)).toBe(false)
  })
  it('times out as unavailable and destroys the socket', async () => {
    let closed = false
    const adapter = await serve(req => { req.socket.on('close', () => { closed = true }) })
    const e = await fails(adapter.setAdminPassword(input))
    expect(e.message).toBe('unavailable')
    await new Promise(r => setTimeout(r, 100))
    expect(closed).toBe(true)
  })
  it('treats oversized, non-JSON, 401 and 500 responses as unavailable', async () => {
    const cases: Array<(res: ServerResponse) => void> = [
      res => { res.writeHead(200); res.end('x'.repeat(70000)) },
      res => { res.writeHead(200); res.end('not json') },
      res => json(res, 401, { code: 'unauthorized' }),
      res => json(res, 500, { code: 'password_policy' }),
    ]
    for (const respond of cases) {
      const adapter = await serve((_req, res) => respond(res))
      expect((await fails(adapter.setAdminPassword(input))).message).toBe('unavailable')
      await new Promise(r => server!.close(r)); server = undefined
    }
  })
  it('passes known 422 codes and 409 busy; unknown codes become script_failed', async () => {
    let reply: { status: number; body: unknown } = { status: 422, body: { code: 'password_policy' } }
    const adapter = await serve((_req, res) => json(res, reply.status, reply.body))
    expect((await fails(adapter.setAdminPassword(input))).message).toBe('password_policy')
    reply = { status: 409, body: { code: 'busy' } }
    expect((await fails(adapter.setAdminPassword(input))).message).toBe('busy')
    reply = { status: 422, body: { code: 'something_else' } }
    expect((await fails(adapter.setAdminPassword(input))).message).toBe('script_failed')
  })
  it('never leaks the password or token through the error', async () => {
    const adapter = await serve((_req, res) => json(res, 422, { code: PASSWORD + TOKEN }))
    const e = await fails(adapter.setAdminPassword(input))
    const dump = JSON.stringify(e) + e.message + String(e.stack) + JSON.stringify(Object.getOwnPropertyNames(e).map(n => (e as unknown as Record<string, unknown>)[n]))
    expect(dump.includes(PASSWORD)).toBe(false)
    expect(dump.includes(TOKEN)).toBe(false)
  })
  it('refuses a server whose certificate is not the pinned one', async () => {
    await serve((_req, res) => json(res, 200, { result: RESULT }))
    const other = internalEffectPasswordAdapter({ url: `https://127.0.0.1:${(server!.address() as AddressInfo).port}`, key: KEY, ca: Buffer.from('not a certificate'), timeoutMs: 400 })
    expect((await fails(other.setAdminPassword(input))).message).toBe('unavailable')
  })
})
