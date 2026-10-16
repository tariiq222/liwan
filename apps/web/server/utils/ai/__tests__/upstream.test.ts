import { beforeEach, describe, expect, it, vi } from 'vitest'
import { odooJson, readSse } from '../upstream'

const transport = vi.hoisted(() => vi.fn())
vi.mock('../../tenantTransport', () => ({ tenantTransport: transport }))
vi.mock('../../tenantRequest', () => ({ tenantUpstreamHeaders: () => ({ host: 'a.example.test' }) }))

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
