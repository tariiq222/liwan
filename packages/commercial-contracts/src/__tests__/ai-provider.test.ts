import { describe, expect, it } from 'vitest'
import {
  AI_CAPABILITIES, AI_QUALITY_LEVELS, aiPriceSchema, aiProviderCurrentSchema, aiProviderModelsRequestSchema, aiProviderSaveSchema, aiProviderTestRequestSchema,
  aiProviderTestResultSchema,
} from '../index'

const key = 'sk-0123456789abcdef'
const save = () => ({
  margin_bps: 2000,
  providers: { oai: { preset: 'openai', api_key: key }, local: { preset: 'ollama', base_url: 'http://ollama:11434' } },
  models: { mid: { provider: 'oai', model: 'gpt-4o', input_price: '2.5', cached_input_price: '1.25', output_price: '10' }, small: { provider: 'local', model: 'qwen2.5:7b' } },
  routes: { default: 'mid', balanced: { quick: 'small' }, economical: { standard: 'small' }, best: {} },
  reason: 'Two providers',
})

describe('AI provider panel contracts', () => {
  it('names the four capabilities and the three quality levels once', () => {
    expect(AI_CAPABILITIES).toEqual(['quick', 'standard', 'analysis', 'writing'])
    expect(AI_QUALITY_LEVELS).toEqual(['economical', 'balanced', 'best'])
  })

  it('accepts the whole configuration in one save and requires a reason', () => {
    expect(aiProviderSaveSchema.safeParse(save()).success).toBe(true)
    expect(aiProviderSaveSchema.safeParse({ ...save(), reason: 'ab' }).success).toBe(false)
    const { reason: _reason, ...withoutReason } = save()
    expect(aiProviderSaveSchema.safeParse(withoutReason).success).toBe(false)
    expect(aiProviderSaveSchema.safeParse({ ...save(), routes: {} }).success).toBe(true)  // a draft: nothing routed yet
  })

  it('refuses unknown fields at every level, bad ids, an unknown quality level or capability, and a margin outside 0 to 10000', () => {
    const body = save()
    expect(aiProviderSaveSchema.safeParse({ ...body, extra: 1 }).success).toBe(false)
    expect(aiProviderSaveSchema.safeParse({ ...body, providers: { oai: { preset: 'openai', api_key: key, model: 'x' } } }).success).toBe(false)
    expect(aiProviderSaveSchema.safeParse({ ...body, models: { mid: { provider: 'oai', model: 'm', price: '1' } } }).success).toBe(false)
    expect(aiProviderSaveSchema.safeParse({ ...body, providers: { 'Bad Id': { preset: 'openai' } } }).success).toBe(false)
    expect(aiProviderSaveSchema.safeParse({ ...body, models: { '1st': { provider: 'oai', model: 'm' } } }).success).toBe(false)
    expect(aiProviderSaveSchema.safeParse({ ...body, routes: { premium: {} } }).success).toBe(false)
    expect(aiProviderSaveSchema.safeParse({ ...body, routes: { best: { translation: 'mid' } } }).success).toBe(false)
    expect(aiProviderSaveSchema.safeParse({ ...body, routes: { default: 'Mid' } }).success).toBe(false)
    for (const margin_bps of [-1, 10_001, 1.5, '2000']) expect(aiProviderSaveSchema.safeParse({ ...body, margin_bps }).success, String(margin_bps)).toBe(false)
    expect(aiProviderSaveSchema.safeParse({ ...body, margin_bps: 0 }).success).toBe(true)
    expect(aiProviderSaveSchema.safeParse({ ...body, margin_bps: 10_000 }).success).toBe(true)
  })

  it('refuses a key with whitespace, a model with control characters and too many providers or models', () => {
    const body = save()
    expect(aiProviderSaveSchema.safeParse({ ...body, providers: { oai: { preset: 'openai', api_key: 'sk with space 12345' } } }).success).toBe(false)
    expect(aiProviderSaveSchema.safeParse({ ...body, models: { mid: { provider: 'oai', model: 'a\nb' } } }).success).toBe(false)
    const many = (n: number, entry: unknown) => Object.fromEntries(Array.from({ length: n }, (_, i) => [`p${i}`, entry]))
    expect(aiProviderSaveSchema.safeParse({ ...body, providers: many(16, { preset: 'ollama', base_url: 'http://o:1' }) }).success).toBe(true)
    expect(aiProviderSaveSchema.safeParse({ ...body, providers: many(17, { preset: 'ollama', base_url: 'http://o:1' }) }).success).toBe(false)
    expect(aiProviderSaveSchema.safeParse({ ...body, models: many(65, { provider: 'oai', model: 'm' }) }).success).toBe(false)
  })

  it('takes a price as a decimal string of USD per million tokens that is a whole number of cost units', () => {
    for (const price of ['0', '2.5', '0.14', '10', '0.00001', '21474.83647']) expect(aiPriceSchema.safeParse(price).success, price).toBe(true)
    for (const price of ['0.000001', '21474.83648', '-1', '1e3', '', '.5', '5.', ' 1', 'abc', '1,5']) expect(aiPriceSchema.safeParse(price).success, price).toBe(false)
    expect(aiPriceSchema.safeParse(2.5).success).toBe(false)  // a string: a float could not carry five decimals exactly
  })

  it('probes a saved provider by its id, and tests a model of it', () => {
    expect(aiProviderModelsRequestSchema.safeParse({ provider: 'oai' }).success).toBe(true)
    expect(aiProviderModelsRequestSchema.safeParse({ provider: 'oai', api_key: key }).success).toBe(false)  // the stored key is used; none is sent
    expect(aiProviderTestRequestSchema.safeParse({ provider: 'oai', model: 'gpt-4o' }).success).toBe(true)
    expect(aiProviderTestRequestSchema.safeParse({ provider: 'oai', model: 'a\nb' }).success).toBe(false)
    expect(aiProviderTestRequestSchema.safeParse({ provider: 'oai', model: 'm', stream_usage: false }).success).toBe(false)
  })

  it('never has a place for a key in a response', () => {
    const setting = {
      revision: 2, margin_bps: 2000, updated_at: '2026-11-06T10:00:00.000Z', updated_by: 'owner@liwan.example', delivery: 'delivered',
      providers: { oai: { preset: 'openai', provider: 'openai', base_url: null, stream_usage: true, key: { configured: true, last4: '6789' } } },
      models: { mid: { provider: 'oai', model: 'gpt-4o', input_price: '2.5', cached_input_price: null, output_price: '10', usage_reported: true } },
      routes: { default: 'mid' },
    }
    expect(aiProviderCurrentSchema.safeParse({ setting }).success).toBe(true)
    expect(aiProviderCurrentSchema.safeParse({ setting: { ...setting, providers: { oai: { ...setting.providers.oai, key: { configured: true, last4: '6789', api_key: key } } } } }).success).toBe(false)
    expect(aiProviderCurrentSchema.safeParse({ setting: { ...setting, providers: { oai: { ...setting.providers.oai, api_key: key } } } }).success).toBe(false)
    expect(aiProviderCurrentSchema.safeParse({ setting: { ...setting, delivery: 'incomplete' } }).success).toBe(true)
    expect(aiProviderCurrentSchema.safeParse({ setting: null }).success).toBe(true)
  })

  it('answers a test either ok with a latency or failed with a stable code', () => {
    expect(aiProviderTestResultSchema.safeParse({ ok: true, latency_ms: 420, usage_reported: false }).success).toBe(true)
    expect(aiProviderTestResultSchema.safeParse({ ok: true, latency_ms: 420 }).success).toBe(false)  // whether tokens were counted is always stated
    expect(aiProviderTestResultSchema.safeParse({ ok: false, code: 'stream_usage_refused' }).success).toBe(true)
    expect(aiProviderTestResultSchema.safeParse({ ok: false, code: 'unauthorized' }).success).toBe(true)
    expect(aiProviderTestResultSchema.safeParse({ ok: false, code: 'The key sk-0123 was refused' }).success).toBe(false)
  })
})
