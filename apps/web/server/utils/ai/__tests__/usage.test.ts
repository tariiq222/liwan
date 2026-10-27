import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { AiUsageBatchSchema } from '@webvue/contracts'
import { createUsageLedger } from '../usage'

const odooJson = vi.hoisted(() => vi.fn())
vi.mock('../upstream', async importOriginal => ({ ...await importOriginal<typeof import('../upstream')>(), odooJson }))

const callEvent = (id: string, extra: Record<string, unknown> = {}) => ({ call_id: id.padStart(16, '0'), kind: 'plan', provider: 'openrouter', model: 'anthropic/claude-sonnet-4.5', called_at: '2026-10-27T10:00:00Z', ...extra })
const usageEvent = (id: string, extra: Record<string, unknown> = {}) => ({ call_id: id.padStart(16, '0'), outcome: 'ok', input_tokens: 120, output_tokens: 7, ...extra })
const event = {} as never
const sent = () => odooJson.mock.calls.map(([, , , options]) => options as { body: { items: Record<string, unknown>[] }; signal: unknown })

beforeEach(() => { odooJson.mockReset(); odooJson.mockResolvedValue({ status: 200, body: { items: [], total: 0 } }) })
afterEach(() => vi.restoreAllMocks())

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
    expect(AiUsageBatchSchema.parse(body).items.map(item => [item.kind, item.outcome, item.input_tokens, item.output_tokens, item.conversation_id])).toEqual([
      ['plan', 'retried', null, null, 'r_1'], ['plan', 'ok', 120, 7, 'r_1'], ['title', 'ok', 20, 3, 'r_1'],
    ])
    expect(body.items[0]).toMatchObject({ provider: 'openrouter', model: 'anthropic/claude-sonnet-4.5', called_at: '2026-10-27T10:00:00Z' })
  })

  it('does not consume the events of the browser stream', () => {
    const ledger = createUsageLedger()
    for (const name of ['token', 'answer', 'tool_request', 'run', 'done']) expect(ledger.observe(name, { text: 'x' })).toBe(false)
  })

  it('reports a call whose stream ended before its usage as aborted without tokens', async () => {
    const ledger = createUsageLedger()
    ledger.observe('model_call', callEvent('a1'))
    ledger.endStream()
    await ledger.flush(event, 'r_1')
    expect(sent()[0]!.body.items).toEqual([expect.objectContaining({ outcome: 'aborted', input_tokens: null, output_tokens: null })])
  })

  it('closes only the calls still open: a later usage for a closed call is malformed', () => {
    const ledger = createUsageLedger()
    ledger.observe('model_call', callEvent('a1'))
    ledger.endStream()
    expect(() => ledger.observe('model_usage', usageEvent('a1'))).toThrow(expect.objectContaining({ statusCode: 502, data: expect.objectContaining({ code: 'ai_upstream' }) }))
  })

  it.each([
    ['a call with a loose id', 'model_call', { call_id: 'xyz' }],
    ['a call with an unknown kind', 'model_call', { kind: 'other' }],
    ['a call with an extra key', 'model_call', { extra: 1 }],
    ['a call without an offset', 'model_call', { called_at: '2026-10-27T10:00:00' }],
  ])('answers 502 ai_upstream for %s', (_label, name, patch) => {
    const ledger = createUsageLedger()
    expect(() => ledger.observe(name, callEvent('a1', patch))).toThrow(expect.objectContaining({ statusCode: 502, data: expect.objectContaining({ code: 'ai_upstream' }) }))
  })

  it.each([
    ['unpaired tokens', { output_tokens: null }],
    ['negative tokens', { input_tokens: -1 }],
    ['an unknown outcome', { outcome: 'lost' }],
    ['a call the ledger never saw', { call_id: 'f'.padStart(16, 'f') }],
  ])('answers 502 ai_upstream for usage with %s', (_label, patch) => {
    const ledger = createUsageLedger()
    ledger.observe('model_call', callEvent('a1'))
    expect(() => ledger.observe('model_usage', usageEvent('a1', patch))).toThrow(expect.objectContaining({ statusCode: 502 }))
  })

  it('rejects a repeated call id and a second usage for one call', () => {
    const ledger = createUsageLedger()
    ledger.observe('model_call', callEvent('a1'))
    expect(() => ledger.observe('model_call', callEvent('a1'))).toThrow(expect.objectContaining({ statusCode: 502 }))
    ledger.observe('model_usage', usageEvent('a1'))
    expect(() => ledger.observe('model_usage', usageEvent('a1'))).toThrow(expect.objectContaining({ statusCode: 502 }))
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
    await expect(failing.flush(event, 'r_1')).resolves.toBeUndefined()
    odooJson.mockResolvedValueOnce({ status: 500, body: { code: 'boom', message: 'secret detail from odoo' } })
    const refused = createUsageLedger()
    refused.observe('model_call', callEvent('b2'))
    refused.endStream()
    await expect(refused.flush(event, 'r_1')).resolves.toBeUndefined()
    expect(spy.mock.calls.map(call => call[0])).toEqual([
      '[webvue-ai] usage report of 1 rows failed: TypeError', '[webvue-ai] usage report of 1 rows failed: UsageRefused',
    ])
    expect(JSON.stringify(spy.mock.calls)).not.toContain('secret detail')
  })
})
