import http from 'node:http'
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'
import * as h3 from 'h3'

// The AI routes measure the body before they parse it (issue #479): a body above the route's ceiling answers 413
// `payload_too_large` and neither Odoo nor the AI service is reached.

const routes: Record<string, (event: h3.H3Event) => unknown> = {}
let app: http.Server
let url = ''
let upstream: http.Server
let upstreamCalls = 0

beforeAll(async () => {
  for (const name of ['createError', 'defineEventHandler', 'getHeader', 'getRouterParam'] as const) vi.stubGlobal(name, h3[name])
  // Every route under test begins with the same-site JSON guard, which is not what is measured here.
  vi.stubGlobal('assertSameSiteJson', () => undefined)
  routes.start = (await import('../../../api/ai/runs/index.post')).default
  routes.resume = (await import('../../../api/ai/runs/[id]/resume.post')).default
  routes.patch = (await import('../../../api/ai/runs/[id]/index.patch')).default
  routes.key = (await import('../../../api/ai/config/key.put')).default
  routes.retention = (await import('../../../api/ai/config/retention.put')).default
  routes.leaverRetention = (await import('../../../api/ai/config/leaver-retention.put')).default
  upstream = http.createServer((req, res) => { upstreamCalls++; req.resume(); res.statusCode = 500; res.end('{}') })
  await new Promise<void>(resolve => upstream.listen(0, '127.0.0.1', resolve))
  const upstreamUrl = `http://127.0.0.1:${(upstream.address() as { port: number }).port}`
  vi.stubGlobal('useRuntimeConfig', () => ({ odooUrl: upstreamUrl, aiServiceUrl: upstreamUrl, aiServiceToken: '', aiTokenKey: 'k'.repeat(32), odooDb: 'x', authProxyClientIpHeader: '' }))
  const appH3 = h3.createApp()
  appH3.use('/api/ai/runs', h3.defineEventHandler((event) => {
    const match = event.path.match(/^\/([^/?]+)(\/resume)?/)
    if (!match) return routes.start!(event)
    event.context.params = { id: match[1]! }
    return match[2] ? routes.resume!(event) : routes.patch!(event)
  }))
  appH3.use('/api/ai/config/key', h3.defineEventHandler(event => routes.key!(event)))
  appH3.use('/api/ai/config/retention', h3.defineEventHandler(event => routes.retention!(event)))
  appH3.use('/api/ai/config/leaver-retention', h3.defineEventHandler(event => routes.leaverRetention!(event)))
  app = http.createServer(h3.toNodeListener(appH3))
  await new Promise<void>(resolve => app.listen(0, '127.0.0.1', resolve))
  url = `http://127.0.0.1:${(app.address() as { port: number }).port}`
})

afterAll(async () => {
  for (const server of [app, upstream]) { server.closeAllConnections(); await new Promise<void>(resolve => server.close(() => resolve())) }
  vi.unstubAllGlobals()
})

const send = (path: string, method: string, body: string) => fetch(`${url}${path}`, {
  method, headers: { 'content-type': 'application/json', cookie: 'session_id=s1' }, body,
})

/** A JSON object whose message field alone is `bytes` long, far above every route's ceiling. */
const jsonOf = (bytes: number) => JSON.stringify({ message: 'x'.repeat(bytes) })

describe('the AI routes refuse an oversized body before parsing it', () => {
  it.each([
    ['/api/ai/runs', 'POST', 64 * 1024],
    ['/api/ai/runs/r_1/resume', 'POST', 32 * 1024],
    ['/api/ai/runs/r_1', 'PATCH', 4 * 1024],
    ['/api/ai/config/key', 'PUT', 8 * 1024],
    ['/api/ai/config/retention', 'PUT', 2 * 1024],
    ['/api/ai/config/leaver-retention', 'PUT', 2 * 1024],
  ] as const)('%s (%s) answers 413 above %s bytes and reaches nothing', async (path, method, ceiling) => {
    const before = upstreamCalls
    const response = await send(path, method, jsonOf(ceiling + 1))
    expect(response.status).toBe(413)
    expect((await response.json()).data.code).toBe('payload_too_large')
    expect(upstreamCalls).toBe(before)
  })

  it('reads a body inside the ceiling on to its own validation', async () => {
    const before = upstreamCalls
    // The fake upstream answers 500, which this test does not assert: only that the body itself was read and went on.
    const response = await send('/api/ai/runs', 'POST', JSON.stringify({ message: 'هلا' }))
    expect(response.status).not.toBe(413)
    expect(upstreamCalls).toBeGreaterThan(before)
  })

  it('leaves no direct readBody in the AI routes', async () => {
    // The ceiling is enforced while reading, never on a body that is already in memory.
    const { readFile } = await import('node:fs/promises')
    const files = [
      '../../../api/ai/runs/index.post.ts', '../../../api/ai/runs/[id]/resume.post.ts', '../../../api/ai/runs/[id]/index.patch.ts',
      '../../../api/ai/config/key.put.ts', '../../../api/ai/config/retention.put.ts', '../../../api/ai/config/leaver-retention.put.ts',
    ]
    for (const file of files) {
      const source = await readFile(new URL(file, import.meta.url), 'utf8')
      expect(source, file).not.toMatch(/\breadBody\b/)
    }
  })
})
