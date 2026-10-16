import { Agent, createServer, request, type Server } from 'node:http'
import type { AddressInfo } from 'node:net'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createApp, defineEventHandler, toNodeListener } from 'h3'
import { MAX_BODY_BYTES, PROXY_INVALID, readJsonObject } from '../body'
import { bffHandler } from '../errors'
import { stubConfig } from './harness'

const echo = bffHandler('body-test', async event => ({ size: (await readJsonObject(event, PROXY_INVALID)).raw.length }))

let server: Server
let bytesRead = 0
const post = (chunks: string[], headers: Record<string, string> = {}) => new Promise<{ status: number; text: string }>((resolve, reject) => {
  const { port } = server.address() as AddressInfo
  const req = request({ port, method: 'POST', path: '/', agent: new Agent({ keepAlive: true }), headers: { 'content-type': 'application/json', ...headers } }, (res) => {
    let text = ''
    res.on('data', c => { text += c })
    res.on('end', () => resolve({ status: res.statusCode ?? 0, text }))
  })
  // A client that is cut off mid-upload after the 413 is expected.
  req.on('error', () => undefined)
  req.on('socket', socket => socket.on('error', () => undefined))
  req.on('close', () => resolve({ status: -1, text: '' }))
  for (const c of chunks) req.write(c)
  req.end()
  void reject
})

describe('request body cap on the actual stream', () => {
  beforeEach(async () => {
    stubConfig()
    const app = createApp()
    bytesRead = 0
    app.use(defineEventHandler((event) => { const { socket } = event.node.req; event.node.res.once('finish', () => { bytesRead = socket.bytesRead }) }))
    app.use(echo)
    server = createServer(toNodeListener(app))
    await new Promise<void>(r => server.listen(0, '127.0.0.1', r))
  })
  afterEach(async () => { vi.unstubAllGlobals(); await new Promise(r => server.close(r)) })

  it('answers 413 for a chunked body over the cap with no content-length', async () => {
    const piece = 'x'.repeat(16 * 1024)
    const chunks = ['{"pad":"', ...Array.from({ length: (8 * MAX_BODY_BYTES) / piece.length }, () => piece), '"}']
    const result = await post(chunks)
    expect(result.status).toBe(413)
    expect(JSON.parse(result.text)).toEqual({ code: 'payload_too_large' })
    // The server stops reading at the cap instead of buffering the whole upload.
    expect(bytesRead).toBeLessThan(MAX_BODY_BYTES + 512 * 1024)
  })

  it('accepts a chunked body under the cap', async () => {
    const result = await post(['{"a":', '1}'])
    expect(result).toEqual({ status: 200, text: '{"size":7}' })
  })
})
