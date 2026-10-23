import http from 'node:http'
import { EventEmitter, getEventListeners } from 'node:events'
import { afterEach, expect, it, vi } from 'vitest'
import { createEvent, proxyRequest, type H3Event } from 'h3'

afterEach(() => { vi.useRealTimers(); vi.unstubAllEnvs(); vi.resetModules() })

// Removing the admitted deadline must leave a real receiving socket open and its slot occupied.
it.each(['fetch', 'proxy', 'fetch-body', 'proxy-body'] as const)('aborts a hung admitted dedicated %s and returns its slot', async kind => {
  vi.stubEnv('NUXT_ODOO_MAX_CONCURRENCY', '1')
  vi.resetModules()
  const { withUpstreamSlot } = await import('../tenantTransport')
  let received!: () => void
  let disconnected!: () => void
  const incoming = new Promise<void>(resolve => { received = resolve })
  const closed = new Promise<void>(resolve => { disconnected = resolve })
  const upstream = http.createServer((req, res) => {
    req.resume()
    if (req.url === '/hang') {
      res.once('close', disconnected)
      if (kind.endsWith('-body')) { res.writeHead(200); res.write('partial') }
      received()
    }
    else res.end('healthy')
  })
  await new Promise<void>(resolve => upstream.listen(0, '127.0.0.1', resolve))
  const base = `http://127.0.0.1:${(upstream.address() as { port: number }).port}`
  let headersReceived!: () => void
  const headers = new Promise<void>(resolve => { headersReceived = resolve })
  let outcome = 'pending'
  let signal!: AbortSignal
  let pending: Promise<unknown> | undefined
  const proxy = http.createServer((req, res) => {
    const event = createEvent(req, res)
    pending = withUpstreamSlot(value => { signal = value; return proxyRequest(event, base + '/hang', { fetchOptions: { signal } }) }, event)
      .then(() => { outcome = 'completed' }, () => { outcome = 'cancelled' }).finally(() => res.end())
  })
  let caller: http.ClientRequest | undefined
  try {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] })
    if (kind.startsWith('fetch')) {
      pending = withUpstreamSlot(async value => {
        signal = value
        const response = await fetch(base + '/hang', { signal })
        headersReceived()
        return response
      })
        .then(() => { outcome = 'completed' }, () => { outcome = 'cancelled' })
    } else {
      await new Promise<void>(resolve => proxy.listen(0, '127.0.0.1', resolve))
      caller = http.get(`http://127.0.0.1:${(proxy.address() as { port: number }).port}`, res => res.resume())
      caller.on('error', () => { /* Cleanup may close the downstream socket. */ })
    }
    await incoming
    if (kind === 'fetch-body') { await headers; await Promise.resolve(); await Promise.resolve() }
    await vi.advanceTimersByTimeAsync(15_000)
    expect(signal.aborted).toBe(true)
    vi.useRealTimers()
    await pending
    await closed
    expect(outcome).toBe('cancelled')
    expect((await withUpstreamSlot(value => fetch(base + '/healthy', { signal: value }))).status).toBe(200)
    expect(getEventListeners(signal, 'abort')).toHaveLength(0)
  } finally {
    vi.useRealTimers()
    upstream.closeAllConnections()
    caller?.destroy()
    proxy.closeAllConnections()
    await pending
    await Promise.all([upstream, proxy].map(server => new Promise<void>(resolve => server.close(() => resolve()))))
  }
})

// Without the cap, every overflow caller retains a timer and can later execute.
it('caps queued requests at 64, rejects overflow without retaining resources, and recovers capacity', async () => {
  vi.stubEnv('NUXT_ODOO_MAX_CONCURRENCY', '1')
  vi.resetModules()
  const { withUpstreamSlot } = await import('../tenantTransport')
  let release!: () => void
  const blocker = withUpstreamSlot(() => new Promise<void>(resolve => { release = resolve }))
  await Promise.resolve()
  const clients = Array.from({ length: 70 }, () => {
    const req = Object.assign(new EventEmitter(), { aborted: false })
    const res = Object.assign(new EventEmitter(), { destroyed: false, writableEnded: false })
    return { req, res, event: { node: { req, res } } as unknown as H3Event }
  })
  const ran: number[] = []
  const results: string[] = []
  vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] })
  const queued = clients.map((client, index) => withUpstreamSlot(async () => { ran.push(index) }, client.event)
    .then(() => { results[index] = 'ran' }, () => { results[index] = 'rejected' }))
  try {
    await Promise.resolve(); await Promise.resolve(); await Promise.resolve()
    expect(results.filter(result => result === 'rejected')).toHaveLength(6)
    expect(vi.getTimerCount()).toBe(64)
    for (const client of clients.slice(64)) {
      expect(client.req.listenerCount('aborted')).toBe(0)
      expect(client.res.listenerCount('close')).toBe(0)
    }
    clients[0]!.req.emit('aborted')
    await queued[0]
    expect(vi.getTimerCount()).toBe(63)
    const replacement = withUpstreamSlot(async () => { ran.push(70) })
    expect(vi.getTimerCount()).toBe(64)
    release()
    await Promise.all([blocker, ...queued, replacement])
    expect(ran).toEqual([...Array.from({ length: 63 }, (_, index) => index + 1), 70])
    expect(vi.getTimerCount()).toBe(0)
    expect(await withUpstreamSlot(async () => 'healthy')).toBe('healthy')
    for (const client of clients) {
      expect(client.req.listenerCount('aborted')).toBe(0)
      expect(client.res.listenerCount('close')).toBe(0)
    }
  } finally { release(); await Promise.all([blocker, ...queued]) }
})

it('preserves dedicated response bytes, status, and separate cookies while buffering within its slot', async () => {
  const { withUpstreamSlot } = await import('../tenantTransport')
  const bytes = Buffer.from([0, 255, 128, 42])
  const upstream = http.createServer((_req, res) => {
    res.writeHead(201, { 'content-type': 'application/octet-stream', 'set-cookie': ['session_id=synthetic; HttpOnly', 'preference=ar'] })
    res.end(bytes)
  })
  await new Promise<void>(resolve => upstream.listen(0, '127.0.0.1', resolve))
  try {
    const response = await withUpstreamSlot(signal => fetch(`http://127.0.0.1:${(upstream.address() as { port: number }).port}`, { signal }))
    expect(response.status).toBe(201)
    expect(response.headers.get('content-type')).toBe('application/octet-stream')
    expect(response.headers.getSetCookie()).toEqual(['session_id=synthetic; HttpOnly', 'preference=ar'])
    expect(Buffer.from(await response.arrayBuffer())).toEqual(bytes)
  } finally { upstream.closeAllConnections(); await new Promise<void>(resolve => upstream.close(() => resolve())) }
})

// Buffering a native Response must retain the existing transport response limit.
it('cancels an oversized dedicated response before returning it and frees its slot', async () => {
  vi.stubEnv('NUXT_ODOO_MAX_CONCURRENCY', '1')
  vi.resetModules()
  const { withUpstreamSlot } = await import('../tenantTransport')
  let disconnected!: () => void
  const closed = new Promise<void>(resolve => { disconnected = resolve })
  const upstream = http.createServer((_req, res) => {
    res.once('close', disconnected)
    res.write(Buffer.alloc(33 * 1024 * 1024))
  })
  await new Promise<void>(resolve => upstream.listen(0, '127.0.0.1', resolve))
  try {
    await expect(withUpstreamSlot(signal => fetch(`http://127.0.0.1:${(upstream.address() as { port: number }).port}`, { signal }))).rejects.toThrow('tenant_upstream_unavailable')
    await closed
    expect(await withUpstreamSlot(async () => 'healthy')).toBe('healthy')
  } finally { upstream.closeAllConnections(); await new Promise<void>(resolve => upstream.close(() => resolve())) }
})
