import http from 'node:http'
import { gzipSync } from 'node:zlib'
import type { Socket } from 'node:net'
import { existsSync, mkdtempSync, readdirSync, realpathSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, expect, it, vi } from 'vitest'
import { createApp, defineEventHandler, sendWebResponse, toNodeListener } from 'h3'
import { ApiErrorSchema } from '../../../../../packages/contracts/src/common/error'

afterEach(() => { vi.useRealTimers(); vi.unstubAllGlobals(); vi.unstubAllEnvs(); vi.restoreAllMocks(); vi.resetModules() })
const listen = (server: http.Server) => new Promise<string>(resolve => server.listen(0, '127.0.0.1', () => resolve(`http://127.0.0.1:${(server.address() as { port: number }).port}`)))
const parse = (value: string): unknown => { try { return JSON.parse(value) } catch { return value } }
const SIZE = 32 * 1024 * 1024

async function fixture(mode: 'shared' | 'dedicated' | 'legacy') {
  vi.resetModules()
  const root = realpathSync(mkdtempSync(join(tmpdir(), 'webvue-response-credit-')))
  const token = 'synthetic-response-credit-token-'.repeat(3)
  const keys = { test: 'synthetic-response-credit-cookie-'.repeat(3) }
  const tenant = { tenantId: 'a', host: 'a.example.test', database: 'db_a', filestore: 'db_a', registryRevision: 1, enabled: true }
  writeFileSync(join(root, 'registry.json'), JSON.stringify({ schemaVersion: 1, snapshotRevision: 1, targets: [tenant] }))
  writeFileSync(join(root, 'binding.json'), JSON.stringify({ tenantId: 'a', host: tenant.host, database: 'db_a', filestore: 'db_a', identityRevision: 1, commercialMode: 'non_saas' }))
  writeFileSync(join(root, 'a.json'), JSON.stringify({ schemaVersion: 1, tenantId: 'a', identityRevision: 1, routeRevision: 1, releaseId: 'r1', poolId: 'blue', fence: 1, state: 'serving' }))
  for (const [name, value] of Object.entries({ WEBVUE_TENANCY_MODE: mode === 'legacy' ? 'dedicated' : mode, WEBVUE_SHARED_PROXY_TOKEN: token, WEBVUE_TENANT_REGISTRY_PATH: join(root, 'registry.json'), WEBVUE_RELEASE_ROUTES_DIR: mode === 'legacy' ? '' : root, WEBVUE_RELEASE_TENANT_ID: 'a', WEBVUE_RELEASE_TENANT_HOST: tenant.host, WEBVUE_RELEASE_IDENTITY_REVISION: '1', WEBVUE_DEDICATED_PROXY_TOKEN: token, WEBVUE_RELEASE_POOL_ID: 'blue', NUXT_ODOO_MAX_CONCURRENCY: '1' })) vi.stubEnv(name, value)
  const sockets = new Set<Socket>()
  const track = (server: http.Server) => server.on('connection', socket => { sockets.add(socket); socket.once('close', () => sockets.delete(socket)) })
  const upstreamCalls: string[] = []
  const nativeBuffered: string[] = []
  const dispatches: string[] = []
  const claims: Array<() => void> = []
  const stalled: http.ServerResponse[] = []
  const completions: Array<() => void> = []
  const payload = Buffer.alloc(SIZE, 65)
  const upstream = track(http.createServer((req, res) => {
    req.resume(); upstreamCalls.push(req.url!)
    res.setHeader('content-type', 'application/json')
    if (req.url === '/api/v1/me') { res.end('{"id":7,"company":{"id":1}}'); return }
    if (req.url?.startsWith('/api/v1/claimed')) { claims.push(() => res.end('{"written":true}')); return }
    if (req.url === '/api/v1/stalled') { stalled.push(res); res.writeHead(200, { 'content-length': String(SIZE) }); res.write('A'); return }
    if (req.url === '/api/v1/oversize') {
      res.writeHead(200, { 'content-type': 'application/octet-stream', 'content-length': String(128 * 1024 * 1024) })
      void (async () => {
        try {
          const chunk = Buffer.alloc(64 * 1024, 65)
          for (let bytes = 0; bytes < 128 * 1024 * 1024; bytes += chunk.length) {
            if (!res.write(chunk)) {
              await new Promise<void>(resolve => {
                const done = () => { res.removeListener('drain', done); res.removeListener('close', done); resolve() }
                res.once('drain', done); res.once('close', done)
              })
              if (res.destroyed) return
            }
          }
          res.end()
        } catch { res.destroy() }
      })()
      return
    }
    if (req.url === '/api/v1/redirect') { res.writeHead(302, { location: '/api/v1/escaped' }); res.end(); return }
    if (req.url === '/api/v1/gzip') {
      const body = gzipSync(Buffer.from('{"decoded":true}'))
      res.writeHead(200, { 'content-encoding': 'gzip', 'content-length': String(body.length) }); res.end(body); return
    }
    if (req.url === '/api/v1/not-modified') { res.writeHead(304, { etag: '"same"', 'content-length': '123', 'content-encoding': 'gzip' }); res.end(); return }
    if (req.url === '/api/v1/missing') { res.writeHead(404, { 'content-length': '7' }); res.end('missing'); return }
    if (req.url === '/api/v1/echo') {
      let body = ''; req.on('data', chunk => { body += chunk }); req.once('end', () => {
        res.writeHead(201, { 'set-cookie': ['session_id=rotated; HttpOnly; Path=/', 'other=value; Path=/'], connection: 'close, x-response-hop', 'x-response-hop': 'private', etag: '"echo"' })
        res.end(JSON.stringify({ body, headers: req.headers, method: req.method }))
      }); return
    }
    if (req.url?.startsWith('/api/v1/large')) { res.writeHead(200, { 'content-type': 'application/octet-stream', 'content-length': String(SIZE) }); res.end(payload); return }
    res.end('{"healthy":true}')
  }))
  const upstreamUrl = await listen(upstream)
  let guardUrl = ''
  vi.stubGlobal('defineEventHandler', defineEventHandler)
  vi.stubGlobal('useRuntimeConfig', () => ({ odooUrl: mode === 'legacy' ? upstreamUrl : guardUrl, authProxyClientIpHeader: '' }))
  const transport = await import('../tenantTransport')
  const originalTransport = transport.tenantTransport
  vi.spyOn(transport, 'tenantTransport').mockImplementation(async (...args) => {
    dispatches.push(args[2])
    const response = await originalTransport(...args)
    if (args[2].startsWith('/api/v1/large')) nativeBuffered.push(args[2])
    return response
  })
  const originalLegacy = transport.legacyTenantResponse
  vi.spyOn(transport, 'legacyTenantResponse').mockImplementation(async (...args) => {
    dispatches.push(args[2])
    const response = await originalLegacy(...args)
    if (args[2].startsWith('/api/v1/large')) nativeBuffered.push(args[2])
    return response
  })
  const { requireApiSession } = await import('../apiSessionAdmission')
  const { tenantUpstreamHeaders } = await import('../tenantRequest')
  const boundary = (await import('../../middleware/tenant-boundary')).default
  const route = (await import('../../routes/api/v1/[...path]')).default
  const observations: Array<{ path: string; res: http.ServerResponse; written: number; falseWrites: number; handlerSettled: boolean; settledAt?: number }> = []
  const app = createApp(); app.use(boundary)
  app.use(defineEventHandler(async event => {
    const row = observations.find(item => item.res === event.node.res)
    try {
      if (event.path.startsWith('/api/v1/held-output') || event.path.startsWith('/api/v1/claimed')) {
        await requireApiSession(event, guardUrl, tenantUpstreamHeaders(event))
        return await transport.withTenantResponse(event, async () => {
          const claimed = event.path.startsWith('/api/v1/claimed')
          const response = await originalTransport(event, guardUrl, claimed ? event.path : '/api/v1/health', claimed ? { method: 'POST', body: '{}', headers: { 'content-type': 'application/json' }, ignoreClientClose: true } : {})
          if (!claimed) await new Promise<void>(resolve => completions.push(resolve))
          if (!event.node.res.closed) return sendWebResponse(event, response)
        })
      }
      return await route(event)
    } finally { if (row) { row.handlerSettled = true; row.settledAt = Date.now() } }
  }))
  const listener = toNodeListener(app)
  const web = track(http.createServer((req, res) => {
    const row = { path: req.url!, res, written: 0, falseWrites: 0, handlerSettled: false }
    observations.push(row)
    const write = res.write
    res.write = function (this: http.ServerResponse, ...args: Parameters<typeof res.write>) {
      row.written += Buffer.byteLength(args[0])
      const accepted = write.apply(this, args)
      if (!accepted) row.falseWrites++
      return accepted
    } as typeof res.write
    listener(req, res)
  }))
  const webUrl = await listen(web)
  writeFileSync(join(root, 'pools.json'), JSON.stringify({ schemaVersion: 1, pools: { blue: { poolId: 'blue', releaseId: 'r1', odooUrl: upstreamUrl, webUrl, wsUrl: upstreamUrl } } }))
  const shared = await import('../../../../../deploy/shared/guard.mjs')
  const dedicated = await import('../../../../../deploy/releases/dedicated_guard.mjs')
  const guard = mode === 'legacy' ? undefined : track(mode === 'shared'
    ? shared.createGuard({ registryPath: join(root, 'registry.json'), proxyToken: token, keys, activeKid: 'test', odooUrl: upstreamUrl, webUrl, releaseRoutesDir: root, releaseAssetsDir: undefined })
    : dedicated.createDedicatedGuard({ bindingPath: join(root, 'binding.json'), releaseRoutesDir: root, proxyToken: token, releaseAssetsDir: undefined }))
  guardUrl = guard ? await listen(guard) : webUrl
  const cookie = 'session_id=' + (mode === 'shared' ? shared.sessionCodec(keys, 'test').seal('verified', tenant) : 'verified')
  const clients: http.ClientRequest[] = []
  const incoming: http.IncomingMessage[] = []
  function begin(path: string, paused = false, options: { method?: string; body?: Buffer; headers?: Record<string, string> } = {}) {
    const request = http.request(new URL(path, guardUrl), { method: options.method ?? 'GET', headers: { host: tenant.host, cookie, ...options.headers } })
    clients.push(request)
    const headers = new Promise<http.IncomingMessage>((resolve, reject) => { request.once('response', resolve); request.once('error', reject) })
    const result = new Promise<{ status: number; body: unknown; bytes: number }>((resolve, reject) => {
      request.once('error', reject)
      request.once('response', reply => {
        incoming.push(reply); reply.once('error', reject)
        if (paused) { reply.pause(); return }
        let text = ''; let bytes = 0; reply.on('data', chunk => { bytes += chunk.length; if (bytes <= 65536) text += chunk }); reply.once('end', () => resolve({ status: reply.statusCode!, body: parse(text), bytes }))
      })
    })
    void headers.catch(() => {}); void result.catch(() => {}); request.end(options.body)
    return { request, headers, result }
  }
  const wire = {
    begin, upstreamCalls, nativeBuffered, dispatches, observations, claims, completions, stalled, transport,
    async paused(count: number) {
      const replies: http.IncomingMessage[] = []
      for (let i = 0; i < count; i++) replies.push(await begin('/api/v1/large?id=' + i, true).headers)
      await vi.waitFor(() => expect(nativeBuffered).toHaveLength(count), { timeout: 5000 })
      await vi.waitFor(() => expect(observations.filter(row => row.path.startsWith('/api/v1/large') && row.handlerSettled)).toHaveLength(count))
      return replies
    },
    async close() {
      for (const complete of completions.splice(0)) complete()
      for (const claim of claims.splice(0)) claim()
      for (const reply of incoming) reply.destroy()
      for (const request of clients) request.destroy()
      for (const socket of sockets) socket.destroy()
      await Promise.all([guard, web, upstream].filter((server): server is http.Server => Boolean(server)).map(server => new Promise<void>(resolve => server.close(() => resolve()))))
      await vi.waitFor(() => { const leases = join(root, 'leases', 'a'); expect(existsSync(leases) ? readdirSync(leases) : []).toHaveLength(0) })
      rmSync(root, { recursive: true })
    },
  }
  try { expect((await begin('/api/v1/health').result).status).toBe(200); return wire }
  catch (error) { await wire.close(); throw error }
}

it.each(['shared', 'dedicated', 'legacy'] as const)('%s retains at most four actual32MiB outputs until downstream closes, after all handlers have settled', async mode => {
  const wire = await fixture(mode)
  try {
    const replies = await wire.paused(4)
    const first = wire.observations.filter(row => row.path.startsWith('/api/v1/large'))
    for (const row of first) {
      expect(row.written).toBe(SIZE); expect(row.falseWrites).toBeGreaterThan(0)
      expect(row.res.writableFinished).toBe(false); expect(row.res.writableLength).toBeGreaterThan(16 * 1024 * 1024)
    }
    const fifth = wire.begin('/api/v1/large?id=4', true)
    await vi.waitFor(() => expect(wire.observations.filter(row => row.path.startsWith('/api/v1/large'))).toHaveLength(5))
    // Real wire observation window: the old route completes another32MiB response here.
    await new Promise(resolve => setTimeout(resolve, 400))
    expect(wire.nativeBuffered).toHaveLength(4)
    expect(wire.upstreamCalls.filter(path => path.startsWith('/api/v1/large'))).toHaveLength(4)
    expect(wire.observations.filter(row => row.path.startsWith('/api/v1/large') && row.handlerSettled)).toHaveLength(4)
    expect(first.reduce((sum, row) => sum + row.res.writableLength, 0)).toBeLessThanOrEqual(4 * (SIZE + 1024))
    const closed = first[0]
    const client = replies[0]
    if (!closed || !client) throw Error('missing paused response')
    client.destroy()
    await vi.waitFor(() => expect(closed.res.closed).toBe(true))
    const fifthReply = await fifth.headers
    expect(fifthReply.statusCode).toBe(200)
    await vi.waitFor(() => expect(wire.nativeBuffered).toHaveLength(5), { timeout: 5000 })
    expect(first.filter(row => !row.res.closed && !row.res.writableFinished)).toHaveLength(3)
  } finally { await wire.close() }
}, 15000)


it.each(['shared', 'dedicated'] as const)('%s response queue caps64 unread dispatches, rejects overflow/timeouts and cancels clients without releasing an active owner', async mode => {
  const wire = await fixture(mode)
  const waiting: ReturnType<typeof wire.begin>[] = []
  try {
    const owners = Array.from({ length: 4 }, (_, index) => wire.begin('/api/v1/held-output?id=' + index))
    await vi.waitFor(() => expect(wire.completions).toHaveLength(4))
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] })
    for (let i = 0; i < 64; i++) waiting.push(wire.begin('/api/v1/health?queued=' + i))
    await vi.waitFor(() => expect(vi.getTimerCount()).toBe(64), { timeout: 4000 })
    const excess = await wire.begin('/api/v1/health?overflow').result
    expect(excess.status).toBe(502)
    expect(ApiErrorSchema.parse((excess.body as { data: unknown }).data)).toEqual({ code: 'tenant_upstream_unavailable', message: 'The upstream service is temporarily unavailable.' })
    expect(vi.getTimerCount()).toBe(64)
    const cancelled = waiting[0]
    if (!cancelled) throw Error('missing queued response client')
    cancelled.request.destroy()
    await vi.waitFor(() => expect(vi.getTimerCount()).toBe(63))
    waiting.push(wire.begin('/api/v1/health?replacement'))
    await vi.waitFor(() => expect(vi.getTimerCount()).toBe(64))
    const closedOwner = owners[0]
    if (!closedOwner) throw Error('missing active response owner')
    closedOwner.request.destroy()
    const ownerRow = wire.observations.find(row => row.path === '/api/v1/held-output?id=0')
    if (!ownerRow) throw Error('missing native output')
    await vi.waitFor(() => expect(ownerRow.res.closed).toBe(true))
    expect(ownerRow.handlerSettled).toBe(false)
    expect(vi.getTimerCount()).toBe(64) // No drain timer while the callback still owns its native response.
    expect((await wire.begin('/api/v1/health?still-full').result).status).toBe(502)
    expect(wire.upstreamCalls.filter(path => path.includes('queued=') || path.includes('replacement'))).toHaveLength(0)
    await vi.advanceTimersByTimeAsync(15_000)
    vi.useRealTimers()
    for (const client of waiting.filter(client => client !== cancelled)) {
      const response = await client.result
      expect(response.status).toBe(502)
      expect(ApiErrorSchema.parse((response.body as { data: unknown }).data).code).toBe('tenant_upstream_unavailable')
    }
    for (const complete of wire.completions.splice(0)) complete()
    for (const client of owners.filter(client => client !== closedOwner)) expect((await client.result).status).toBe(200)
    await vi.waitFor(() => expect(ownerRow.handlerSettled).toBe(true))
    const refill = Array.from({ length: 4 }, (_, index) => wire.begin('/api/v1/held-output?refill=' + index))
    await vi.waitFor(() => expect(wire.completions).toHaveLength(4))
    for (const complete of wire.completions.splice(0)) complete()
    for (const client of refill) expect((await client.result).status).toBe(200)
  } finally { vi.useRealTimers(); await wire.close() }
}, 15000)

it.each(['shared', 'dedicated'] as const)('%s closed client retains its response credit until an actual claimed native write settles', async mode => {
  const wire = await fixture(mode)
  try {
    await wire.paused(3)
    const claimed = wire.begin('/api/v1/claimed?id=write')
    await vi.waitFor(() => expect(wire.claims).toHaveLength(1))
    const row = wire.observations.find(item => item.path === '/api/v1/claimed?id=write')
    if (!row) throw Error('missing claimed native write')
    claimed.request.destroy()
    await vi.waitFor(() => expect(row.res.closed).toBe(true))
    expect(row.handlerSettled).toBe(false)
    const next = wire.begin('/api/v1/health?after-claim')
    await vi.waitFor(() => expect(wire.observations.some(item => item.path.includes('after-claim'))).toBe(true))
    await new Promise(resolve => setTimeout(resolve, 100))
    // Observe invocation before the separate work gate, so concurrency1 cannot hide an early credit release.
    expect(wire.dispatches.some(path => path.includes('after-claim'))).toBe(false)
    expect(wire.upstreamCalls.some(path => path.includes('after-claim'))).toBe(false)
    expect(row.handlerSettled).toBe(false)
    for (const complete of wire.claims.splice(0)) complete()
    expect((await next.result).status).toBe(200)
    await vi.waitFor(() => expect(row.handlerSettled).toBe(true))
  } finally { await wire.close() }
}, 15000)

it.each(['shared', 'dedicated'] as const)('%s expires only completed blocked outputs and restores response capacity after15s', async mode => {
  const wire = await fixture(mode)
  try {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'Date'] })
    await wire.paused(4)
    const rows = wire.observations.filter(row => row.path.startsWith('/api/v1/large'))
    expect(rows.every(row => row.handlerSettled && !row.res.writableFinished && !row.res.closed)).toBe(true)
    expect(vi.getTimerCount()).toBe(4)
    const firstDeadline = Math.min(...rows.map(row => {
      if (row.settledAt === undefined) throw Error('response callback has not settled')
      return row.settledAt + 15_000
    }))
    await vi.advanceTimersByTimeAsync(firstDeadline - Date.now() - 1)
    expect(rows.every(row => !row.res.closed)).toBe(true)
    await vi.advanceTimersByTimeAsync(1)
    await vi.waitFor(() => expect(rows.some(row => row.res.closed)).toBe(true))
    await vi.advanceTimersByTimeAsync(15_000)
    await vi.waitFor(() => expect(rows.every(row => row.res.closed)).toBe(true))
    expect(vi.getTimerCount()).toBe(0)
    vi.useRealTimers()
    expect((await wire.begin('/api/v1/health?after-drain').result).status).toBe(200)
    expect(wire.nativeBuffered).toHaveLength(4)
    for (const row of rows) {
      expect(row.res.listeners('finish').some(listener => listener.name === 'outputDone')).toBe(false)
      expect(row.res.listeners('close').some(listener => listener.name === 'outputDone')).toBe(false)
    }
  } finally { vi.useRealTimers(); await wire.close() }
}, 15000)


it.each(['/api/v1/oversize', '/api/v1/redirect'])('legacy rejects unsafe or oversized %s before downstream body delivery', async path => {
  const wire = await fixture('legacy')
  try {
    const response = await wire.begin(path).result
    expect(response.status).toBe(502)
    expect(ApiErrorSchema.parse((response.body as { data: unknown }).data)).toEqual({ code: 'tenant_upstream_unavailable', message: 'The upstream service is temporarily unavailable.' })
    expect(response.bytes).toBeLessThan(1024)
    expect(wire.upstreamCalls).not.toContain('/api/v1/escaped')
    expect((await wire.begin('/api/v1/health').result).status).toBe(200)
  } finally { await wire.close() }
}, 15000)

it('legacy preserves JSON bytes, cookies, status and metadata while removing authority/hop headers and decoded-body lengths', async () => {
  const wire = await fixture('legacy')
  try {
    const payload = Buffer.from('{"text":"Arabic العربية"}')
    const request = wire.begin('/api/v1/echo', false, { method: 'POST', body: payload, headers: { 'content-type': 'application/json', host: 'forged.invalid', connection: 'x-request-hop', 'x-request-hop': 'private', 'proxy-authorization': 'private-proxy-credential' } })
    const response = await request.result
    const incoming = await request.headers
    expect(response.status).toBe(201)
    const data = response.body as { body: string; headers: http.IncomingHttpHeaders; method: string }
    expect(data.body).toBe(payload.toString()); expect(data.method).toBe('POST')
    expect(data.headers.cookie).toBe('session_id=verified')
    expect(data.headers.host).not.toBe('forged.invalid')
    expect(data.headers['content-type']).toBe('application/json')
    expect(data.headers['x-request-hop']).toBeUndefined(); expect(data.headers['proxy-authorization']).toBeUndefined()
    expect(incoming.headers['set-cookie']).toEqual(['session_id=rotated; HttpOnly; Path=/', 'other=value; Path=/'])
    expect(incoming.headers.etag).toBe('"echo"'); expect(incoming.headers['x-response-hop']).toBeUndefined()
    const compressed = wire.begin('/api/v1/gzip')
    expect((await compressed.result).body).toEqual({ decoded: true })
    expect((await compressed.headers).headers['content-encoding']).toBeUndefined()
    const head = wire.begin('/api/v1/missing', false, { method: 'HEAD' })
    expect(await head.result).toMatchObject({ status: 404, bytes: 0 })
    expect((await head.headers).headers['content-length']).toBe('7')
    const unchanged = wire.begin('/api/v1/not-modified')
    expect(await unchanged.result).toMatchObject({ status: 304, bytes: 0 })
    expect((await unchanged.headers).headers.etag).toBe('"same"')
    expect((await unchanged.headers).headers['content-length']).toBe('123')
    expect((await unchanged.headers).headers['content-encoding']).toBe('gzip')
  } finally { await wire.close() }
}, 15000)


it('legacy cancels a native stalled response on client close and reclaims all four response credits', async () => {
  const wire = await fixture('legacy')
  try {
    const pending = wire.begin('/api/v1/stalled')
    await vi.waitFor(() => expect(wire.stalled).toHaveLength(1))
    pending.request.destroy()
    await vi.waitFor(() => expect(wire.stalled[0]?.closed).toBe(true))
    await vi.waitFor(() => expect(wire.observations.find(row => row.path === '/api/v1/stalled')?.handlerSettled).toBe(true))
    expect((await wire.begin('/api/v1/health').result).status).toBe(200)
    await wire.paused(4)
  } finally { await wire.close() }
}, 15000)

it('legacy stalled native body reaches its15s deadline with a strict502 and recovers', async () => {
  const wire = await fixture('legacy')
  try {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] })
    const pending = wire.begin('/api/v1/stalled')
    await vi.waitFor(() => expect(wire.stalled).toHaveLength(1))
    await vi.advanceTimersByTimeAsync(15_000)
    vi.useRealTimers()
    const result = await pending.result
    expect(result.status).toBe(502)
    expect(ApiErrorSchema.parse((result.body as { data: unknown }).data)).toEqual({ code: 'tenant_upstream_unavailable', message: 'The upstream service is temporarily unavailable.' })
    await vi.waitFor(() => expect(wire.stalled[0]?.closed).toBe(true))
    expect((await wire.begin('/api/v1/health').result).status).toBe(200)
  } finally { vi.useRealTimers(); await wire.close() }
}, 15000)
