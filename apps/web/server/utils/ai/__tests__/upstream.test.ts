import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { odooJson, readSse } from '../upstream'

const transport = vi.hoisted(() => vi.fn())
vi.mock('../../tenantTransport', () => ({ tenantTransport: transport }))
vi.mock('../../tenantRequest', () => ({ tenantUpstreamHeaders: () => ({ host: 'a.example.test' }) }))

afterEach(() => vi.unstubAllEnvs())

const enc = new TextEncoder()
function responseOf(chunks: (string | Uint8Array)[]) {
  return new Response(new ReadableStream({
    start(controller) { for (const chunk of chunks) controller.enqueue(typeof chunk === 'string' ? enc.encode(chunk) : chunk); controller.close() },
  }), { status: 200 })
}
async function collect(response: Response) {
  const out: [string, any][] = []
  for await (const item of readSse(response)) out.push(item)
  return out
}

describe('readSse', () => {
  it('parses LF separated events', async () => {
    expect(await collect(responseOf(['event: a\ndata: {"x":1}\n\nevent: b\ndata: {"y":2}\n\n']))).toEqual([['a', { x: 1 }], ['b', { y: 2 }]])
  })
  it('parses CRLF separated events, also when a chunk splits the CRLF', async () => {
    expect(await collect(responseOf(['event: a\r\ndata: {"x":1}\r\n\r\nevent: b\r\ndata: {"y":2}\r', '\n\r\n']))).toEqual([['a', { x: 1 }], ['b', { y: 2 }]])
  })
  it('joins several data lines with a newline', async () => {
    expect(await collect(responseOf(['event: a\ndata: {"x":\ndata: 1}\n\n']))).toEqual([['a', { x: 1 }]])
  })
  it('skips comment lines and keep-alive blocks', async () => {
    expect(await collect(responseOf([': ping\n\nevent: a\n: note\ndata: {"x":1}\n\n']))).toEqual([['a', { x: 1 }]])
  })
  it('delivers a final event without a trailing blank line', async () => {
    expect(await collect(responseOf(['event: a\ndata: {"x":1}\n\nevent: done\ndata: {"status":"done"}']))).toEqual([['a', { x: 1 }], ['done', { status: 'done' }]])
  })
  it('flushes the decoder so a multi-byte character split across the last chunks survives', async () => {
    const bytes = enc.encode('event: a\ndata: {"t":"سلام"}\n\n')
    expect(await collect(responseOf([bytes.slice(0, 20), bytes.slice(20)]))).toEqual([['a', { t: 'سلام' }]])
  })
  it('throws ai_upstream when the buffered, unfinished event exceeds 1 MB', async () => {
    const big = 'event: a\ndata: ' + 'x'.repeat(1024 * 1024 + 10)
    await expect(collect(responseOf([big]))).rejects.toMatchObject({ statusCode: 502, data: { code: 'ai_upstream' } })
  })
  it('throws ai_upstream for malformed JSON instead of a raw SyntaxError', async () => {
    await expect(collect(responseOf(['event: a\ndata: {oops\n\n']))).rejects.toMatchObject({ statusCode: 502, data: { code: 'ai_upstream' } })
  })
  it('cancels the reader when the consumer stops early', async () => {
    let cancelled = false
    const response = new Response(new ReadableStream({
      start(controller) { controller.enqueue(enc.encode('event: a\ndata: {"x":1}\n\n')) },
      cancel() { cancelled = true },
    }), { status: 200 })
    for await (const _ of readSse(response)) break
    expect(cancelled).toBe(true)
  })
})


describe('odooJson on the shared lane', () => {
  const event = () => ({ node: { req: { headers: { cookie: 'session_id=s1' } }, res: { once: () => undefined, writableEnded: false } }, context: {} }) as never
  beforeEach(() => {
    transport.mockReset().mockResolvedValue(new Response('{"ok":true}', { status: 200 }))
    vi.stubGlobal('useRuntimeConfig', () => ({ odooUrl: 'http://odoo.test' }))
  })
  it('follows the browser connection by default', async () => {
    await odooJson(event(), 'GET', '/api/v1/me')
    expect(transport.mock.calls[0]![3]).toMatchObject({ signal: undefined, ignoreClientClose: false })
  })
  it('passes an explicit signal through', async () => {
    const controller = new AbortController()
    await odooJson(event(), 'GET', '/api/v1/me', { signal: controller.signal })
    expect(transport.mock.calls[0]![3]).toMatchObject({ signal: controller.signal, ignoreClientClose: false })
  })
  it('does not tie a shielded (null) call to the browser connection', async () => {
    await odooJson(event(), 'POST', '/api/v1/tasks/7/transition', { body: {}, signal: null })
    expect(transport.mock.calls[0]![3]).toMatchObject({ signal: undefined, ignoreClientClose: true })
  })
})


describe('release-pinned AI destination', () => {
  const event = (release?: Record<string, unknown>) => ({ node: { req: { headers: { 'x-webvue-ai-url': 'http://browser.test' } }, res: { once: () => undefined, writableEnded: false } }, context: release ? { webvueRelease: release } : {} }) as never
  const release = () => ({ releaseId: 'r1', poolId: 'blue', routeRevision: 3, fence: 8, aiUrl: 'http://ai-blue.test', aiStateVersion: '1' })
  beforeEach(() => {
    vi.stubGlobal('useRuntimeConfig', () => ({ aiServiceUrl: 'http://generic.test', aiServiceToken: 'secret' }))
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response('{}')))
    vi.stubEnv('WEBVUE_RELEASE_ROUTES_DIR', '/trusted/routes')
  })
  it('pins the destination and state contract for every call of a request', async () => {
    const { serviceFetch } = await import('../upstream')
    const pinned = release()
    const e = event(pinned)
    await serviceFetch(e, 'GET', '/v1/runs', { tenant: 't', user: '1' })
    pinned.aiUrl = 'http://ai-green.test'
    await serviceFetch(e, 'GET', '/v1/runs/r_1', { tenant: 't', user: '1' })
    expect(vi.mocked(fetch).mock.calls.map(call => call[0])).toEqual(['http://ai-blue.test/v1/runs', 'http://ai-blue.test/v1/runs/r_1'])
    expect(vi.mocked(fetch).mock.calls[0]![1]?.headers).toMatchObject({ 'x-webvue-ai-state-version': '1' })
  })
  it.each([undefined, { ...release(), aiStateVersion: undefined }, { ...release(), aiMaintenance: true }, { ...release(), aiStateVersion: 'future' }])('fails closed before contacting a service for missing or incompatible routing', async (route) => {
    const { serviceFetch } = await import('../upstream')
    await expect(serviceFetch(event(route), 'POST', '/v1/runs', { tenant: 't', user: '1' }, {})).rejects.toMatchObject({ statusCode: 503 })
    expect(fetch).not.toHaveBeenCalled()
  })
  it('settles an accepted claim during maintenance without admitting a new claim or ordinary resume', async () => {
    const { serviceFetch } = await import('../upstream')
    const pinned = release()
    const e = event(pinned)
    await serviceFetch(e, 'POST', '/v1/runs/r_1/claim', { tenant: 't', user: '1' }, { call_id: 'c_1' }, null)
    Object.assign(pinned, { aiMaintenance: true })
    const result = { call_id: 'c_1', result: { ok: true, data: { id: 7 }, decision: 'approved' } }
    await serviceFetch(e, 'POST', '/v1/runs/r_1/resume', { tenant: 't', user: '1' }, result, null)
    await expect(serviceFetch(e, 'POST', '/v1/runs/r_2/resume', { tenant: 't', user: '1' }, result, null)).rejects.toMatchObject({ statusCode: 503 })
    await expect(serviceFetch(e, 'POST', '/v1/runs/r_1/claim', { tenant: 't', user: '1' }, { call_id: 'c_1' }, null)).rejects.toMatchObject({ statusCode: 503 })
    expect(vi.mocked(fetch).mock.calls.map(call => call[0])).toEqual(['http://ai-blue.test/v1/runs/r_1/claim', 'http://ai-blue.test/v1/runs/r_1/resume'])
  })
  it('keeps the configured destination when release routing is disabled', async () => {
    vi.stubEnv('WEBVUE_RELEASE_ROUTES_DIR', '')
    const { serviceFetch } = await import('../upstream')
    await serviceFetch(event(), 'GET', '/v1/runs', { tenant: 't', user: '1' })
    expect(vi.mocked(fetch).mock.calls[0]![0]).toBe('http://generic.test/v1/runs')
  })
})


describe('release write fencing', () => {
  beforeEach(() => {
    vi.stubEnv('WEBVUE_RELEASE_ROUTES_DIR', '/trusted/routes')
    vi.stubGlobal('useRuntimeConfig', () => ({ odooUrl: 'http://odoo.test' }))
    transport.mockReset().mockResolvedValue(new Response('{"ok":true}', { status: 200 }))
  })
  const event = (permit?: <T>(action: () => Promise<T>) => Promise<T>) => ({ node: { req: { headers: { cookie: 'session_id=s1' } }, res: { once: () => undefined } }, context: { webvueRelease: { releaseId: 'r1', poolId: 'blue', routeRevision: 3, fence: 8, aiUrl: 'http://ai-blue.test', aiStateVersion: '1' }, webvueReleaseWritePermit: permit } }) as never
  it('refuses ordinary and claimed writes before dispatch when the durable permit is absent', async () => {
    for (const signal of [undefined, null]) {
      await expect(odooJson(event(), 'POST', '/api/v1/tasks/7/transition', { body: {}, signal })).rejects.toMatchObject({ statusCode: 503 })
    }
    expect(transport).not.toHaveBeenCalled()
  })
  it('holds a trusted permit through the actual effect and response settlement', async () => {
    const order: string[] = []
    const permit = async <T>(action: () => Promise<T>): Promise<T> => { order.push('lease'); const value = await action(); order.push('settled'); return value }
    transport.mockImplementationOnce(async () => { order.push('effect'); return new Response('{"id":7}', { status: 200 }) })
    expect(await odooJson(event(permit), 'POST', '/api/v1/tasks/7/transition', { body: {}, signal: null })).toEqual({ status: 200, body: { id: 7 } })
    expect(order).toEqual(['lease', 'effect', 'settled'])
  })
  it('does not dispatch when the coordinator denies the fence', async () => {
    const permit = async <T>(_action: () => Promise<T>): Promise<T> => { throw new Error('generation retired') }
    await expect(odooJson(event(permit), 'POST', '/api/v1/tasks/7/transition', { body: {} })).rejects.toThrow('generation retired')
    expect(transport).not.toHaveBeenCalled()
  })
})
