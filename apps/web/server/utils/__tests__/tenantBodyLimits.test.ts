import { expect, it, vi } from 'vitest'
import { PassThrough, Readable } from 'node:stream'
import type { H3Event } from 'h3'
import { boundedTenantBody } from '../tenantTransport'

it('rejects incoming body above 16 MiB rather than forwarding it', async () => {
  const req = Readable.from([Buffer.alloc(16 * 1024 * 1024), Buffer.from('x')])
  const event = { method: 'POST', node: { req } } as unknown as H3Event
  await expect(boundedTenantBody(event)).rejects.toMatchObject({ statusCode: 413 })
})
it('accepts exact body limit without changing bytes', async () => {
  const bytes = Buffer.alloc(16 * 1024 * 1024, 65)
  const event = { method: 'POST', node: { req: Readable.from([bytes]) } } as unknown as H3Event
  const result = await boundedTenantBody(event)
  expect(result?.length).toBe(bytes.length)
  expect(result?.equals(bytes)).toBe(true)
})
it('destroys a stalled upload at the total deadline', async () => {
  vi.useFakeTimers()
  const req = new PassThrough()
  try {
    const result = boundedTenantBody({ method: 'POST', node: { req } } as unknown as H3Event)
    const rejected = expect(result).rejects.toThrow()
    req.write('partial')
    await vi.advanceTimersByTimeAsync(15000)
    await rejected
    expect(req.destroyed).toBe(true)
    expect(vi.getTimerCount()).toBe(0)
  } finally { req.destroy(); vi.useRealTimers() }
})
