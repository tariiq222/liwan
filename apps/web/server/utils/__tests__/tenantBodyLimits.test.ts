import { expect, it, vi } from 'vitest'
import { EventEmitter } from 'node:events'
import { PassThrough, Readable } from 'node:stream'
import type { H3Event } from 'h3'
import { boundedTenantBody } from '../tenantTransport'

function eventFor(req: Readable) {
  const res = Object.assign(new EventEmitter(), { destroyed: false, writableEnded: false, headersSent: false, setHeader: vi.fn() })
  return { method: 'POST', node: { req, res } } as unknown as H3Event
}

it('rejects incoming body above 16 MiB rather than forwarding it', async () => {
  const req = Readable.from([Buffer.alloc(16 * 1024 * 1024), Buffer.from('x')])
  const event = eventFor(req)
  await expect(boundedTenantBody(event)).rejects.toMatchObject({ statusCode: 413 })
})
it('accepts exact body limit without changing bytes', async () => {
  const bytes = Buffer.alloc(16 * 1024 * 1024, 65)
  const event = eventFor(Readable.from([bytes]))
  const result = await boundedTenantBody(event)
  expect(result?.length).toBe(bytes.length)
  expect(result?.equals(bytes)).toBe(true)
})
it('rejects a stalled upload at the deadline while retaining the socket for a strict error response', async () => {
  vi.useFakeTimers()
  const req = new PassThrough()
  try {
    const event = eventFor(req)
    const result = boundedTenantBody(event)
    const rejected = expect(result).rejects.toMatchObject({ statusCode: 502, data: { code: 'tenant_upstream_unavailable', message: 'The upstream service is temporarily unavailable.' } })
    req.write('partial')
    await vi.advanceTimersByTimeAsync(15000)
    await rejected
    expect(req.destroyed).toBe(false)
    expect(req.readableFlowing).toBe(false)
    expect(event.node.res.setHeader).toHaveBeenCalledWith('connection', 'close')
    expect(vi.getTimerCount()).toBe(0)
  } finally { req.destroy(); vi.useRealTimers() }
})
