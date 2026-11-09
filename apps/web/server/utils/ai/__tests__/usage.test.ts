import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { H3Event } from 'h3'
import { AiUsageBatchSchema } from '@liwan/contracts'
import { createUsageLedger } from '../usage'

const odooJson = vi.hoisted(() => vi.fn())
vi.mock('../upstream', async importOriginal => ({ ...await importOriginal<typeof import('../upstream')>(), odooJson }))

const callEvent = (id: string, extra: Record<string, unknown> = {}) => ({ call_id: id.padStart(16, '0'), kind: 'plan', billing: 'platform', provider: 'openrouter', model: 'anthropic/claude-sonnet-4.5', called_at: '2026-10-27T10:00:00Z', ...extra })
const usageEvent = (id: string, extra: Record<string, unknown> = {}) => ({ call_id: id.padStart(16, '0'), outcome: 'ok', input_tokens: 120, output_tokens: 7, ...extra })
/** Each test reports as its own session, because the spool is per session and one test must never retry another's rows. */
const ledgerEvent = (session: string) => ({ node: { req: { headers: { cookie: `session_id=${session}` } } } }) as unknown as H3Event
const event = ledgerEvent('plain')
/** A flush that observed nothing is the retry trigger for the rows an earlier refused report left behind. */
const retried = (session: H3Event) => createUsageLedger().flush(session, 'r_retry')
const sent = () => odooJson.mock.calls.map(([, , , options]) => options as { body: { items: Record<string, unknown>[] }; signal: unknown })
const logged = (spy: { mock: { calls: unknown[][] } }) => spy.mock.calls.map(call => call[0])

/** The retry window after a refused batch, as the module under test defines it. */
const RETRY_AFTER_MS = 60 * 1000
const NOW = new Date('2026-11-08T09:00:00.000Z')
const advance = (ms: number) => vi.setSystemTime(new Date(Date.now() + ms))

/** A ledger that observed `count` completed calls, with distinct ids. */
const ledgerOf = (count: number, first = 0) => {
  const ledger = createUsageLedger()
  for (let index = first; index < first + count; index++) {
    const id = index.toString(16)
    ledger.observe('model_call', callEvent(id))
    ledger.observe('model_usage', usageEvent(id))
  }
  return ledger
}
const conversations = (call: { body: { items: Record<string, unknown>[] } }) => call.body.items.map(item => item.conversation_id)

beforeEach(() => {
  // Only the clock is faked: the module reads `Date.now()` and nothing else, and promise scheduling stays real.
  vi.useFakeTimers({ toFake: ['Date'] })
  vi.setSystemTime(NOW)
  odooJson.mockReset()
  odooJson.mockResolvedValue({ status: 200, body: { items: [], total: 0 } })
})
afterEach(() => { vi.useRealTimers(); vi.restoreAllMocks() })

describe('usage ledger', () => {
  it('pairs a call with its usage and reports one row per attempt', async () => {
    const ledger = createUsageLedger()
    expect(ledger.observe('model_call', callEvent('a1'))).toBe(true)
    expect(ledger.observe('model_usage', usageEvent('a1', { outcome: 'retried', input_tokens: null, output_tokens: null }))).toBe(true)
    ledger.observe('model_call', callEvent('b2'))
    ledger.observe('model_usage', usageEvent('b2'))
    ledger.observe('model_call', callEvent('c3', { kind: 'title' }))
    ledger.observe('model_usage', usageEvent('c3', { input_tokens: 20, output_tokens: 3 }))
    ledger.endStream()
    await ledger.flush(event, 'r_1')
    expect(odooJson).toHaveBeenCalledTimes(1)
    const [, method, path] = odooJson.mock.calls[0]!
    expect([method, path]).toEqual(['POST', '/api/v1/ai/usage'])
    const { body, signal } = sent()[0]!
    expect(signal).toBeNull()
    expect(AiUsageBatchSchema.parse(body).items.map(item => [item.call_id, item.kind, item.outcome, item.input_tokens, item.output_tokens, item.conversation_id])).toEqual([
      ['00000000000000a1', 'plan', 'retried', null, null, 'r_1'], ['00000000000000b2', 'plan', 'ok', 120, 7, 'r_1'], ['00000000000000c3', 'title', 'ok', 20, 3, 'r_1'],
    ])
    expect(body.items[0]).toMatchObject({ provider: 'openrouter', model: 'anthropic/claude-sonnet-4.5', called_at: '2026-10-27T10:00:00Z' })
  })

  it('does not consume the events of the browser stream', () => {
    const ledger = createUsageLedger()
    for (const name of ['token', 'answer', 'tool_request', 'run', 'done']) expect(ledger.observe(name, { text: 'x' })).toBe(false)
  })

  it('re-sends a retried batch row for row, with the call id that makes Odoo count it once', async () => {
    // Issue #557: the retry carries the same `call_id`, so Odoo's unique (user, conversation, call) index settles it.
    const session = ledgerEvent('resent')
    odooJson.mockRejectedValueOnce(new TypeError('answer never arrived'))
    await ledgerOf(2).flush(session, 'r_resent')
    expect(sent()[0]!.body.items.map(item => item.call_id)).toEqual(['0000000000000000', '0000000000000001'])

    advance(RETRY_AFTER_MS + 1)
    await retried(session)
    // The retry repeats the same attempts: Odoo answers success and records the two rows it already holds.
    expect(sent()[1]!.body.items.map(item => item.call_id)).toEqual(['0000000000000000', '0000000000000001'])
    expect(sent()[1]!.body.items).toEqual(sent()[0]!.body.items)
  })

  it('reports a call whose stream ended before its usage as aborted without tokens', async () => {
    const ledger = createUsageLedger()
    ledger.observe('model_call', callEvent('a1'))
    ledger.endStream()
    await ledger.flush(event, 'r_1')
    expect(sent()[0]!.body.items).toEqual([expect.objectContaining({ outcome: 'aborted', input_tokens: null, output_tokens: null })])
  })

  it.each([
    ['a call with a loose id', 'model_call', { call_id: 'xyz' }],
    ['a call with an unknown kind', 'model_call', { kind: 'other' }],
    ['a call with an extra key', 'model_call', { extra: 1 }],
    ['a call without an offset', 'model_call', { called_at: '2026-10-27T10:00:00' }],
  ])('logs and skips %s without failing the turn', async (_label, name, patch) => {
    const spy = vi.spyOn(console, 'error').mockImplementation(() => undefined)
    const ledger = createUsageLedger()
    expect(ledger.observe(name, callEvent('a1', patch))).toBe(true)
    ledger.endStream()
    await ledger.flush(event, 'r_1')
    expect(odooJson).not.toHaveBeenCalled()
    expect(spy.mock.calls.map(call => call[0])).toEqual(['[liwan-ai] skipped a malformed model_call event: MalformedUsageEvent'])
  })

  it.each([
    ['unpaired tokens', { output_tokens: null }],
    ['negative tokens', { input_tokens: -1 }],
    ['an unknown outcome', { outcome: 'lost' }],
  ])('closes a known call as aborted when its usage has %s', async (_label, patch) => {
    vi.spyOn(console, 'error').mockImplementation(() => undefined)
    const ledger = createUsageLedger()
    ledger.observe('model_call', callEvent('a1'))
    expect(ledger.observe('model_usage', usageEvent('a1', patch))).toBe(true)
    await ledger.flush(event, 'r_1')
    expect(sent()[0]!.body.items).toEqual([expect.objectContaining({ outcome: 'aborted', input_tokens: null, output_tokens: null })])
  })

  it('skips a usage for a call it never saw, a repeated call id and a second usage for one call', async () => {
    const spy = vi.spyOn(console, 'error').mockImplementation(() => undefined)
    const ledger = createUsageLedger()
    ledger.observe('model_usage', usageEvent('f'.padStart(16, 'f')))
    ledger.observe('model_call', callEvent('a1'))
    ledger.observe('model_call', callEvent('a1', { kind: 'title' }))
    ledger.observe('model_usage', usageEvent('a1'))
    ledger.observe('model_usage', usageEvent('a1', { outcome: 'failed' }))
    ledger.endStream()
    await ledger.flush(event, 'r_1')
    expect(spy).toHaveBeenCalledTimes(3)
    expect(sent()[0]!.body.items).toEqual([expect.objectContaining({ kind: 'plan', outcome: 'ok', input_tokens: 120 })])
  })

  it('sends 70 calls as two posts of at most 64 rows', async () => {
    const ledger = createUsageLedger()
    for (let index = 0; index < 70; index++) {
      const id = index.toString(16)
      ledger.observe('model_call', callEvent(id))
      ledger.observe('model_usage', usageEvent(id))
    }
    await ledger.flush(event, 'r_1')
    expect(sent().map(call => call.body.items.length)).toEqual([64, 6])
    expect(sent().every(call => call.signal === null)).toBe(true)
    sent().forEach(call => AiUsageBatchSchema.parse(call.body))
  })

  it('sends nothing when no call was reported, and only once', async () => {
    const empty = createUsageLedger()
    await empty.flush(event, 'r_1')
    expect(odooJson).not.toHaveBeenCalled()
    const ledger = createUsageLedger()
    ledger.observe('model_call', callEvent('a1'))
    ledger.endStream()
    await ledger.flush(event, 'r_1')
    await ledger.flush(event, 'r_1')
    expect(odooJson).toHaveBeenCalledTimes(1)
  })

  it('logs a failed or refused flush on the server with the class name and the row count only, and never throws', async () => {
    const spy = vi.spyOn(console, 'error').mockImplementation(() => undefined)
    odooJson.mockRejectedValueOnce(new TypeError('secret detail from odoo'))
    const failing = createUsageLedger()
    failing.observe('model_call', callEvent('a1'))
    failing.endStream()
    await expect(failing.flush(ledgerEvent('failed'), 'r_1')).resolves.toBeUndefined()
    odooJson.mockResolvedValueOnce({ status: 500, body: { code: 'boom', message: 'secret detail from odoo' } })
    const refused = createUsageLedger()
    refused.observe('model_call', callEvent('b2'))
    refused.endStream()
    await expect(refused.flush(ledgerEvent('refused'), 'r_1')).resolves.toBeUndefined()
    expect(spy.mock.calls.map(call => call[0])).toEqual([
      '[liwan-ai] usage report of 1 rows failed: TypeError', '[liwan-ai] usage report of 1 rows failed: UsageRefused',
    ])
    expect(JSON.stringify(spy.mock.calls)).not.toContain('secret detail')
  })
})

describe('usage spool', () => {
  it('keeps the rows of a refused report and reports them with the next flush of the same session', async () => {
    const session = ledgerEvent('refused-then-retried')
    odooJson.mockResolvedValueOnce({ status: 500, body: { code: 'boom', message: 'secret detail from odoo' } })
    const refused = ledgerOf(1)
    await refused.flush(session, 'r_a')
    expect(conversations(sent()[0]!)).toEqual(['r_a'])

    // A refused batch is due again after the retry window: a flush inside it reports only its own rows.
    const next = ledgerOf(1, 1)
    await next.flush(session, 'r_b')
    expect(sent().map(conversations)).toEqual([['r_a'], ['r_b']])

    // The next flush past the window carries what the refused one left behind first, then its own rows.
    advance(RETRY_AFTER_MS + 1)
    const later = ledgerOf(1, 2)
    await later.flush(session, 'r_c')
    expect(sent().map(conversations)).toEqual([['r_a'], ['r_b'], ['r_a', 'r_c']])
    expect(sent()[2]!.signal).toBeNull()

    // Everything was accepted: a flush that observed nothing has nothing left to report.
    await retried(session)
    expect(sent()).toHaveLength(3)
  })

  it('keeps a timeout, a dead connection and a 401 of an ended session for a retry instead of dropping them', async () => {
    const spy = vi.spyOn(console, 'error').mockImplementation(() => undefined)
    const timedOut = ledgerEvent('timed-out')
    odooJson.mockRejectedValueOnce(new TypeError('secret detail from odoo'))
    await ledgerOf(2).flush(timedOut, 'r_timeout')
    const ended = ledgerEvent('ended-session')
    odooJson.mockResolvedValueOnce({ status: 401, body: { code: 'unauthorized', message: 'no session' } })
    await ledgerOf(3).flush(ended, 'r_ended')
    expect(logged(spy)).toEqual([
      '[liwan-ai] usage report of 2 rows failed: TypeError',
      '[liwan-ai] usage report of 3 rows failed: UsageRefused',
    ])
    expect(JSON.stringify(spy.mock.calls)).not.toContain('secret detail')

    // The rows survived their session: both are reported in full once a session may report again.
    advance(RETRY_AFTER_MS + 1)
    await retried(timedOut)
    await retried(ended)
    expect(sent().slice(2).map(call => call.body.items.length)).toEqual([2, 3])
    expect(sent().slice(2).flatMap(call => call.body.items).every(item => item.outcome === 'ok')).toBe(true)
  })

  it('bounds the spool, drops the oldest rows and logs one line by count only, never the payload', async () => {
    const spy = vi.spyOn(console, 'error').mockImplementation(() => undefined)
    // Nine sessions at their own bound (256) hold 2304 rows, so the process bound is what drops the oldest 256.
    const sessions = Array.from({ length: 9 }, (_, index) => ledgerEvent(`bounded-${index}`))
    odooJson.mockResolvedValue({ status: 500, body: { code: 'boom' } })
    for (const session of sessions) await ledgerOf(256).flush(session, 'r_bound')
    expect(logged(spy)).toContain('[liwan-ai] dropped 256 usage rows over the 2048-row spool bound: UsageSpoolOverflow')
    expect(JSON.stringify(spy.mock.calls)).not.toMatch(/openrouter|claude-sonnet|r_bound|secret detail/)

    // Exactly the bounded remainder survives, reported in batches of at most 64: the newest rows are the ones kept.
    advance(RETRY_AFTER_MS + 1)
    odooJson.mockResolvedValue({ status: 200, body: { items: [], total: 0 } })
    const before = sent().length
    for (const session of sessions) await retried(session)
    const reported = sent().slice(before).flatMap(call => call.body.items)
    expect(reported).toHaveLength(2048)
    expect(sent().slice(before).every(call => call.body.items.length <= 64)).toBe(true)
    expect(reported.every(item => item.conversation_id === 'r_bound')).toBe(true)
  })

  it('bounds one session separately, so a busy session never evicts the rows of another', async () => {
    // Issue #557: on a shared process a busy tenant must not push another tenant's rows out of the global spool.
    const spy = vi.spyOn(console, 'error').mockImplementation(() => undefined)
    const quiet = ledgerEvent('quiet-tenant')
    const busy = ledgerEvent('busy-tenant')
    odooJson.mockResolvedValueOnce({ status: 500, body: { code: 'boom' } })
    await ledgerOf(2).flush(quiet, 'r_quiet')

    // The busy session reports far more than its own bound; only its own rows are dropped, oldest first.
    odooJson.mockResolvedValue({ status: 500, body: { code: 'boom' } })
    await ledgerOf(400).flush(busy, 'r_busy')
    expect(logged(spy)).toEqual([
      '[liwan-ai] usage report of 2 rows failed: UsageRefused',
      '[liwan-ai] dropped 144 usage rows of one session over the 256-row bound: UsageSessionOverflow',
      '[liwan-ai] usage report of 64 rows failed: UsageRefused',
    ])
    expect(spy.mock.calls.map(call => call[0])).toContain('[liwan-ai] dropped 144 usage rows of one session over the 256-row bound: UsageSessionOverflow')

    // The quiet session still holds its two rows, and reports them once its retry window passed.
    spy.mockClear()
    odooJson.mockResolvedValue({ status: 200, body: { items: [], total: 0 } })
    advance(RETRY_AFTER_MS + 1)
    await retried(quiet)
    expect(sent().at(-1)!.body.items.map(item => item.conversation_id)).toEqual(['r_quiet', 'r_quiet'])
    expect(spy).not.toHaveBeenCalled()
  })

  it('never spools the rows of a request with no session, and logs them by count only', async () => {
    // Issue #557: a usage row is billed to the session that sends it, so one with no session has no owner to retry under.
    const spy = vi.spyOn(console, 'error').mockImplementation(() => undefined)
    const anonymous = { node: { req: { headers: {} } } } as unknown as H3Event
    odooJson.mockRejectedValueOnce(new TypeError('answer never arrived'))
    await expect(ledgerOf(3).flush(anonymous, 'r_anonymous')).resolves.toBeUndefined()
    expect(odooJson).not.toHaveBeenCalled()
    expect(logged(spy)).toEqual(['[liwan-ai] dropped 3 usage rows of a request with no session: UsageUnattributed'])
    expect(JSON.stringify(spy.mock.calls)).not.toMatch(/openrouter|claude-sonnet|r_anonymous/)

    // Nothing was spooled, so no later session reports those rows as its own.
    advance(RETRY_AFTER_MS + 1)
    await retried(ledgerEvent('someone-else'))
    expect(odooJson).not.toHaveBeenCalled()
  })

  it('drops a spooled row past its age bound and reports it by count only, never the payload', async () => {
    const spy = vi.spyOn(console, 'error').mockImplementation(() => undefined)
    const session = ledgerEvent('aged')
    odooJson.mockResolvedValueOnce({ status: 403, body: { code: 'forbidden', message: 'no' } })
    await ledgerOf(2).flush(session, 'r_aged')
    spy.mockClear()
    advance(60 * 60 * 1000 + 1)
    await retried(session)
    expect(logged(spy)).toEqual([expect.stringMatching(/^\[liwan-ai] expired \d+ usage rows unaccepted for 60 minutes: UsageSpoolExpired$/)])
    expect(odooJson).toHaveBeenCalledTimes(1)
    expect(JSON.stringify(spy.mock.calls)).not.toMatch(/openrouter|r_aged/)
  })

  it('never reports the rows of another session: a usage row belongs to the session that observed it', async () => {
    const mine = ledgerEvent('owning-session')
    const other = ledgerEvent('another-session')
    odooJson.mockResolvedValueOnce({ status: 403, body: { code: 'forbidden', message: 'no' } })
    await ledgerOf(1).flush(mine, 'r_mine')
    expect(sent()).toHaveLength(1)

    advance(RETRY_AFTER_MS + 1)
    await ledgerOf(1, 1).flush(other, 'r_other')
    expect(sent().map(conversations)).toEqual([['r_mine'], ['r_other']])

    await retried(mine)
    expect(sent().slice(2).map(conversations)).toEqual([['r_mine']])
  })

  it('makes a flush that observed nothing a retry trigger for the rows an earlier refusal left behind', async () => {
    const session = ledgerEvent('quiet-run')
    odooJson.mockResolvedValueOnce({ status: 500, body: { code: 'boom' } })
    await ledgerOf(1).flush(session, 'r_failed')
    expect(sent()).toHaveLength(1)

    advance(RETRY_AFTER_MS + 1)
    await createUsageLedger().flush(session, 'r_quiet')
    expect(sent().map(conversations)).toEqual([['r_failed'], ['r_failed']])

    // Accepted, so the spool is empty and the next run reports only its own rows.
    await ledgerOf(1, 1).flush(session, 'r_loud')
    expect(sent().map(conversations)).toEqual([['r_failed'], ['r_failed'], ['r_loud']])
  })

  it('never throws from a flush, even when the request cannot name its session', async () => {
    // `relay` chains `flush` last and nobody awaits it: a throw here would be an unhandled rejection on the server.
    const spy = vi.spyOn(console, 'error').mockImplementation(() => undefined)
    const hostile = { get node(): never { throw new Error('secret request detail') } } as unknown as H3Event
    await expect(ledgerOf(1).flush(hostile, 'r_1')).resolves.toBeUndefined()
    expect(JSON.stringify(spy.mock.calls)).not.toContain('secret request detail')
    spy.mockRestore()
  })

  it('serializes the reports of one session, so two runs finishing together can never send a row twice', async () => {
    const session = ledgerEvent('concurrent')
    let release!: () => void
    odooJson.mockImplementationOnce(() => new Promise(resolve => { release = () => resolve({ status: 200, body: { items: [], total: 0 } }) }))
    const first = ledgerOf(1).flush(session, 'r_one')
    await Promise.resolve()
    const second = ledgerOf(1, 1).flush(session, 'r_two')
    await Promise.resolve()
    expect(sent()).toHaveLength(1) // the second report waits for the first to settle
    release()
    await Promise.all([first, second])
    expect(sent().map(conversations)).toEqual([['r_one'], ['r_two']])
  })
})
