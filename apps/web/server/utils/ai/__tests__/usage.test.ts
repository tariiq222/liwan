import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { H3Event } from 'h3'
import { AI_USAGE_SERVICE_LIMITS, AiUsageServiceBatchSchema } from '@liwan/contracts'
import { usageBearer } from '../recorder'
import { createUsageLedger, retryUsage, SPOOL_MAX_AGE_MS } from '../usage'

const odooServiceUsageJson = vi.hoisted(() => vi.fn())
vi.mock('../upstream', async importOriginal => ({ ...await importOriginal<typeof import('../upstream')>(), odooServiceUsageJson }))
// A request names its tenant by `db` (a shared deployment); one without it is a dedicated deployment's, whose database is NUXT_ODOO_DB.
vi.mock('../../tenantRequest', () => ({ tenantRequest: (event: { db?: string }) => event.db ? { database: event.db } : null }))

const ROOT = 'c3'.repeat(32)
/** The spool lives as long as the process, so each test reports in a database of its own and never retries another test's rows. */
let tests = 0
let DATABASE = ''
let BEARER = ''
const callEvent = (id: string, extra: Record<string, unknown> = {}) => ({ call_id: id.padStart(16, '0'), kind: 'plan', capability: 'standard', billing: 'platform', provider: 'openrouter', model: 'anthropic/claude-sonnet-4.5', called_at: '2026-10-27T10:00:00Z', ...extra })
const usageEvent = (id: string, extra: Record<string, unknown> = {}) => ({ call_id: id.padStart(16, '0'), outcome: 'ok', input_tokens: 120, output_tokens: 7, cost: 4, charge: 5, ...extra })
/** A request whose session is gone (no cookie at all): the report never needs one. */
const noSession = {} as unknown as H3Event
/** A request of one tenant of a shared deployment. */
const sharedEvent = (db: string) => ({ db }) as unknown as H3Event
const SOMEONE = { user: '7', company: '1' }
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

beforeEach(() => {
  // Only the clock is faked: the module reads `Date.now()` and nothing else, and promise scheduling stays real.
  vi.useFakeTimers({ toFake: ['Date'] })
  vi.setSystemTime(NOW)
  odooServiceUsageJson.mockReset()
  odooServiceUsageJson.mockResolvedValue({ status: 200, body: { items: [], total: 0 } })
  vi.stubEnv('LIWAN_AI_USAGE_KEY', ROOT)
  vi.stubEnv('LIWAN_TENANCY_MODE', 'dedicated')
  DATABASE = `liwan_usage_db_${++tests}`
  BEARER = usageBearer(ROOT, DATABASE)
  vi.stubEnv('NUXT_ODOO_DB', DATABASE)
})
afterEach(() => { vi.useRealTimers(); vi.restoreAllMocks(); vi.unstubAllEnvs() })

describe('usage ledger', () => {
  const sent = () => odooServiceUsageJson.mock.calls.map(([, , body]) => body as { items: Record<string, unknown>[] })

  it('pairs a call with its usage and reports one row per attempt', async () => {
    const ledger = createUsageLedger()
    expect(ledger.observe('model_call', callEvent('a1'))).toBe(true)
    expect(ledger.observe('model_usage', usageEvent('a1', { outcome: 'retried', input_tokens: null, output_tokens: null, cost: null, charge: null }))).toBe(true)
    ledger.observe('model_call', callEvent('b2'))
    ledger.observe('model_usage', usageEvent('b2'))
    ledger.observe('model_call', callEvent('c3', { kind: 'title' }))
    ledger.observe('model_usage', usageEvent('c3', { input_tokens: 20, output_tokens: 3 }))
    ledger.endStream()
    await ledger.flush(noSession, 'r_1', { owner: { user: '7' }, company: '1' })
    expect(odooServiceUsageJson).toHaveBeenCalledTimes(1)
    expect(AiUsageServiceBatchSchema.parse(sent()[0]).items.map(item => [item.call_id, item.kind, item.outcome, item.input_tokens, item.output_tokens, item.conversation_id])).toEqual([
      ['00000000000000a1', 'plan', 'retried', null, null, 'r_1'], ['00000000000000b2', 'plan', 'ok', 120, 7, 'r_1'], ['00000000000000c3', 'title', 'ok', 20, 3, 'r_1'],
    ])
  })

  it('does not consume the events of the browser stream', () => {
    const ledger = createUsageLedger()
    for (const name of ['token', 'answer', 'tool_request', 'run', 'done']) expect(ledger.observe(name, { text: 'x' })).toBe(false)
  })

  it('skips a model_usage whose charge has no cost and closes that call as aborted', async () => {
    const ledger = createUsageLedger()
    vi.spyOn(console, 'error').mockImplementation(() => {})
    ledger.observe('model_call', callEvent('a1'))
    ledger.observe('model_usage', usageEvent('a1', { cost: null, charge: 5 }))
    await ledger.flush(noSession, 'r_bad', { owner: { user: '7' }, company: '1' })
    expect(sent()[0]!.items).toEqual([expect.objectContaining({ outcome: 'aborted', cost: null, charge: null })])
  })

  it.each([
    ['a call with a loose id', { call_id: 'xyz' }],
    ['a call with an unknown kind', { kind: 'other' }],
    ['a call with an extra key', { extra: 1 }],
    ['a call without an offset', { called_at: '2026-10-27T10:00:00' }],
  ])('logs and skips %s without failing the turn', async (_label, patch) => {
    const spy = vi.spyOn(console, 'error').mockImplementation(() => undefined)
    const ledger = createUsageLedger()
    expect(ledger.observe('model_call', callEvent('a1', patch))).toBe(true)
    ledger.endStream()
    await ledger.flush(noSession, 'r_1', { owner: { user: '7' }, company: '1' })
    expect(odooServiceUsageJson).not.toHaveBeenCalled()
    expect(logged(spy)).toEqual(['[liwan-ai] skipped a malformed model_call event: MalformedUsageEvent'])
  })

  it('sends 70 calls as two posts of at most 64 rows, and nothing when no call was reported, and only once', async () => {
    await ledgerOf(70).flush(noSession, 'r_1', { owner: { user: '7' }, company: '1' })
    expect(sent().map(call => call.items.length)).toEqual([64, 6])
    odooServiceUsageJson.mockClear()
    const ledger = ledgerOf(1, 100)
    await createUsageLedger().flush(noSession, 'r_2', { owner: { user: '7' }, company: '1' })
    await ledger.flush(noSession, 'r_3', { owner: { user: '7' }, company: '1' })
    await ledger.flush(noSession, 'r_3', { owner: { user: '7' }, company: '1' })
    expect(odooServiceUsageJson).toHaveBeenCalledTimes(1)
  })

  it('never throws from a flush, even when the request cannot name its tenant', async () => {
    const spy = vi.spyOn(console, 'error').mockImplementation(() => undefined)
    const hostile = { get db(): never { throw new Error('secret request detail') } } as unknown as H3Event
    await expect(ledgerOf(1).flush(hostile, 'r_1', { owner: { user: '7' }, company: '1' })).resolves.toBeUndefined()
    expect(JSON.stringify(spy.mock.calls)).not.toContain('secret request detail')
  })

  it('serializes the reports of one tenant, so two runs finishing together can never send a row twice', async () => {
    let release!: () => void
    odooServiceUsageJson.mockImplementationOnce(() => new Promise(resolve => { release = () => resolve({ status: 200, body: {} }) }))
    const first = ledgerOf(1).flush(noSession, 'r_one', { owner: { user: '7' }, company: '1' })
    await Promise.resolve()
    const second = ledgerOf(1, 1).flush(noSession, 'r_two', { owner: { user: '7' }, company: '1' })
    await Promise.resolve()
    expect(odooServiceUsageJson).toHaveBeenCalledTimes(1) // the second report waits for the first to settle
    release()
    await Promise.all([first, second])
    expect(sent().map(call => call.items.map(item => item.conversation_id))).toEqual([['r_one'], ['r_two']])
  })
})

describe('usage ledger reporting with the tenant bearer', () => {
  const SOMEONE = { user: '7', company: '1' }
  /** A request whose session is gone: no cookie at all (logout mid-stream, an expired cookie). */
  const serviceCalls = () => odooServiceUsageJson.mock.calls.map(([, key, body]) => ({ key: key as string, body: body as { user_id: number; user_company_id: number; items: Record<string, unknown>[] } }))
  const flushed = (ledger: ReturnType<typeof createUsageLedger>, request: H3Event = noSession, who = SOMEONE, conversation = 'r_svc') => ledger.flush(request, conversation, { owner: { user: who.user }, company: who.company })

  it('records a run whose session ended: no cookie is needed', async () => {
    await flushed(ledgerOf(2), noSession, { user: '21', company: '3' }, 'r_gone')
        const [call] = serviceCalls()
    expect(serviceCalls()).toHaveLength(1)
    expect(call!.key).toBe(usageBearer(ROOT, DATABASE))
    expect(AiUsageServiceBatchSchema.parse(call!.body)).toMatchObject({ user_id: 21, user_company_id: 3 })
    expect(call!.body.items.map(item => [item.call_id, item.conversation_id])).toEqual([['0000000000000000', 'r_gone'], ['0000000000000001', 'r_gone']])
    // The wire names the owner once, on the batch; a row never carries one.
    for (const item of call!.body.items) expect(Object.keys(item)).not.toContain('user_id')
  })

  it('reports the capability, cost and charge of each attempt, null where the service sent none', async () => {
    const ledger = createUsageLedger()
    ledger.observe('model_call', callEvent('a1', { capability: 'analysis' }))
    ledger.observe('model_usage', usageEvent('a1', { cost: 315, charge: 378 }))
    ledger.observe('model_call', callEvent('b2', { kind: 'title', capability: 'quick', billing: 'setup' }))
    ledger.observe('model_usage', usageEvent('b2', { cost: 0, charge: null }))
    ledger.observe('model_call', callEvent('c3', { billing: 'tenant_key' }))
    ledger.observe('model_usage', usageEvent('c3', { cost: null, charge: null }))
    ledger.observe('model_call', callEvent('d4'))  // never answered: closed as aborted without a cost
    ledger.endStream()
    await flushed(ledger, noSession, SOMEONE, 'r_cost')
    expect(serviceCalls()[0]!.body.items.map(item => [item.capability, item.cost, item.charge])).toEqual([
      ['analysis', 315, 378], ['quick', 0, null], ['standard', null, null], ['standard', null, null],
    ])
  })

  it('keeps the cost and charge, in shared and dedicated deployments alike', async () => {
    await flushed(ledgerOf(1), noSession)
    expect(serviceCalls()[0]!.body.items).toEqual([expect.objectContaining({ cost: 4, charge: 5 })])
    await flushed(ledgerOf(1, 1), sharedEvent('liwan_cost_shared'))
    expect(serviceCalls()[1]!.body.items).toEqual([expect.objectContaining({ cost: 4, charge: 5 })])
  })

  it('records a run whose browser went away mid-stream (every open attempt aborted)', async () => {
    const ledger = createUsageLedger()
    ledger.observe('model_call', callEvent('a1'))
    ledger.endStream()
    await flushed(ledger, noSession)
    expect(serviceCalls().map(call => call.body.items)).toEqual([[expect.objectContaining({ outcome: 'aborted', input_tokens: null, output_tokens: null })]])
      })

  it('keeps the rows when Odoo cannot be reached and settles them on the next run of anyone, once', async () => {
    odooServiceUsageJson.mockRejectedValueOnce(new TypeError('connection refused'))
    const spy = vi.spyOn(console, 'error').mockImplementation(() => undefined)
    await flushed(ledgerOf(2), noSession, { user: '8', company: '1' })
    expect(serviceCalls()).toHaveLength(1)
    expect(logged(spy)).toContain('[liwan-ai] usage report of 2 rows failed: TypeError')
    // Nobody retries inside the window.
    await flushed(ledgerOf(0), noSession, { user: '9', company: '1' })
    expect(serviceCalls()).toHaveLength(1)
    advance(RETRY_AFTER_MS + 1)
    // A different user's run is the trigger; the rows go out as their own user, not as the one who triggered the retry.
    await flushed(createUsageLedger(), noSession, { user: '9', company: '1' })
    expect(serviceCalls()).toHaveLength(2)
    expect(serviceCalls()[1]!.body).toMatchObject({ user_id: 8, user_company_id: 1, items: serviceCalls()[0]!.body.items })
    advance(RETRY_AFTER_MS + 1)
    await flushed(createUsageLedger(), noSession, { user: '9', company: '1' })
    expect(serviceCalls()).toHaveLength(2)
  })

  it('never mixes two users or two companies in one batch, and bounds a batch at 64 rows', async () => {
    await flushed(ledgerOf(70, 1000), noSession, { user: '5', company: '1' }, 'r_five')
    await flushed(ledgerOf(1, 2000), noSession, { user: '6', company: '1' }, 'r_six')
    await flushed(ledgerOf(1, 3000), noSession, { user: '5', company: '2' }, 'r_five_other')
    expect(serviceCalls().map(call => [call.body.user_id, call.body.user_company_id, call.body.items.length])).toEqual([[5, 1, 64], [5, 1, 6], [6, 1, 1], [5, 2, 1]])
  })

  it('stops at a refused credential without sending the other owners, keeps every row and names the status', async () => {
    const spy = vi.spyOn(console, 'error').mockImplementation(() => undefined)
    odooServiceUsageJson.mockResolvedValue({ status: 401, body: { code: 'unauthorized' } })
    await flushed(ledgerOf(1, 100), noSession, { user: '30', company: '1' })
    await flushed(ledgerOf(1, 200), noSession, { user: '31', company: '1' })
    expect(logged(spy).filter(line => String(line).startsWith('[liwan-ai] usage report of 1 rows failed with status 401'))).toHaveLength(2)
    expect(serviceCalls()).toHaveLength(2)
    odooServiceUsageJson.mockResolvedValue({ status: 200, body: { items: [], total: 0 } })
    advance(RETRY_AFTER_MS + 1)
    await flushed(createUsageLedger(), noSession, { user: '32', company: '1' })
    // Both held batches are delivered once the credential is accepted again.
    expect(serviceCalls().slice(2).map(call => call.body.user_id).sort()).toEqual([30, 31])
  })

  it('keeps the rows of an owner Odoo refuses as a whole, retries them, and gives them up only at the spool age bound', async () => {
    const spy = vi.spyOn(console, 'error').mockImplementation(() => undefined)
    odooServiceUsageJson.mockResolvedValue({ status: 422, body: { code: 'invalid', field: 'user_id' } })
    await flushed(ledgerOf(3, 400), noSession, { user: '40', company: '1' })
    expect(logged(spy)).toContain('[liwan-ai] KEPT 3 usage rows Odoo refuses as a whole (422 user_id); they are retried until the spool age bound: UsageRefusedRow')
    advance(RETRY_AFTER_MS + 1)
    await flushed(createUsageLedger(), noSession, { user: '41', company: '1' })
    expect(serviceCalls().map(call => [call.body.user_id, call.body.items.length])).toEqual([[40, 3], [40, 3]])
    advance(SPOOL_MAX_AGE_MS + 1)
    await flushed(createUsageLedger(), noSession, { user: '42', company: '1' })
    expect(logged(spy).some(line => /^\[liwan-ai] expired \d+ usage rows unaccepted for 60 minutes: UsageSpoolExpired$/.test(String(line)))).toBe(true)
    expect(serviceCalls().filter(call => call.body.user_id === 40)).toHaveLength(2)
  })

  it('settles only the row Odoo already holds (409) and keeps the row it refuses (422), sending the rest again at once', async () => {
    const spy = vi.spyOn(console, 'error').mockImplementation(() => undefined)
    odooServiceUsageJson.mockResolvedValueOnce({ status: 422, body: { code: 'invalid', field: 'items.1.input_tokens' } })
    await flushed(ledgerOf(3, 450), noSession, { user: '45', company: '2' })
    expect(serviceCalls().map(call => call.body.items.map(item => item.call_id))).toEqual([
      ['00000000000001c2', '00000000000001c3', '00000000000001c4'], ['00000000000001c2', '00000000000001c4'],
    ])
    odooServiceUsageJson.mockResolvedValueOnce({ status: 409, body: { code: 'duplicate', field: 'items.0.call_id' } })
    await flushed(ledgerOf(2, 500), noSession, { user: '46', company: '2' })
    expect(serviceCalls().slice(2).map(call => call.body.items.map(item => item.call_id))).toEqual([['00000000000001f4', '00000000000001f5'], ['00000000000001f5']])
    expect(logged(spy)).toEqual([
      '[liwan-ai] KEPT 1 usage row Odoo refuses (422 items.1.input_tokens); it is retried until the spool age bound: UsageRefusedRow',
      '[liwan-ai] settled 1 usage row Odoo already holds (409): UsageSettled',
    ])
    // The refused row comes back after the retry window, on its own; the 409 row never does.
    advance(RETRY_AFTER_MS + 1)
    await flushed(createUsageLedger(), noSession, { user: '47', company: '2' })
    expect(serviceCalls().slice(4).map(call => call.body.items.map(item => item.call_id))).toEqual([['00000000000001c3']])
  })

  describe('against the server rules (issue #557)', () => {
    /** Odoo's aggregate rule: a request above the per-minute token ceiling is a 422 on `items`; nothing else is size-limited. */
    const strictOdoo = () => odooServiceUsageJson.mockImplementation(async (_event, _key, body: { items: { input_tokens: number | null; output_tokens: number | null }[] }) => {
      const tokens = body.items.reduce((sum, item) => sum + (item.input_tokens ?? 0) + (item.output_tokens ?? 0), 0)
      return tokens > AI_USAGE_SERVICE_LIMITS.max_request_tokens || body.items.length > 64
        ? { status: 422, body: { code: 'invalid', field: 'items' } }
        : { status: 200, body: { items: [], total: body.items.length } }
    })
    const bigRun = (count: number, first: number, input_tokens: number = AI_USAGE_SERVICE_LIMITS.max_row_tokens) => {
      const ledger = createUsageLedger()
      for (let index = first; index < first + count; index++) {
        const id = index.toString(16)
        ledger.observe('model_call', callEvent(id))
        ledger.observe('model_usage', usageEvent(id, { input_tokens, output_tokens: 0 }))
      }
      return ledger
    }

    it('after an outage, splits seven valid maximal rows by the request ceiling and loses none', async () => {
      strictOdoo()
      odooServiceUsageJson.mockRejectedValueOnce(new TypeError('connection refused'))
      vi.spyOn(console, 'error').mockImplementation(() => undefined)
      await flushed(bigRun(7, 2000), noSession, { user: '60', company: '1' })
      advance(RETRY_AFTER_MS + 1)
      await flushed(createUsageLedger(), noSession, { user: '61', company: '1' })
      const recovered = serviceCalls().slice(1)
      expect(recovered.map(call => call.body.items.length)).toEqual([2, 2, 2, 1])
      for (const call of recovered) expect(call.body.items.reduce((sum, item) => sum + (item.input_tokens as number), 0)).toBeLessThanOrEqual(AI_USAGE_SERVICE_LIMITS.max_request_tokens)
      advance(RETRY_AFTER_MS + 1)
      await flushed(createUsageLedger(), noSession, { user: '62', company: '1' })
      expect(serviceCalls()).toHaveLength(5)
    })

    it('sends a row above the old 2,000,000 ceiling like any other, in the same request as small ones', async () => {
      strictOdoo()
      await flushed(bigRun(3, 2500, 5_000_000), noSession, { user: '65', company: '1' })
      expect(serviceCalls().map(call => call.body.items.length)).toEqual([3])
    })

    it('splits a request the server still refuses for size in halves, and never discards valid rows for it', async () => {
      const spy = vi.spyOn(console, 'error').mockImplementation(() => undefined)
      odooServiceUsageJson.mockImplementation(async (_event, _key, body: { items: unknown[] }) => body.items.length > 2 ? { status: 422, body: { code: 'invalid', field: 'items' } } : { status: 200, body: {} })
      await flushed(ledgerOf(5, 3000), noSession, { user: '63', company: '1' })
      expect(serviceCalls().map(call => call.body.items.length)).toEqual([5, 3, 2, 1, 2])
      expect(logged(spy)).toEqual([])
      advance(RETRY_AFTER_MS + 1)
      await flushed(createUsageLedger(), noSession, { user: '64', company: '1' })
      expect(serviceCalls()).toHaveLength(5)
    })

    it('never drops a row for its size: a lone row Odoo refuses on a size field is kept, logged loudly, and retried', async () => {
      const spy = vi.spyOn(console, 'error').mockImplementation(() => undefined)
      odooServiceUsageJson.mockResolvedValueOnce({ status: 422, body: { code: 'invalid', field: 'items.0.input_tokens' } })
      await flushed(bigRun(1, 2800), noSession, { user: '66', company: '1' })
      expect(logged(spy)).toEqual(['[liwan-ai] KEPT 1 usage row Odoo refuses (422 items.0.input_tokens); it is retried until the spool age bound: UsageRefusedRow'])
      advance(RETRY_AFTER_MS + 1)
      await flushed(createUsageLedger(), noSession, { user: '67', company: '1' })
      expect(serviceCalls()).toHaveLength(2)
      expect(serviceCalls()[1]!.body.items.map(item => item.call_id)).toEqual(serviceCalls()[0]!.body.items.map(item => item.call_id))
    })

    it('backs off on a 429 for what Odoo asked, keeps every deferred row and sends it later', async () => {
      const spy = vi.spyOn(console, 'error').mockImplementation(() => undefined)
      odooServiceUsageJson.mockResolvedValueOnce({ status: 429, body: { code: 'rate_limited', details: { retry_after_seconds: 300 } } })
      await flushed(ledgerOf(2, 4000), noSession, { user: '70', company: '1' })
      expect(serviceCalls()).toHaveLength(1)
      advance(RETRY_AFTER_MS + 1)
      await flushed(createUsageLedger(), noSession, { user: '72', company: '1' })
      expect(serviceCalls()).toHaveLength(1)
      advance(300 * 1000)
      await flushed(createUsageLedger(), noSession, { user: '72', company: '1' })
      expect(serviceCalls().slice(1).map(call => [call.body.user_id, call.body.items.length])).toEqual([[70, 2]])
      expect(logged(spy)).toEqual(['[liwan-ai] usage report of 2 rows failed with status 429: UsageRefused'])
    })

    it('a 429 without a back-off still waits the retry window and is never dropped', async () => {
      vi.spyOn(console, 'error').mockImplementation(() => undefined)
      odooServiceUsageJson.mockResolvedValueOnce({ status: 429, body: 'plain' })
      await flushed(ledgerOf(1, 4200), noSession, { user: '73', company: '1' })
      advance(RETRY_AFTER_MS + 1)
      await flushed(createUsageLedger(), noSession, { user: '73', company: '1' })
      expect(serviceCalls()).toHaveLength(2)
    })

    it('a row with a stale called_at is refused for itself alone: it is kept and logged, its neighbour is recorded now', async () => {
      const spy = vi.spyOn(console, 'error').mockImplementation(() => undefined)
      odooServiceUsageJson.mockResolvedValueOnce({ status: 422, body: { code: 'invalid', field: 'items.0.called_at' } })
      await flushed(ledgerOf(2, 5000), noSession, { user: '74', company: '1' })
      expect(serviceCalls().map(call => call.body.items.length)).toEqual([2, 1])
      expect(logged(spy)).toEqual(['[liwan-ai] KEPT 1 usage row Odoo refuses (422 items.0.called_at); it is retried until the spool age bound: UsageRefusedRow'])
    })

    it('never holds a row longer than the server accepts a row for age: the spool gives up first', () => {
      expect(SPOOL_MAX_AGE_MS).toBeLessThan(AI_USAGE_SERVICE_LIMITS.max_age_hours * 3600 * 1000)
    })
  })

    it('refuses to guess an owner: an unusable user or company is logged and nothing is sent', async () => {
    const spy = vi.spyOn(console, 'error').mockImplementation(() => undefined)
    for (const who of [{ user: '', company: '1' }, { user: 'abc', company: '1' }, { user: '7', company: '0' }, { user: '-7', company: '1' }, { user: '7;1', company: '1' }]) await flushed(ledgerOf(1, 500), noSession, who)
    expect(serviceCalls()).toHaveLength(0)
        expect(logged(spy)).toEqual(Array(5).fill('[liwan-ai] dropped 1 usage rows of a run with no usable user or company: UsageOwnerInvalid'))
  })

  it('writes the bearer to no log line, whatever fails', async () => {
    const spy = vi.spyOn(console, 'error').mockImplementation(() => undefined)
    odooServiceUsageJson.mockRejectedValueOnce(Object.assign(new Error(`Bearer ${BEARER}`), { statusCode: 502 }))
    await flushed(ledgerOf(1, 600), noSession, { user: '50', company: '1' })
    odooServiceUsageJson.mockResolvedValueOnce({ status: 500, body: BEARER })
    advance(RETRY_AFTER_MS + 1)
    await flushed(createUsageLedger(), noSession, { user: '51', company: '1' })
    expect(spy).toHaveBeenCalled()
    expect(JSON.stringify(spy.mock.calls)).not.toContain(BEARER)
  })

  it('drops the rows of a run with no usable recorder, logging the count and the class only, and spools nothing', async () => {
    const spy = vi.spyOn(console, 'error').mockImplementation(() => undefined)
    for (const root of ['', 'not-hex']) {
      vi.stubEnv('LIWAN_AI_USAGE_KEY', root)
      await flushed(ledgerOf(2, 800), noSession, { user: '55', company: '1' })
    }
    expect(odooServiceUsageJson).not.toHaveBeenCalled()
    expect(logged(spy)).toEqual(Array(2).fill('[liwan-ai] dropped 2 usage rows of a run with no usable recorder: UsageRecorderUnavailable'))
    vi.stubEnv('LIWAN_AI_USAGE_KEY', ROOT)
    advance(RETRY_AFTER_MS + 1)
    await flushed(createUsageLedger(), noSession, { user: '56', company: '1' })
    expect(odooServiceUsageJson).not.toHaveBeenCalled()
  })
})

/** Two tenants of a shared process have the same user and company ids; their rows must never meet. */
describe('usage spool per tenant', () => {
  let A = '', B = ''
  beforeEach(() => { A = `liwan_tenant_a_${tests}`; B = `liwan_tenant_b_${tests}` })
  const serviceCalls = () => odooServiceUsageJson.mock.calls.map(([request, key, body]) => ({ request: request as { db: string }, key: key as string, body: body as { user_id: number; user_company_id: number; items: Record<string, unknown>[] } }))
  const flushedIn = (db: string, ledger: ReturnType<typeof createUsageLedger>, conversation: string) => ledger.flush(sharedEvent(db), conversation, { owner: { user: '2' }, company: '1' })

  it('never batches two tenants together nor sends a row on another tenant\'s event or credential', async () => {
    odooServiceUsageJson.mockRejectedValue(new TypeError('connection refused'))
    vi.spyOn(console, 'error').mockImplementation(() => undefined)
    await flushedIn(A, ledgerOf(2, 10), 'r_a')
    await flushedIn(B, ledgerOf(1, 20), 'r_b')
    odooServiceUsageJson.mockReset().mockResolvedValue({ status: 200, body: {} })
    advance(RETRY_AFTER_MS + 1)
    await flushedIn(B, createUsageLedger(), 'r_quiet_b')
    expect(serviceCalls().map(call => [call.request.db, call.key, call.body.items.map(item => item.conversation_id)])).toEqual([[B, usageBearer(ROOT, B), ['r_b']]])
    await flushedIn(A, createUsageLedger(), 'r_quiet_a')
    expect(serviceCalls().slice(1).map(call => [call.request.db, call.key, call.body.items.map(item => item.conversation_id)])).toEqual([[A, usageBearer(ROOT, A), ['r_a', 'r_a']]])
  })

  it('bounds one tenant separately, so a busy tenant never evicts the rows of another', async () => {
    const spy = vi.spyOn(console, 'error').mockImplementation(() => undefined)
    odooServiceUsageJson.mockResolvedValue({ status: 500, body: {} })
    await flushedIn(A, ledgerOf(2, 3000), 'r_quiet')
    await flushedIn(B, ledgerOf(1100, 4000), 'r_busy')
    expect(logged(spy)).toContain('[liwan-ai] dropped 76 usage rows of one tenant over the 1024-row bound: UsageTenantOverflow')
    odooServiceUsageJson.mockReset().mockResolvedValue({ status: 200, body: {} })
    advance(RETRY_AFTER_MS + 1)
    await flushedIn(A, createUsageLedger(), 'r_next')
    expect(serviceCalls().map(call => [call.request.db, call.body.items.length])).toEqual([[A, 2]])
  })

  it('marks only the refused tenant when its credential is refused (401), and keeps its rows', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => undefined)
    const { assertUsageRecordable } = await import('../recorder')
    vi.stubEnv('LIWAN_TENANCY_MODE', 'shared')
    odooServiceUsageJson.mockResolvedValue({ status: 401, body: {} })
    await flushedIn(A, ledgerOf(1, 5000), 'r_refused')
    odooServiceUsageJson.mockReset().mockResolvedValue({ status: 200, body: {} })
    await expect(assertUsageRecordable(sharedEvent(A))).rejects.toMatchObject({ statusCode: 503, data: { code: 'ai_unavailable' } })
    await expect(assertUsageRecordable(sharedEvent(B))).resolves.toBe(false)
    expect(odooServiceUsageJson).toHaveBeenCalledTimes(1)
  })

  it('retryUsage sends the due rows of its own tenant only and never throws', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => undefined)
    odooServiceUsageJson.mockResolvedValue({ status: 500, body: {} })
    await flushedIn(A, ledgerOf(1, 6000), 'r_a')
    await flushedIn(B, ledgerOf(1, 6100), 'r_b')
    odooServiceUsageJson.mockReset().mockResolvedValue({ status: 200, body: {} })
    advance(RETRY_AFTER_MS + 1)
    await retryUsage(sharedEvent(A))
    expect(serviceCalls().map(call => [call.request.db, call.body.items.map(item => item.conversation_id)])).toEqual([[A, ['r_a']]])
    vi.stubEnv('LIWAN_AI_USAGE_KEY', '')
    await expect(retryUsage(sharedEvent(A))).resolves.toBeUndefined()
  })

  it('keeps the spool age bound across tenants', () => {
    expect(SPOOL_MAX_AGE_MS).toBeLessThan(AI_USAGE_SERVICE_LIMITS.max_age_hours * 3600 * 1000)
  })
})
