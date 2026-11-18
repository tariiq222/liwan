import { afterEach, describe, expect, it, vi } from 'vitest'
import { MAX_ENVELOPE_BYTES, relayBrowserReport } from '../tunnel'
import type { ErrorReportingSettings } from '../settings'

const SETTINGS: ErrorReportingSettings = { dsn: 'https://abc123@sentry.example.net/7', environment: 'staging', release: 'rel-1', tenant: 'acme' }
const PLACEHOLDER_DSN = 'https://abc123@errors.invalid/7'

function envelope(dsn: string, event: Record<string, unknown> = {}, itemType = 'event') {
  const payload = { event_id: 'e'.repeat(32), exception: { values: [{ type: 'Error', value: 'boom 0551234567' }] }, ...event }
  return Buffer.from([JSON.stringify({ event_id: payload.event_id, dsn }), JSON.stringify({ type: itemType }), JSON.stringify(payload)].join('\n'))
}

const okFetch = () => vi.fn(async () => new Response(null, { status: 200 }))

describe('browser error report tunnel', () => {
  afterEach(() => { vi.restoreAllMocks() })

  it('answers 404 and sends nothing when no DSN is configured', () => {
    const send = okFetch()
    expect(relayBrowserReport({ settings: { ...SETTINGS, dsn: '' }, body: envelope(PLACEHOLDER_DSN), contentLength: 100 }, send).status).toBe(404)
    expect(send).not.toHaveBeenCalled()
  })

  it('forwards an envelope of the configured project, scrubbed, to the real Sentry host', async () => {
    const send = okFetch()
    const body = envelope(PLACEHOLDER_DSN, { request: { url: 'https://acme.example.com/a?access_token=s', headers: { Cookie: 'c' } }, user: { id: '7' } })
    const { status, done } = relayBrowserReport({ settings: SETTINGS, secFetchSite: 'same-origin', body, contentLength: body.length }, send)
    await done
    expect(status).toBe(204)
    expect(send).toHaveBeenCalledTimes(1)
    const [url, init] = send.mock.calls[0] as unknown as [string, RequestInit]
    expect(url).toBe('https://sentry.example.net/api/7/envelope/')
    const lines = String(init.body).split('\n')
    expect(JSON.parse(lines[0]!).dsn).toBe(SETTINGS.dsn)
    const event = JSON.parse(lines[2]!)
    expect(event.exception.values[0].value).toBe('boom [phone withheld]')
    expect(event.request).toEqual({ url: '/a' })
    expect(event.tags).toEqual({ runtime: 'web-browser', tenant: 'acme', release: 'rel-1' })
    expect(event.user).toEqual({ id: '7' })
  })

  it('masks an access token in an exception text that reaches the tunnel', async () => {
    const send = okFetch()
    const value = 'FetchError: [GET] "/api/v1/public/appointments/bookings/42?access_token=abcdEFGH-ijklMNOP-qrstUVWX": 404'
    const body = envelope(PLACEHOLDER_DSN, { exception: { values: [{ type: 'Error', value }] } })
    const { done } = relayBrowserReport({ settings: SETTINGS, secFetchSite: 'same-origin', body, contentLength: body.length }, send)
    await done
    const sentBody = String((send.mock.calls[0] as unknown as [string, RequestInit])[1].body)
    expect(sentBody).not.toContain('abcdEFGH')
    expect(sentBody).toContain('bookings/42?access_token=***')
  })

  it.each([
    ['another project', 'https://abc123@errors.invalid/8'],
    ['another key', 'https://zzz999@errors.invalid/7'],
  ])('rejects an envelope of %s', (_name, dsn) => {
    const send = okFetch()
    const body = envelope(dsn)
    expect(relayBrowserReport({ settings: SETTINGS, secFetchSite: 'same-origin', body, contentLength: body.length }, send).status).toBe(403)
    expect(send).not.toHaveBeenCalled()
  })

  it('rejects a cross-site request, an oversized body, garbage and an envelope without an error event', () => {
    const send = okFetch()
    const body = envelope(PLACEHOLDER_DSN)
    expect(relayBrowserReport({ settings: SETTINGS, body, contentLength: body.length, secFetchSite: 'cross-site' }, send).status).toBe(403)
    expect(relayBrowserReport({ settings: SETTINGS, body, contentLength: body.length }, send).status).toBe(403)
    expect(relayBrowserReport({ settings: SETTINGS, secFetchSite: 'same-origin', body, contentLength: MAX_ENVELOPE_BYTES + 1 }, send).status).toBe(413)
    expect(relayBrowserReport({ settings: SETTINGS, secFetchSite: 'same-origin', body: Buffer.alloc(MAX_ENVELOPE_BYTES + 1), contentLength: 0 }, send).status).toBe(413)
    expect(relayBrowserReport({ settings: SETTINGS, secFetchSite: 'same-origin', body: undefined, contentLength: 0 }, send).status).toBe(400)
    expect(relayBrowserReport({ settings: SETTINGS, secFetchSite: 'same-origin', body: Buffer.from('not json'), contentLength: 8 }, send).status).toBe(400)
    const attachment = envelope(PLACEHOLDER_DSN, {}, 'attachment')
    expect(relayBrowserReport({ settings: SETTINGS, secFetchSite: 'same-origin', body: attachment, contentLength: attachment.length }, send).status).toBe(400)
    const transaction = envelope(PLACEHOLDER_DSN, { type: 'transaction' })
    expect(relayBrowserReport({ settings: SETTINGS, secFetchSite: 'same-origin', body: transaction, contentLength: transaction.length }, send).status).toBe(400)
    expect(send).not.toHaveBeenCalled()
  })

  it('never repeats what Sentry answered, and a failing Sentry does not fail the page', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined)
    const body = envelope(PLACEHOLDER_DSN)
    const refused = vi.fn(async () => new Response('secret detail', { status: 500 }))
    await relayBrowserReport({ settings: SETTINGS, secFetchSite: 'same-origin', body, contentLength: body.length }, refused).done
    const down = vi.fn(async () => { throw new Error('connect ECONNREFUSED secret-host') })
    const result = relayBrowserReport({ settings: SETTINGS, secFetchSite: 'same-origin', body, contentLength: body.length }, down)
    await expect(result.done).resolves.toBeUndefined()
    expect(result.status).toBe(204)
    expect(warn.mock.calls.flat().join(' ')).not.toMatch(/secret/)
  })

  it('answers 429 while too many reports are still on their way to Sentry', async () => {
    const pending: (() => void)[] = []
    const slow = vi.fn(() => new Promise<Response>((resolve) => { pending.push(() => resolve(new Response(null, { status: 200 }))) }))
    const body = envelope(PLACEHOLDER_DSN)
    const input = { settings: SETTINGS, secFetchSite: 'same-origin', body, contentLength: body.length }
    const done = Array.from({ length: 20 }, () => relayBrowserReport(input, slow))
    expect(done.every(result => result.status === 204)).toBe(true)
    expect(relayBrowserReport(input, slow).status).toBe(429)
    pending.forEach(release => release())
    await Promise.all(done.map(result => result.done))
    expect(relayBrowserReport(input, okFetch()).status).toBe(204)
  })
})
