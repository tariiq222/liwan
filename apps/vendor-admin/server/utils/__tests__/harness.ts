import { createServer, request } from 'node:http'
import type { AddressInfo } from 'node:net'
import { createApp, toNodeListener, type EventHandler } from 'h3'
import { vi } from 'vitest'

export const KEY = 'service-key-service-key-service-key-0123'
export const INSTALLATION = 'vendor-admin-test'
export const SESSION = `7.${'A'.repeat(43)}`
export const TOKEN = 'T'.repeat(43)
export const ORIGIN = 'http://localhost:3103'
export const CONTROL = 'http://127.0.0.1:4701'

export type Upstream = { url: URL; method: string; headers: Record<string, string>; body: string | undefined }

export function stubConfig(overrides: Record<string, unknown> = {}) {
  vi.stubGlobal('useRuntimeConfig', () => ({
    controlUrl: CONTROL, serviceKey: KEY, installationId: INSTALLATION, adminOrigin: ORIGIN, trustProxy: false, ...overrides,
  }))
}

/** Replaces the global fetch with a recorder that answers with `reply` (called per request). */
export function stubUpstream(reply: (request: Upstream) => Response | Promise<Response>) {
  const calls: Upstream[] = []
  vi.stubGlobal('fetch', vi.fn(async (url: URL | string, init: RequestInit) => {
    const call = { url: new URL(url), method: String(init.method), headers: init.headers as Record<string, string>, body: init.body as string | undefined }
    calls.push(call)
    return reply(call)
  }))
  return calls
}

export const json = (status: number, body?: unknown) =>
  status === 204 ? new Response(null, { status }) : new Response(JSON.stringify(body ?? {}), { status, headers: { 'content-type': 'application/json' } })

export type Sent = { method?: string; body?: unknown; rawBody?: string; headers?: Record<string, string> }

/** Sends one request through a handler on a real loopback server, as the browser would (same-origin JSON unless overridden). */
export async function send(handler: EventHandler, path: string, sent: Sent = {}) {
  const method = sent.method ?? 'POST'
  const app = createApp()
  app.use(handler)
  const server = createServer(toNodeListener(app))
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve))
  try {
    const raw = sent.rawBody ?? (sent.body === undefined ? undefined : JSON.stringify(sent.body))
    const headers: Record<string, string> = method === 'GET' ? {} : { 'content-type': 'application/json', origin: ORIGIN, 'sec-fetch-site': 'same-origin' }
    const response = await new Promise<{ status: number; text: string; headers: Headers }>((resolve, reject) => {
      const req = request({ port: (server.address() as AddressInfo).port, method, path, headers: { ...headers, ...sent.headers } }, (res) => {
        let text = ''
        res.on('data', (chunk) => { text += chunk })
        res.on('end', () => {
          const out = new Headers()
          for (const [name, value] of Object.entries(res.headers)) for (const v of [value].flat()) if (v !== undefined) out.append(name, v)
          resolve({ status: res.statusCode ?? 0, text, headers: out })
        })
      })
      req.on('error', reject)
      if (method !== 'GET') req.write(raw ?? '{}')
      req.end()
    })
    return { status: response.status, text: response.text, body: response.text ? JSON.parse(response.text) : null, headers: response.headers }
  } finally {
    server.closeAllConnections()
    await new Promise(resolve => server.close(resolve))
  }
}

export const cookieHeader = (value = SESSION, name = 'webvue_admin') => ({ cookie: `${name}=${value}` })

/** The item at `index`, or a failure: keeps tests free of non-null assertions. */
export function at<T>(items: readonly T[], index: number): T {
  const item = items[index]
  if (item === undefined) throw new Error(`expected an item at index ${index}`)
  return item
}
