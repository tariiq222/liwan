import { describe, expect, it } from 'vitest'
import { aiProviderCurrentSchema, aiProviderSaveSchema, aiProviderTestRequestSchema, aiProviderTestResultSchema } from '../index'

const key = 'sk-0123456789abcdef'

describe('AI provider panel contracts', () => {
  it('accepts a save with or without a new key and requires a reason', () => {
    expect(aiProviderSaveSchema.safeParse({ preset: 'deepseek', model: 'deepseek-chat', api_key: key, reason: 'Switch provider' }).success).toBe(true)
    expect(aiProviderSaveSchema.safeParse({ preset: 'ollama', model: 'qwen2.5:7b', base_url: 'http://ollama:11434', reason: 'Self-hosted' }).success).toBe(true)
    expect(aiProviderSaveSchema.safeParse({ preset: 'deepseek', model: 'm' }).success).toBe(false)
  })

  it('lets a test or a save state whether the stream is asked for token counts, as a boolean only', () => {
    expect(aiProviderSaveSchema.safeParse({ preset: 'custom', model: 'm', base_url: 'https://llm.example.com/v1', api_key: key, stream_usage: true, reason: 'Reports usage' }).success).toBe(true)
    expect(aiProviderTestRequestSchema.safeParse({ preset: 'custom', model: 'm', stream_usage: false }).success).toBe(true)
    expect(aiProviderTestRequestSchema.safeParse({ preset: 'custom', model: 'm', stream_usage: 'yes' }).success).toBe(false)
  })

  it('refuses fields it does not know, a key with whitespace, and a model with control characters', () => {
    expect(aiProviderSaveSchema.safeParse({ preset: 'openai', model: 'm', reason: 'Switch', provider: 'openai' }).success).toBe(false)
    expect(aiProviderTestRequestSchema.safeParse({ preset: 'openai', model: 'm', api_key: 'sk with space 12345' }).success).toBe(false)
    expect(aiProviderTestRequestSchema.safeParse({ preset: 'openai', model: 'a\nb' }).success).toBe(false)
  })

  it('never has a place for the key in a response', () => {
    const setting = { preset: 'openai', provider: 'openai', model: 'gpt-4o', base_url: null, stream_usage: true, key: { configured: true, last4: '6789' }, revision: 2, updated_at: '2026-11-06T10:00:00.000Z', updated_by: 'owner@liwan.example', delivery: 'delivered' }
    expect(aiProviderCurrentSchema.safeParse({ setting }).success).toBe(true)
    expect(aiProviderCurrentSchema.safeParse({ setting: { ...setting, key: { configured: true, last4: '6789', api_key: key } } }).success).toBe(false)
    expect(aiProviderCurrentSchema.safeParse({ setting: { ...setting, api_key: key } }).success).toBe(false)
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
