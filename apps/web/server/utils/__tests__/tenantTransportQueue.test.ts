import { afterEach, expect, it, vi } from 'vitest'
import http from 'node:http'
import { EventEmitter, getEventListeners } from 'node:events'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createEvent, proxyRequest, type H3Event } from 'h3'

afterEach(() => { vi.unstubAllEnvs(); vi.resetModules() })

async function wireFixture() {
  vi.stubEnv('NUXT_ODOO_MAX_CONCURRENCY', '1')
  vi.stubEnv('WEBVUE_TENANCY_MODE', 'shared')
  const token = 'synthetic-queue-wire-token'.repeat(3)
  vi.stubEnv('WEBVUE_SHARED_PROXY_TOKEN', token)
  const directory = mkdtempSync(join(tmpdir(), 'webvue-queue-wire-'))
  const registry = join(directory, 'registry.json')
  writeFileSync(registry, JSON.stringify({ schemaVersion: 1, snapshotRevision: 1, targets: [{ host: 'a.example.test', tenantId: 'a', database: 'db_a', filestore: 'db_a', registryRevision: 1, enabled: true }] }))
  vi.stubEnv('WEBVUE_TENANT_REGISTRY_PATH', registry)
  vi.resetModules()
  const transport = await import('../tenantTransport')
  const calls: string[] = []
  const server = http.createServer((req, res) => {
    calls.push(req.url!)
    req.resume()
    res.end('{}')
  })
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve))
  const base = `http://127.0.0.1:${(server.address() as { port: number }).port}`
  const event = () => {
    const req = Object.assign(new EventEmitter(), { aborted: false, headers: { host: 'a.example.test', 'x-webvue-proxy-token': token, 'x-webvue-tenant-revision': '1', cookie: 'session_id=synthetic' } })
    const res = Object.assign(new EventEmitter(), { destroyed: false, writableEnded: false })
    return { req, res, event: { node: { req, res } } as unknown as H3Event }
  }
  let freeSlot!: () => void
  let holding!: () => void
  const held = new Promise<void>(resolve => { holding = resolve })
  const blocker = transport.withUpstreamSlot(() => { holding(); return new Promise<void>(resolve => { freeSlot = resolve }) })
  await held
  return {
    ...transport, calls, base, event, freeSlot,
    async close() {
      freeSlot()
      await blocker
      server.closeAllConnections()
      await new Promise<void>(resolve => server.close(() => resolve()))
      rmSync(directory, { recursive: true })
    },
  }
}

// Removing client cancellation from admission would send the abandoned POST to the real receiving socket.
it.each(['aborted', 'close'] as const)('never sends a queued POST after client %s, and reuses the slot', async (kind) => {
  const wire = await wireFixture()
  const client = wire.event()
  try {
    const pending = wire.tenantTransport(client.event, wire.base, '/api/v1/abandoned', { method: 'POST', body: '{}' })
    const outcome = pending.then(() => 'sent', () => 'cancelled')
    if (kind === 'aborted') { client.req.aborted = true; client.req.emit('aborted') }
    else { client.res.destroyed = true; client.res.emit('close') }
    const healthy = wire.tenantTransport(wire.event().event, wire.base, '/api/v1/healthy')
    wire.freeSlot()
    const result = await outcome
    expect((await healthy).status).toBe(200)
    expect(result).toBe('cancelled')
    expect(wire.calls).toEqual(['/api/v1/healthy'])
    expect(client.req.listenerCount('aborted')).toBe(0)
    expect(client.res.listenerCount('close')).toBe(0)
  } finally { await wire.close() }
})

it.each(['aborted', 'close'] as const)('rejects an already %s client before enqueueing', async (kind) => {
  const wire = await wireFixture()
  const client = wire.event()
  if (kind === 'aborted') client.req.aborted = true
  else client.res.destroyed = true
  try {
    const outcome = wire.tenantTransport(client.event, wire.base, '/api/v1/abandoned', { method: 'POST', body: '{}' }).then(() => 'sent', () => 'cancelled')
    wire.freeSlot()
    expect(await outcome).toBe('cancelled')
    expect((await wire.tenantTransport(wire.event().event, wire.base, '/api/v1/healthy')).status).toBe(200)
    expect(wire.calls).toEqual(['/api/v1/healthy'])
  } finally { await wire.close() }
})

it('returns a granted slot when cancellation wins before the waiting request resumes', async () => {
  const wire = await wireFixture()
  const client = wire.event()
  try {
    const outcome = wire.tenantTransport(client.event, wire.base, '/api/v1/abandoned', { method: 'POST', body: '{}' }).then(() => 'sent', () => 'cancelled')
    wire.freeSlot()
    // The blocker's continuation grants admission; the transport's continuation runs after this one.
    await Promise.resolve()
    client.req.aborted = true
    client.req.emit('aborted')
    expect(await outcome).toBe('cancelled')
    expect((await wire.tenantTransport(wire.event().event, wire.base, '/api/v1/healthy')).status).toBe(200)
    expect(wire.calls).toEqual(['/api/v1/healthy'])
    expect(client.req.listenerCount('aborted')).toBe(0)
    expect(client.res.listenerCount('close')).toBe(0)
  } finally { await wire.close() }
})

it.each([false, true])('cancels an explicit signal without waiting for capacity (already aborted: %s), even for a claimed write', async (alreadyAborted) => {
  const wire = await wireFixture()
  const client = wire.event()
  const controller = new AbortController()
  if (alreadyAborted) controller.abort()
  try {
    let outcome = 'pending'
    const pending = wire.tenantTransport(client.event, wire.base, '/api/v1/abandoned', { method: 'POST', body: '{}', signal: controller.signal, ignoreClientClose: true }).then(() => { outcome = 'sent' }, () => { outcome = 'cancelled' })
    controller.abort()
    await vi.waitFor(() => expect(outcome).toBe('cancelled'), { timeout: 250 })
    wire.freeSlot()
    await pending
    expect((await wire.tenantTransport(wire.event().event, wire.base, '/api/v1/healthy')).status).toBe(200)
    expect(wire.calls).toEqual(['/api/v1/healthy'])
    expect(client.req.listenerCount('aborted')).toBe(0)
    expect(client.res.listenerCount('close')).toBe(0)
    expect(getEventListeners(controller.signal, 'abort')).toHaveLength(0)
  } finally { await wire.close() }
})

it('does not forward a buffered POST when its real client socket closes during admission', async () => {
  const wire = await wireFixture()
  let queued!: () => void
  let closed!: () => void
  let completed!: (result: string) => void
  const waiting = new Promise<void>(resolve => { queued = resolve })
  const disconnected = new Promise<void>(resolve => { closed = resolve })
  const outcome = new Promise<string>(resolve => { completed = resolve })
  const proxy = http.createServer(async (req, res) => {
    const chunks: Buffer[] = []
    for await (const chunk of req) chunks.push(Buffer.from(chunk))
    res.once('close', closed)
    const pending = wire.tenantTransport({ node: { req, res } } as H3Event, wire.base, '/api/v1/abandoned', { method: 'POST', body: Buffer.concat(chunks) })
    queued()
    try { await pending; completed('sent') } catch { completed('cancelled') }
    res.end()
  })
  await new Promise<void>(resolve => proxy.listen(0, '127.0.0.1', resolve))
  const client = http.request({ hostname: '127.0.0.1', port: (proxy.address() as { port: number }).port, method: 'POST', headers: wire.event().req.headers })
  client.on('error', () => { /* Destroying the caller's socket is the action under test. */ })
  try {
    client.end('{}')
    await waiting
    client.destroy()
    await disconnected
    wire.freeSlot()
    expect(await outcome).toBe('cancelled')
    expect((await wire.tenantTransport(wire.event().event, wire.base, '/api/v1/healthy')).status).toBe(200)
    expect(wire.calls).toEqual(['/api/v1/healthy'])
  } finally {
    client.destroy()
    proxy.closeAllConnections()
    await new Promise<void>(resolve => proxy.close(() => resolve()))
    await wire.close()
  }
})

it('allows a claimed write to complete after its client closes while queued', async () => {
  const wire = await wireFixture()
  const client = wire.event()
  try {
    const pending = wire.tenantTransport(client.event, wire.base, '/api/v1/claimed', { method: 'POST', body: '{}', ignoreClientClose: true })
    client.res.destroyed = true
    client.res.emit('close')
    wire.freeSlot()
    expect((await pending).status).toBe(200)
    expect((await wire.tenantTransport(wire.event().event, wire.base, '/api/v1/healthy')).status).toBe(200)
    expect(wire.calls).toEqual(['/api/v1/claimed', '/api/v1/healthy'])
    expect(client.req.listenerCount('aborted')).toBe(0)
    expect(client.res.listenerCount('close')).toBe(0)
  } finally { await wire.close() }
})

// Dedicated requests use h3's proxy, so they must be cancelled before it reads a closed request stream.
it.each(['aborted', 'close'] as const)('cancels dedicated admission on client %s and returns capacity', async kind => {
  const wire = await wireFixture()
  const client = wire.event()
  try {
    const pending = wire.withUpstreamSlot(signal => fetch(wire.base + '/dedicated', { method: 'POST', body: '{}', signal }), client.event)
      .then(() => 'sent', () => 'cancelled')
    if (kind === 'aborted') { client.req.aborted = true; client.req.emit('aborted') }
    else { client.res.destroyed = true; client.res.emit('close') }
    wire.freeSlot()
    expect(await pending).toBe('cancelled')
    expect((await wire.withUpstreamSlot(() => fetch(wire.base + '/healthy'))).status).toBe(200)
    expect(wire.calls).toEqual(['/healthy'])
    expect(client.req.listenerCount('aborted')).toBe(0)
    expect(client.res.listenerCount('close')).toBe(0)
  } finally { await wire.close() }
})

it('cancels a dedicated POST whose real socket closes before proxy body reading', async () => {
  const wire = await wireFixture()
  let queued!: () => void
  let closed!: () => void
  const waiting = new Promise<void>(resolve => { queued = resolve })
  const disconnected = new Promise<void>(resolve => { closed = resolve })
  let outcome = 'pending'
  const proxy = http.createServer((req, res) => {
    res.once('close', closed)
    const event = createEvent(req, res)
    void wire.withUpstreamSlot(signal => proxyRequest(event, wire.base + '/abandoned', { fetchOptions: { signal } }), event)
      .then(() => { outcome = 'sent' }, () => { outcome = 'cancelled' }).finally(() => res.end())
    queued()
  })
  await new Promise<void>(resolve => proxy.listen(0, '127.0.0.1', resolve))
  const client = http.request({ hostname: '127.0.0.1', port: (proxy.address() as { port: number }).port, method: 'POST' })
  client.on('error', () => { /* Disconnect is the behavior under test. */ })
  try {
    client.end('{}')
    await waiting
    client.destroy()
    await disconnected
    wire.freeSlot()
    await vi.waitFor(() => expect(outcome).toBe('cancelled'), { timeout: 500 })
    expect((await wire.withUpstreamSlot(() => fetch(wire.base + '/healthy'))).status).toBe(200)
    expect(wire.calls).toEqual(['/healthy'])
  } finally {
    client.destroy()
    proxy.closeAllConnections()
    await new Promise<void>(resolve => proxy.close(() => resolve()))
    await wire.close()
  }
})
