import { describe, expect, it } from 'vitest'
import type { ErrorEvent } from '@sentry/browser'
import { scrubEvent, scrubReportText } from '../errorReportScrub'

const CITIZEN_ID = '1000000008'
const context = { runtime: 'web-server', release: 'rel-1', environment: 'staging', tenant: 'acme' } as const

function eventWith(extra: Record<string, unknown>): ErrorEvent {
  return { type: undefined, event_id: 'a'.repeat(32), level: 'error', ...extra } as ErrorEvent
}

describe('error report scrub', () => {
  it('withholds identity numbers, IBANs, phones and emails from messages, exceptions and breadcrumbs', () => {
    const text = `هوية ${CITIZEN_ID} جوال 0551234567 بريد a.b@example.com آيبان SA0380000000608010167519`
    const scrubbed = scrubEvent(eventWith({
      message: text,
      exception: { values: [{ type: 'Error', value: text }] },
      breadcrumbs: [{ category: 'ui', message: text, data: { url: '/pay?access_token=secret' } }],
    }), context)
    const withheld = 'هوية [national_id withheld] جوال [phone withheld] بريد [email withheld] آيبان [iban withheld]'
    expect(scrubbed.message).toBe(withheld)
    expect(scrubbed.exception?.values?.[0]?.value).toBe(withheld)
    expect(scrubbed.breadcrumbs).toEqual([{ category: 'ui', message: withheld }])
  })

  it('keeps only the method, the route and the user agent of a request, without query, cookies or body', () => {
    const scrubbed = scrubEvent(eventWith({
      request: {
        method: 'POST',
        url: 'https://acme.example.com/pay/ABCDEFGHIJKLMNOPQRSTUVWX1234/confirm?access_token=secret&phone=0551234567',
        headers: { Cookie: 'session_id=abc', Authorization: 'Bearer x', 'user-agent': 'UA/1' },
        cookies: { session_id: 'abc' },
        data: { password: 'p' },
        query_string: 'access_token=secret',
      },
    }), context)
    expect(scrubbed.request).toEqual({ method: 'POST', url: '/pay/:token/confirm', headers: { 'User-Agent': 'UA/1' } })
  })

  it('drops everything outside the allow-list and sets the user, tags, release and environment', () => {
    const scrubbed = scrubEvent(eventWith({
      server_name: 'host-1', extra: { body: 'x' }, contexts: { os: {} }, modules: { a: '1' }, transaction: '/pay/secret',
      user: { id: '9', email: 'a@b.com', ip_address: '1.2.3.4' },
      exception: { values: [{ type: 'Error', value: 'x', stacktrace: { frames: [{ filename: 'a.js', lineno: 3, vars: { token: 't' }, context_line: 'secret()' }] } }] },
    }), { ...context, userId: 42 })
    expect(scrubbed).not.toHaveProperty('server_name')
    expect(scrubbed).not.toHaveProperty('extra')
    expect(scrubbed).not.toHaveProperty('contexts')
    expect(scrubbed).not.toHaveProperty('modules')
    expect(scrubbed).not.toHaveProperty('transaction')
    expect(scrubbed.user).toEqual({ id: '42' })
    expect(scrubbed.tags).toEqual({ runtime: 'web-server', tenant: 'acme', release: 'rel-1' })
    expect(scrubbed.release).toBe('rel-1')
    expect(scrubbed.environment).toBe('staging')
    expect(scrubbed.exception?.values?.[0]?.stacktrace?.frames).toEqual([{ filename: 'a.js', lineno: 3 }].map(frame => expect.objectContaining(frame)))
    expect(scrubbed.exception?.values?.[0]?.stacktrace?.frames?.[0]).not.toHaveProperty('vars')
    expect(scrubbed.exception?.values?.[0]?.stacktrace?.frames?.[0]).not.toHaveProperty('context_line')
  })

  it('sends only the static template of a log entry, never its params, formatted text or message', () => {
    const scrubbed = scrubEvent(eventWith({
      message: 'failed for Ahmed Private',
      logentry: { message: 'failed for %s', formatted: 'failed for Ahmed Private', params: ['Ahmed Private', 'a.b@example.com'] },
    }), context)
    expect(scrubbed.logentry).toEqual({ message: 'failed for %s' })
    expect(scrubbed.message).toBeUndefined()
    expect(JSON.stringify(scrubbed)).not.toContain('Ahmed')
  })

  it('cuts texts at 300 characters and masks URL credentials and Bearer tokens', () => {
    expect(scrubReportText('x'.repeat(500))).toHaveLength(300)
    const masked = scrubReportText('GET https://user:hunter2@host.example/p with Authorization: Bearer abc.def-123')
    for (const secret of ['hunter2', 'user:', 'abc.def-123']) expect(masked).not.toContain(secret)
    expect(masked).toContain('https://[redacted]@host.example/p')
    const scrubbed = scrubEvent(eventWith({
      exception: { values: [{ type: 'Error', value: 'y'.repeat(500) }] },
      breadcrumbs: [{ category: 'ui', message: 'z'.repeat(500) }],
    }), context)
    expect(scrubbed.exception?.values?.[0]?.value).toHaveLength(300)
    expect(scrubbed.breadcrumbs?.[0]?.message).toHaveLength(300)
  })

  it('sets no user when the id is unknown', () => {
    expect(scrubEvent(eventWith({ user: { id: '9' } }), context).user).toBeUndefined()
  })
})
