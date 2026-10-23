import http from 'node:http'
import { createHash } from 'node:crypto'
import { existsSync, mkdtempSync, readdirSync, realpathSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, expect, it, vi } from 'vitest'
import { appendResponseHeader, createApp, createError, createRouter, defineEventHandler, getHeader, getRequestHeader, getRequestProtocol, readBody, toNodeListener } from 'h3'
import { ApiErrorSchema } from '../../../../../packages/contracts/src/common/error'

afterEach(() => { vi.useRealTimers(); vi.unstubAllGlobals(); vi.unstubAllEnvs(); vi.resetModules() })
const responseBody = (text: string): unknown => { try { return text ? JSON.parse(text) : undefined } catch { return text } }
const listen = (server: http.Server) => new Promise<string>(resolve => server.listen(0, '127.0.0.1', () => resolve(`http://127.0.0.1:${(server.address() as { port: number }).port}`)))

async function fixture(mode: 'shared' | 'dedicated', guarded = false) {
  vi.resetModules()
  vi.stubEnv('WEBVUE_TENANCY_MODE', mode)
  vi.stubEnv('WEBVUE_RELEASE_ROUTES_DIR', '')
  vi.stubEnv('NUXT_ODOO_MAX_CONCURRENCY', '1')
  const root = realpathSync(mkdtempSync(join(tmpdir(), 'webvue-public-body-')))
  const token = 'synthetic-public-body-token-'.repeat(3)
  writeFileSync(join(root, 'registry.json'), JSON.stringify({ schemaVersion: 1, snapshotRevision: 1, targets: [{ host: 'a.example.test', tenantId: 'a', database: 'db_a', filestore: 'db_a', registryRevision: 1, enabled: true }] }))
  vi.stubEnv('WEBVUE_SHARED_PROXY_TOKEN', token)
  vi.stubEnv('WEBVUE_TENANT_REGISTRY_PATH', join(root, 'registry.json'))
  const calls: Array<{ path: string; bytes: number; digest: string }> = []
  const authCalls: Array<{ path: string; body: Record<string, unknown>; headers: http.IncomingHttpHeaders }> = []
  const upstream = http.createServer((req, res) => {
    const hash = createHash('sha256'); let bytes = 0; let authText = ''
    req.on('data', chunk => { bytes += chunk.length; hash.update(chunk); if (req.url === '/web/session/authenticate' || req.url === '/api/v1/auth/totp') authText += chunk.toString() })
    req.on('end', () => {
      const received = { path: req.url!, bytes, digest: hash.digest('hex') }
      calls.push(received)
      res.setHeader('content-type', 'application/json')
      if (authText) authCalls.push({ path: req.url!, body: JSON.parse(authText), headers: req.headers })
      if (req.url === '/web/session/authenticate') {
        const pending = JSON.parse(authText).params.login === 'mfa'
        res.setHeader('set-cookie', `session_id=${pending ? 'pending-wire' : 'verified-wire'}; HttpOnly; Path=/`)
        res.end(JSON.stringify({ result: { uid: pending ? null : 7 } })); return
      }
      if (req.url === '/api/v1/auth/totp') res.setHeader('set-cookie', 'session_id=verified-wire; HttpOnly; Path=/')
      res.end(JSON.stringify(req.url === '/api/v1/me' ? { id: 7, company: { id: 1 } } : received))
    })
  })
  const upstreamUrl = await listen(upstream)
  let configuredUpstream = upstreamUrl
  if (guarded) {
    vi.stubEnv('WEBVUE_RELEASE_ROUTES_DIR', root)
    vi.stubEnv('WEBVUE_RELEASE_TENANT_ID', 'a')
    vi.stubEnv('WEBVUE_RELEASE_TENANT_HOST', 'a.example.test')
    vi.stubEnv('WEBVUE_RELEASE_IDENTITY_REVISION', '1')
    vi.stubEnv('WEBVUE_DEDICATED_PROXY_TOKEN', token)
    vi.stubEnv('WEBVUE_RELEASE_POOL_ID', 'blue')
    writeFileSync(join(root, 'binding.json'), JSON.stringify({ tenantId: 'a', host: 'a.example.test', database: 'db_a', filestore: 'db_a', identityRevision: 1, commercialMode: 'non_saas' }))
    writeFileSync(join(root, 'a.json'), JSON.stringify({ schemaVersion: 1, tenantId: 'a', identityRevision: 1, routeRevision: 1, releaseId: 'r1', poolId: 'blue', fence: 1, state: 'serving' }))
  }
  for (const [name, value] of Object.entries({ appendResponseHeader, createError, defineEventHandler, getHeader, getRequestHeader, getRequestProtocol, readBody })) vi.stubGlobal(name, value)
  const { assertSameSiteJson } = await import('../same-site')
  vi.stubGlobal('assertSameSiteJson', assertSameSiteJson)
  vi.stubGlobal('useRuntimeConfig', () => ({ odooUrl: configuredUpstream, odooDb: guarded ? 'db_a' : 'scratch_auth_body', authProxyClientIpHeader: '' }))
  const transport = await import('../tenantTransport')
  const handler = (await import('../../routes/api/v1/[...path]')).default
  const login = (await import('../../api/auth/login.post')).default
  const totp = (await import('../../api/auth/totp.post')).default
  const app = createApp()
  if (guarded) app.use((await import('../../middleware/tenant-boundary')).default)
  // Use Nitro's H3/radix router so accepted trailing-slash aliases exercise the same handlers.
  const router = createRouter()
  router.post('/api/auth/login', login); router.post('/api/auth/totp', totp)
  app.use(router.handler); app.use(handler)
  const webRequests: http.IncomingMessage[] = []
  const listener = toNodeListener(app)
  const web = http.createServer((req, res) => { webRequests.push(req); listener(req, res) })
  let url = await listen(web)
  let guard: http.Server | undefined
  let openCookie: (value: string) => string = value => value
  if (guarded) {
    writeFileSync(join(root, 'pools.json'), JSON.stringify({ schemaVersion: 1, pools: { blue: { poolId: 'blue', releaseId: 'r1', odooUrl: upstreamUrl, webUrl: url, wsUrl: upstreamUrl } } }))
    const { createGuard, sessionCodec } = await import('../../../../../deploy/shared/guard.mjs')
    const { createDedicatedGuard } = await import('../../../../../deploy/releases/dedicated_guard.mjs')
    const keys = { test: 'synthetic-public-body-cookie-'.repeat(3) }
    guard = mode === 'shared'
      ? createGuard({ registryPath: join(root, 'registry.json'), proxyToken: token, keys, activeKid: 'test', odooUrl: upstreamUrl, webUrl: url, releaseRoutesDir: root, releaseAssetsDir: undefined })
      : createDedicatedGuard({ bindingPath: join(root, 'binding.json'), releaseRoutesDir: root, proxyToken: token, releaseAssetsDir: undefined })
    url = await listen(guard)
    configuredUpstream = url
    if (mode === 'shared') openCookie = value => sessionCodec(keys, 'test').open(value, { tenantId: 'a', registryRevision: 1 })
  }
  const headers: Record<string, string> = guarded ? { host: 'a.example.test' } : mode === 'shared'
    ? { host: 'a.example.test', 'x-webvue-proxy-token': token, 'x-webvue-tenant-revision': '1' } : {}
  let release: (() => void) | undefined
  let blocker: Promise<void> | undefined
  return {
    url, headers, calls, authCalls, webRequests, openCookie,
    async hold() {
      blocker = transport.withUpstreamSlot(() => new Promise<void>(resolve => { release = resolve }))
      await Promise.resolve()
    },
    async release() { release?.(); await blocker },
    call(path: string, body?: Buffer, extra: Record<string, string> = {}, method = body ? 'POST' : 'GET') {
      return new Promise<{ status: number; body: unknown; headers: http.IncomingHttpHeaders }>((resolve, reject) => {
        const request = http.request(new URL(path, url), { method, headers: { ...headers, ...extra } }, response => {
          let text = ''; response.on('data', chunk => { text += chunk }); response.on('end', () => resolve({ status: response.statusCode!, body: responseBody(text), headers: response.headers }))
        })
        request.on('error', reject); request.setTimeout(2000, () => request.destroy(Error('wire_timeout'))); request.end(body)
      })
    },
    async close() {
      release?.(); await blocker
      for (const server of [guard, web, upstream]) { if (server) { server.closeAllConnections(); await new Promise<void>(resolve => server.close(() => resolve())) } }
      if (guarded) await vi.waitFor(() => {
        const leases = join(root, 'leases', 'a')
        expect(existsSync(leases) ? readdirSync(leases) : []).toHaveLength(0)
      })
      rmSync(root, { recursive: true })
    },
  }
}

// Both declared and chunked overflows must fail before a public MFA body reaches the work queue.
it.each([
  ['shared', 'declared'], ['shared', 'chunked'], ['dedicated', 'declared'], ['dedicated', 'chunked'],
] as const)('%s rejects an oversized public MFA %s body before buffering/queueing it', async (mode, framing) => {
  const wire = await fixture(mode)
  let upload: http.ClientRequest | undefined
  try {
    await wire.hold()
    const result = await new Promise<{ status: number; body: unknown }>((resolve, reject) => {
      upload = http.request(new URL('/api/v1/auth/totp?step=confirm', wire.url), { method: 'POST', headers: { ...wire.headers, cookie: 'session_id=unverified-mfa', 'content-type': 'application/json', ...(framing === 'declared' ? { 'content-length': '1025' } : {}) } }, response => {
        let text = ''; response.on('data', chunk => { text += chunk }); response.on('end', () => resolve({ status: response.statusCode!, body: JSON.parse(text) }))
      })
      upload.on('error', reject); upload.setTimeout(500, () => upload!.destroy(Error('waited_for_oversized_mfa_body')))
      if (framing === 'chunked') upload.write(Buffer.alloc(1025, 32)); else upload.flushHeaders()
      // Leave the body incomplete: a declared length check / incremental byte limit must reject now.
    })
    expect(result.status).toBe(413)
    expect(ApiErrorSchema.parse((result.body as { data: unknown }).data).code).toBe('payload_too_large')
    expect(wire.calls).toHaveLength(0)
    if (!upload) throw Error('wire upload was not created')
    upload.destroy()
    await wire.release()
    expect((await wire.call('/api/v1/branding')).status).toBe(200)
  } finally { upload?.destroy(); await wire.close() }
})

it.each(['shared', 'dedicated'] as const)('%s preserves the small MFA payload and exact 16MiB authenticated upload', async mode => {
  const wire = await fixture(mode)
  try {
    const code = Buffer.from('{"code":"123456"}')
    const padded = Buffer.concat([code, Buffer.alloc(1024 - code.length, 32)])
    const mfa = await wire.call('/api/v1/auth/totp', padded, { 'content-type': 'application/json' })
    expect(mfa.status).toBe(200)
    expect(mfa.body).toEqual({ path: '/api/v1/auth/totp', bytes: 1024, digest: createHash('sha256').update(padded).digest('hex') })
    const upload = Buffer.alloc(16 * 1024 * 1024, 65)
    const result = await wire.call('/api/v1/echo', upload, { cookie: 'session_id=verified', 'content-type': 'application/octet-stream' })
    expect(result.status).toBe(200)
    expect(result.body).toEqual({ path: '/api/v1/echo', bytes: 16 * 1024 * 1024, digest: createHash('sha256').update(upload).digest('hex') })
    expect(wire.calls.map(call => call.path)).toEqual(['/api/v1/auth/totp', '/api/v1/me', '/api/v1/echo'])
  } finally { await wire.close() }
})

// Removing the structured failure data must break useApi's real strict-schema parse over HTTP.
it.each([['shared', 'overflow'], ['shared', 'timeout'], ['dedicated', 'overflow'], ['dedicated', 'timeout']] as const)('%s serializes queue %s with strict errors and restores capacity', async (mode, kind) => {
  const wire = await fixture(mode)
  const waiting: Array<ReturnType<typeof wire.call>> = []
  try {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] })
    await wire.hold()
    const count = kind === 'overflow' ? 64 : 1
    for (let i = 0; i < count; i++) waiting.push(wire.call('/api/v1/branding'))
    await vi.waitFor(() => expect(vi.getTimerCount()).toBe(count + 1))
    if (kind === 'overflow') {
      const overflow = await wire.call('/api/v1/branding')
      expect(overflow.status).toBe(502)
      expect(ApiErrorSchema.parse((overflow.body as { data: unknown }).data)).toEqual({ code: 'tenant_upstream_unavailable', message: 'The upstream service is temporarily unavailable.' })
      expect(vi.getTimerCount()).toBe(65)
    }
    expect(wire.calls).toHaveLength(0)
    await vi.advanceTimersByTimeAsync(15_000)
    vi.useRealTimers()
    for (const response of await Promise.all(waiting)) {
      expect(response.status).toBe(502)
      expect(ApiErrorSchema.parse((response.body as { data: unknown }).data)).toEqual({ code: 'tenant_upstream_unavailable', message: 'The upstream service is temporarily unavailable.' })
    }
    await wire.release()
    expect((await wire.call('/api/v1/branding')).status).toBe(200)
    expect(wire.calls.map(call => call.path)).toEqual(['/api/v1/branding'])
  } finally {
    vi.useRealTimers()
    await wire.release()
    await Promise.allSettled(waiting)
    await wire.close()
  }
})


it.each([
  ['shared', 'totp', 'declared', 1024], ['shared', 'totp', 'chunked', 1024],
  ['dedicated', 'totp', 'declared', 1024], ['dedicated', 'totp', 'chunked', 1024],
  ['shared', 'login', 'declared', 65536], ['shared', 'login', 'chunked', 65536],
  ['dedicated', 'login', 'declared', 65536], ['dedicated', 'login', 'chunked', 65536],
] as const)('%s BFF %s rejects %s oversized JSON before parsing or upstream admission', async (mode, endpoint, framing, limit) => {
  const wire = await fixture(mode)
  let upload: http.ClientRequest | undefined
  try {
    await wire.hold()
    const response = await new Promise<{ status: number; body: unknown }>((resolve, reject) => {
      upload = http.request(new URL('/api/auth/' + endpoint, wire.url), { method: 'POST', headers: { ...wire.headers, 'content-type': 'application/json', 'sec-fetch-site': 'same-origin', ...(framing === 'declared' ? { 'content-length': String(limit + 1) } : {}) } }, reply => {
        let text = ''; reply.on('data', chunk => { text += chunk }); reply.on('end', () => resolve({ status: reply.statusCode!, body: JSON.parse(text) }))
      })
      upload.on('error', reject); upload.setTimeout(500, () => upload!.destroy(Error('waited_for_oversized_bff_body')))
      if (framing === 'declared') upload.flushHeaders(); else upload.write(Buffer.alloc(limit + 1, 32))
    })
    expect(response.status).toBe(413)
    expect(ApiErrorSchema.parse((response.body as { data: unknown }).data).code).toBe('payload_too_large')
    expect(wire.calls).toHaveLength(0)
  } finally { upload?.destroy(); await wire.close() }
})

it.each(['shared', 'dedicated'] as const)('%s BFF auth retains pending MFA, rotated cookies and valid boundary-sized credentials', async mode => {
  const wire = await fixture(mode)
  try {
    const login = Buffer.from('{"login":"mfa","password":"synthetic"}')
    const padded = Buffer.concat([login, Buffer.alloc(65536 - login.length, 32)])
    const first = await wire.call('/api/auth/login', padded, { 'content-type': 'application/json', 'sec-fetch-site': 'same-origin', 'x-forwarded-proto': 'https' })
    expect(first.status).toBe(200)
    expect(first.body).toEqual({ ok: false, mfa: 'totp' })
    expect(first.headers['set-cookie']![0]).toContain('session_id=pending-wire')
    expect(first.headers['set-cookie']![0]).toContain('Secure')
    const code = Buffer.from('{"code":"123456"}')
    const mfa = await wire.call('/api/auth/totp', Buffer.concat([code, Buffer.alloc(1024 - code.length, 32)]), { 'content-type': 'application/json', 'sec-fetch-site': 'same-origin', cookie: 'session_id=pending-wire' })
    expect(mfa.status).toBe(200)
    expect(mfa.body).toEqual({ ok: true })
    expect(mfa.headers['set-cookie']![0]).toContain('session_id=verified-wire')
    expect(wire.authCalls[0]!.body).toEqual({ jsonrpc: '2.0', method: 'call', params: { db: mode === 'shared' ? 'db_a' : 'scratch_auth_body', login: 'mfa', password: 'synthetic' } })
    expect(wire.authCalls[1]!.body).toEqual({ code: '123456' })
    expect(wire.authCalls[1]!.headers.cookie).toBe('session_id=pending-wire')
    const calls = wire.calls.length
    expect((await wire.call('/api/auth/totp', code, { 'content-type': 'application/json', 'sec-fetch-site': 'cross-site' })).status).toBe(403)
    expect(wire.calls).toHaveLength(calls)
  } finally { await wire.close() }
})

it.each([['shared', 'login'], ['shared', 'totp'], ['dedicated', 'login'], ['dedicated', 'totp']] as const)('%s BFF %s reports malformed JSON and non-object payloads with strict 400 errors', async (mode, endpoint) => {
  const wire = await fixture(mode)
  try {
    for (const text of ['{', 'null', '[]']) {
      const response = await wire.call('/api/auth/' + endpoint, Buffer.from(text), { 'content-type': 'application/json' })
      expect(response.status).toBe(400)
      expect(ApiErrorSchema.parse((response.body as { data: unknown }).data)).toEqual({ code: 'invalid_json', message: 'The request body must be a valid JSON object.' })
    }
    expect(wire.calls).toHaveLength(0)
  } finally { await wire.close() }
})

it.each(['shared', 'dedicated'] as const)('%s BFF login preserves missing credentials status/code with a strict error', async mode => {
  const wire = await fixture(mode)
  try {
    const response = await wire.call('/api/auth/login', Buffer.from('{}'), { 'content-type': 'application/json' })
    expect(response.status).toBe(400)
    expect(ApiErrorSchema.parse((response.body as { data: unknown }).data)).toEqual({ code: 'missing_credentials', message: 'Login and password are required.' })
    expect(wire.calls).toHaveLength(0)
  } finally { await wire.close() }
})


it.each(([
  ['shared', 'totp', 'declared', 1024], ['shared', 'totp', 'chunked', 1024],
  ['dedicated', 'totp', 'declared', 1024], ['dedicated', 'totp', 'chunked', 1024],
  ['shared', 'login', 'declared', 65536], ['shared', 'login', 'chunked', 65536],
  ['dedicated', 'login', 'declared', 65536], ['dedicated', 'login', 'chunked', 65536],
] as const).flatMap(testCase => ['', '/'].map(suffix => [...testCase, suffix] as const)))('%s guard caps public BFF %s %s body before forwarding or buffering it (limit %i suffix %s)', async (mode, endpoint, framing, limit, suffix) => {
  const wire = await fixture(mode, true)
  let upload: http.ClientRequest | undefined
  try {
    const response = await new Promise<{ status: number; body: unknown }>((resolve, reject) => {
      upload = http.request(new URL('/api/auth/' + endpoint + suffix + '?step=confirm', wire.url), { method: 'POST', headers: { ...wire.headers, 'content-type': 'application/json', ...(framing === 'declared' ? { 'content-length': String(limit + 1) } : {}) } }, reply => {
        let text = ''; reply.on('data', chunk => { text += chunk }); reply.on('end', () => resolve({ status: reply.statusCode!, body: JSON.parse(text) }))
      })
      upload.on('error', reject); upload.setTimeout(500, () => upload!.destroy(Error('guard_waited_for_oversized_body')))
      if (framing === 'declared') upload.flushHeaders(); else upload.write(Buffer.alloc(limit + 1, 32))
    })
    expect(response.status).toBe(413)
    expect(ApiErrorSchema.parse(response.body)).toEqual({ code: 'payload_too_large', message: 'The request body exceeds the allowed size.' })
    expect(wire.webRequests).toHaveLength(0)
    expect(wire.calls).toHaveLength(0)
  } finally { upload?.destroy(); await wire.close() }
})

it.each((['shared', 'dedicated'] as const).flatMap(mode => ['', '/'].map(suffix => [mode, suffix] as const)))('%s real guard and BFF retain boundary-sized auth, MFA cookie rotation and selector checks (suffix %s)', async (mode, suffix) => {
  const wire = await fixture(mode, true)
  try {
    const login = Buffer.from('{"login":"mfa","password":"synthetic"}')
    const first = await wire.call('/api/auth/login' + suffix + '?step=confirm', Buffer.concat([login, Buffer.alloc(65536 - login.length, 32)]), { 'content-type': 'application/json' })
    expect(first.status).toBe(200)
    expect(first.body).toEqual({ ok: false, mfa: 'totp' })
    const cookie = first.headers['set-cookie']![0]!.split(';')[0]!
    expect(wire.openCookie(cookie.slice(11))).toBe('pending-wire')
    const code = Buffer.from('{"code":"123456"}')
    const second = await wire.call('/api/auth/totp' + suffix + '?step=confirm', Buffer.concat([code, Buffer.alloc(1024 - code.length, 32)]), { 'content-type': 'application/json', cookie })
    expect(second.status).toBe(200)
    expect(second.body).toEqual({ ok: true })
    expect(wire.openCookie(second.headers['set-cookie']![0]!.split(';')[0]!.slice(11))).toBe('verified-wire')
    expect(wire.authCalls[0]!.body).toEqual({ jsonrpc: '2.0', method: 'call', params: { db: 'db_a', login: 'mfa', password: 'synthetic' } })
    expect(wire.authCalls[1]!.headers.cookie).toBe('session_id=pending-wire')
    for (const call of wire.authCalls) expect(call.headers['x-webvue-proxy-token']).toBeUndefined()
    const before = wire.calls.length
    const selected = await wire.call('/api/auth/login' + suffix + '?step=confirm', Buffer.from('{"db":"foreign","login":"user","password":"synthetic"}'), { 'content-type': 'application/json' })
    expect(selected.status).toBe(mode === 'shared' ? 400 : 403)
    expect(wire.calls).toHaveLength(before)
  } finally { await wire.close() }
})

it.each([['shared', '/api/v1/branding', 'POST', 'GET, HEAD'], ['dedicated', '/api/v1/branding', 'POST', 'GET, HEAD'], ['shared', '/api/v1/auth/totp', 'GET', 'POST'], ['dedicated', '/api/v1/auth/totp', 'GET', 'POST']] as const)('%s public %s refuses unsupported %s before body buffering', async (mode, path, method, allow) => {
  const wire = await fixture(mode, true)
  let upload: http.ClientRequest | undefined
  try {
    const response = await new Promise<{ status: number; body: unknown; allow: string | undefined }>((resolve, reject) => {
      upload = http.request(new URL(path, wire.url), { method, headers: { ...wire.headers, 'content-type': 'application/json', 'content-length': '1000000' } }, reply => {
        let text = ''; reply.on('data', chunk => { text += chunk }); reply.on('end', () => resolve({ status: reply.statusCode!, body: JSON.parse(text), allow: reply.headers.allow }))
      })
      upload.on('error', reject); upload.setTimeout(500, () => upload!.destroy(Error('waited_for_unsupported_method_body'))); upload.write('{')
    })
    expect(response.status).toBe(405)
    expect(response.allow).toBe(allow)
    expect(ApiErrorSchema.parse((response.body as { data: unknown }).data).code).toBe('method_not_allowed')
    expect(wire.calls).toHaveLength(0)
    expect(wire.webRequests).toHaveLength(1)
    expect(wire.webRequests[0]!.complete).toBe(false)
    await vi.waitFor(() => expect(wire.webRequests[0]!.socket.destroyed).toBe(true))
    if (!upload) throw Error('wire upload was not created')
    upload.destroy()
    expect((await wire.call('/api/v1/branding')).status).toBe(200)
    expect((await wire.call('/api/v1/branding', undefined, {}, 'HEAD')).status).toBe(200)
  } finally { upload?.destroy(); await wire.close() }
})
