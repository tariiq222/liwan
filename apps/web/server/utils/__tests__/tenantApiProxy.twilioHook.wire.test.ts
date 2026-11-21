import http from 'node:http'
import { createHash } from 'node:crypto'
import { existsSync, mkdtempSync, readdirSync, realpathSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { appendResponseHeader, createApp, createError, createRouter, defineEventHandler, getHeader, getRequestHeader, getRequestProtocol, readBody, toNodeListener } from 'h3'
import { hookSignatureHeader } from '../tenantTransport'

afterEach(() => { vi.unstubAllGlobals(); vi.unstubAllEnvs(); vi.resetModules() })
const listen = (server: http.Server) => new Promise<string>(resolve => server.listen(0, '127.0.0.1', () => resolve(`http://127.0.0.1:${(server.address() as { port: number }).port}`)))

type Received = { url: string; bytes: number; digest: string; contentType?: string; twilio?: string | string[]; hub?: string | string[]; cookie?: string }

/** The real BFF proxy, behind the real guard when `guarded`, in front of an upstream that echoes what reached it. */
async function fixture(mode: 'shared' | 'dedicated', guarded: boolean) {
  vi.resetModules()
  vi.stubEnv('LIWAN_TENANCY_MODE', mode)
  vi.stubEnv('NUXT_ODOO_MAX_CONCURRENCY', '1')
  const root = realpathSync(mkdtempSync(join(tmpdir(), 'liwan-twilio-hook-')))
  const token = 'synthetic-twilio-hook-token-'.repeat(3)
  writeFileSync(join(root, 'registry.json'), JSON.stringify({ schemaVersion: 1, snapshotRevision: 1, targets: [{ host: 'a.example.test', tenantId: 'a', database: 'db_a', filestore: 'db_a', registryRevision: 1, enabled: true }] }))
  vi.stubEnv('LIWAN_SHARED_PROXY_TOKEN', token)
  vi.stubEnv('LIWAN_TENANT_REGISTRY_PATH', join(root, 'registry.json'))
  vi.stubEnv('LIWAN_RELEASE_ROUTES_DIR', guarded ? root : '')
  vi.stubEnv('LIWAN_RELEASE_TENANT_ID', 'a')
  vi.stubEnv('LIWAN_RELEASE_TENANT_HOST', 'a.example.test')
  vi.stubEnv('LIWAN_RELEASE_IDENTITY_REVISION', '1')
  vi.stubEnv('LIWAN_DEDICATED_PROXY_TOKEN', token)
  vi.stubEnv('LIWAN_RELEASE_POOL_ID', 'blue')
  writeFileSync(join(root, 'binding.json'), JSON.stringify({ tenantId: 'a', host: 'a.example.test', database: 'db_a', filestore: 'db_a', identityRevision: 1, commercialMode: 'non_saas' }))
  writeFileSync(join(root, 'a.json'), JSON.stringify({ schemaVersion: 1, tenantId: 'a', identityRevision: 1, routeRevision: 1, releaseId: 'r1', poolId: 'blue', fence: 1, state: 'serving' }))
  const calls: Received[] = []
  const upstream = http.createServer((req, res) => {
    const hash = createHash('sha256'); let bytes = 0
    req.on('data', chunk => { bytes += chunk.length; hash.update(chunk) })
    req.on('end', () => {
      const received: Received = {
        url: req.url!, bytes, digest: hash.digest('hex'), contentType: req.headers['content-type'],
        twilio: req.headers['x-twilio-signature'], hub: req.headers['x-hub-signature-256'], cookie: req.headers.cookie,
      }
      calls.push(received)
      res.setHeader('content-type', 'application/json')
      res.end(JSON.stringify(received))
    })
  })
  const upstreamUrl = await listen(upstream)
  let configuredUpstream = upstreamUrl
  for (const [name, value] of Object.entries({ appendResponseHeader, createError, defineEventHandler, getHeader, getRequestHeader, getRequestProtocol, readBody })) vi.stubGlobal(name, value)
  const { assertSameSiteJson } = await import('../same-site')
  vi.stubGlobal('assertSameSiteJson', assertSameSiteJson)
  vi.stubGlobal('useRuntimeConfig', () => ({ odooUrl: configuredUpstream, odooDb: 'db_a', authProxyClientIpHeader: '' }))
  const handler = (await import('../../routes/api/v1/[...path]')).default
  const app = createApp()
  if (guarded) app.use((await import('../../middleware/tenant-boundary')).default)
  const router = createRouter({ preemptive: true })
  router.use('/api/v1/**', handler)
  app.use(router.handler)
  const web = http.createServer(toNodeListener(app))
  const webUrl = await listen(web)
  let url = webUrl
  let guard: http.Server | undefined
  if (guarded) {
    writeFileSync(join(root, 'pools.json'), JSON.stringify({ schemaVersion: 1, pools: { blue: { poolId: 'blue', releaseId: 'r1', odooUrl: upstreamUrl, webUrl, wsUrl: upstreamUrl } } }))
    const { createGuard } = await import('../../../../../deploy/shared/guard.mjs')
    const { createDedicatedGuard } = await import('../../../../../deploy/releases/dedicated_guard.mjs')
    guard = mode === 'shared'
      ? createGuard({ registryPath: join(root, 'registry.json'), proxyToken: token, keys: { test: 'synthetic-twilio-hook-cookie-'.repeat(3) }, activeKid: 'test', odooUrl: upstreamUrl, webUrl, releaseRoutesDir: root, releaseAssetsDir: undefined })
      : createDedicatedGuard({ bindingPath: join(root, 'binding.json'), releaseRoutesDir: root, proxyToken: token, releaseAssetsDir: undefined })
    url = await listen(guard)
    configuredUpstream = url
  }
  // Unguarded shared mode is reached the way the edge reaches the BFF: with the proxy token and tenant revision.
  const edge: Record<string, string> = !guarded && mode === 'shared' ? { 'x-liwan-proxy-token': token, 'x-liwan-tenant-revision': '1' } : {}
  return {
    calls,
    call(path: string, body: Buffer, headers: Record<string, string>) {
      return new Promise<{ status: number; body: Received }>((resolve, reject) => {
        const request = http.request(new URL(path, url), { method: 'POST', headers: { host: 'a.example.test', ...edge, ...headers } }, response => {
          let text = ''; response.on('data', chunk => { text += chunk }); response.on('end', () => resolve({ status: response.statusCode!, body: (() => { try { return JSON.parse(text) } catch { return text } })() }))
        })
        request.on('error', reject); request.setTimeout(2000, () => request.destroy(Error('wire_timeout'))); request.end(body)
      })
    },
    async close() {
      for (const server of [guard, web, upstream]) { if (server) { server.closeAllConnections(); await new Promise<void>(resolve => server.close(() => resolve())) } }
      if (guarded) await vi.waitFor(() => {
        const leases = join(root, 'leases', 'a')
        expect(existsSync(leases) ? readdirSync(leases) : []).toHaveLength(0)
      })
      rmSync(root, { recursive: true })
    },
  }
}

describe('hookSignatureHeader', () => {
  it('owns x-twilio-signature for the Twilio callback paths only, and keeps the exact inbox entries', () => {
    expect(hookSignatureHeader('/api/v1/public/integrations/hooks/twilio/12/message-status?x=1')).toBe('x-twilio-signature')
    expect(hookSignatureHeader('/api/v1/public/integrations/hooks/twilio/12/call-status')).toBe('x-twilio-signature')
    for (const path of ['/api/v1/public/integrations/hooks/twilio/abc/message-status', '/api/v1/public/integrations/hooks/meta/12/message-status',
      '/api/v1/public/integrations/hooks/twilio/12/message-status/extra', '/api/v1/public/payments/hooks/paymob/webhook']) {
      expect(hookSignatureHeader(path)).toBeUndefined()
    }
    expect(hookSignatureHeader('/api/v1/inbox/hooks/whatsapp')).toBe('x-hub-signature-256')
  })
})

// Twilio signs the exact URL plus the sorted form fields with the auth token, so the form body, its content type,
// the query and the signature header must all reach Odoo unchanged, without a session and without other signatures.
// The shared guard's Odoo hop still accepts JSON bodies only, so a guarded shared tenant is not covered here: the BFF
// hop is proven unguarded in shared mode and through the real guard in dedicated mode.
it.each([['shared', false], ['dedicated', true]] as const)('%s (guarded: %s) forwards a signed Twilio status callback unchanged', async (mode, guarded) => {
  const wire = await fixture(mode, guarded)
  try {
    const form = Buffer.from('MessageSid=SMtwiliotestmessage&MessageStatus=delivered&To=%2B966500000000&Body=%D9%85%D8%B1%D8%AD%D8%A8%D8%A7')
    const path = '/api/v1/public/integrations/hooks/twilio/12/message-status?attempt=1'
    const response = await wire.call(path, form, {
      'content-type': 'application/x-www-form-urlencoded', 'x-twilio-signature': 'c2lnbmF0dXJlPQ==',
      'x-hub-signature-256': 'sha256=00',
    })
    expect(response.status, JSON.stringify(response.body)).toBe(200)
    expect(response.body).toEqual({
      url: path, bytes: form.length, digest: createHash('sha256').update(form).digest('hex'),
      contentType: 'application/x-www-form-urlencoded', twilio: 'c2lnbmF0dXJlPQ==',
    })
    expect(wire.calls.map(call => call.url)).toEqual([path])
  } finally { await wire.close() }
})
