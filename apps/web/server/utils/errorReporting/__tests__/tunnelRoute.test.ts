import { afterEach, describe, expect, it, vi } from 'vitest'

// The same-origin tunnel route: on the shared public host (`context.tenant === null`) the event carries no tenant tag.
const send = vi.fn(async () => new Response(null, { status: 200 }))
const body = Buffer.from([
  JSON.stringify({ event_id: 'e'.repeat(32), dsn: 'https://abc123@errors.invalid/7' }),
  JSON.stringify({ type: 'event' }),
  JSON.stringify({ event_id: 'e'.repeat(32), exception: { values: [{ type: 'Error', value: 'boom' }] } }),
].join('\n'))

async function post(tenant: unknown) {
  const headers: Record<string, string> = { 'sec-fetch-site': 'same-origin', 'content-length': String(body.length) }
  vi.stubGlobal('fetch', send)
  vi.stubGlobal('defineEventHandler', (handler: unknown) => handler)
  vi.stubGlobal('useRuntimeConfig', () => ({ sentryDsn: 'https://abc123@sentry.example.net/7', sentryEnvironment: 'staging', odooDb: 'shared_db' }))
  vi.stubGlobal('getHeader', (_event: unknown, name: string) => headers[name])
  vi.stubGlobal('readRawBody', async () => body)
  vi.stubGlobal('setResponseStatus', () => {})
  vi.stubGlobal('createError', (input: unknown) => Object.assign(new Error('refused'), input))
  const handler = (await import('../../../api/error-reports.post')).default as unknown as (event: unknown) => Promise<unknown>
  await handler({ context: { tenant } })
  await new Promise(resolve => setTimeout(resolve, 0))
  return JSON.parse(String((send.mock.calls[0] as unknown as [string, RequestInit])[1].body).split('\n')[2]!)
}

describe('browser error report tunnel route', () => {
  afterEach(() => { vi.unstubAllGlobals(); vi.resetModules(); send.mockClear() })

  it('tags no tenant on the shared public host', async () => {
    expect((await post(null)).tags).toEqual({ runtime: 'web-browser' })
  })
  it('tags the resolved tenant, or the configured database of a dedicated install', async () => {
    expect((await post({ tenantId: 'acme' })).tags).toEqual({ runtime: 'web-browser', tenant: 'acme' })
    send.mockClear()
    expect((await post(undefined)).tags).toEqual({ runtime: 'web-browser', tenant: 'shared_db' })
  })
})
