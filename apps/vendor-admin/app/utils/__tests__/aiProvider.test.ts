import { describe, expect, it } from 'vitest'
import type { AiProviderCurrent, AiProviderPreset } from '@liwan/commercial-contracts'
import { StepUpCancelled } from '../../composables/useStepUp'
import { aiProviderErrorKey, draftComplete, probeFields, storedKeyApplies, testSignature } from '../aiProvider'

const fixed: AiProviderPreset = { id: 'deepseek', label: 'DeepSeek', provider: 'openai_compatible', base_url: 'https://llm.example.com/v1', needs_base_url: false, needs_api_key: true, stream_usage: true, stream_usage_editable: false }
const ollama: AiProviderPreset = { id: 'ollama', label: 'Ollama', provider: 'ollama', base_url: null, needs_base_url: true, needs_api_key: false, stream_usage: false, stream_usage_editable: false }
const custom: AiProviderPreset = { id: 'custom', label: 'Custom', provider: 'openai_compatible', base_url: null, needs_base_url: true, needs_api_key: true, stream_usage: false, stream_usage_editable: true }
const draft = (over: Partial<Parameters<typeof probeFields>[0]> = {}) => ({ preset: 'deepseek', base_url: '', api_key: '', model: '', stream_usage: true, ...over })
const saved = (over: Partial<NonNullable<AiProviderCurrent['setting']>> = {}): NonNullable<AiProviderCurrent['setting']> => ({
  preset: 'deepseek', provider: 'openai_compatible', model: 'deepseek-chat', base_url: 'https://llm.example.com/v1', stream_usage: true, key: { configured: true, last4: '6789' },
  revision: 2, updated_at: '2026-11-06T10:00:00.000Z', updated_by: 'account:7', delivery: 'delivered', ...over,
})

describe('probe fields', () => {
  it('sends the endpoint only for a preset that takes one and the key only when typed', () => {
    expect(probeFields(draft({ base_url: 'https://x.example/v1', api_key: ' sk-123 ' }), fixed)).toEqual({ preset: 'deepseek', api_key: 'sk-123' })
    expect(probeFields(draft({ preset: 'ollama', base_url: ' http://ollama:11434 ', api_key: 'ignored' }), ollama)).toEqual({ preset: 'ollama', base_url: 'http://ollama:11434' })
    expect(probeFields(draft({ preset: 'custom', base_url: 'https://llm.example.com/v1' }), custom)).toEqual({ preset: 'custom', base_url: 'https://llm.example.com/v1', stream_usage: true })
  })
  it('sends the token-count option only where the vendor may choose it', () => {
    expect(probeFields(draft({ stream_usage: false }), fixed)).not.toHaveProperty('stream_usage')
    expect(probeFields(draft({ preset: 'custom', base_url: 'https://x.example/v1', stream_usage: false }), custom)).toMatchObject({ stream_usage: false })
  })
})

describe('stored key and completeness', () => {
  it('uses the saved key only for the same preset, and for a free endpoint only the same one', () => {
    expect(storedKeyApplies(saved(), draft(), fixed)).toBe(true)
    expect(storedKeyApplies(saved(), draft({ preset: 'custom' }), custom)).toBe(false)
    expect(storedKeyApplies(saved({ preset: 'custom', base_url: 'https://llm.example.com/v1' }), draft({ preset: 'custom', base_url: 'https://llm.example.com/v1/' }), custom)).toBe(true)
    expect(storedKeyApplies(saved({ preset: 'custom', base_url: 'https://llm.example.com/v1' }), draft({ preset: 'custom', base_url: 'https://other.example.com/v1' }), custom)).toBe(false)
    expect(storedKeyApplies(saved({ key: { configured: false, last4: null } }), draft(), fixed)).toBe(false)
    expect(storedKeyApplies(null, draft(), fixed)).toBe(false)
  })
  it('needs a preset, a model, the endpoint when asked for one and a key typed or stored when the preset takes one', () => {
    expect(draftComplete(draft({ model: 'm' }), fixed, false)).toBe(false)
    expect(draftComplete(draft({ model: 'm', api_key: 'sk-1' }), fixed, false)).toBe(true)
    expect(draftComplete(draft({ model: 'm' }), fixed, true)).toBe(true)
    expect(draftComplete(draft({ api_key: 'sk-1' }), fixed, false)).toBe(false)
    expect(draftComplete(draft({ preset: 'ollama', model: 'm' }), ollama, false)).toBe(false)
    expect(draftComplete(draft({ preset: 'ollama', model: 'm', base_url: 'http://o:1' }), ollama, false)).toBe(true)
    expect(draftComplete(draft({ model: 'm' }), undefined, false)).toBe(false)
  })
  it('makes a passed test valid only for the values it ran with', () => {
    const base = draft({ model: 'm', api_key: 'sk-1' })
    expect(testSignature(base)).toBe(testSignature({ ...base }))
    for (const change of [{ preset: 'groq' }, { base_url: 'http://x' }, { api_key: 'sk-2' }, { model: 'n' }, { stream_usage: false }]) expect(testSignature({ ...base, ...change })).not.toBe(testSignature(base))
  })
})

describe('error messages', () => {
  const failed = (data: object, statusCode = 422) => ({ statusCode, data })
  it('maps the control plane codes to their message and anything else to a generic one', () => {
    expect(aiProviderErrorKey(failed({ code: 'api_key_required' }))).toBe('aiProvider.errors.api_key_required')
    expect(aiProviderErrorKey(failed({ code: 'invalid_stream_usage' }))).toBe('aiProvider.errors.invalid_stream_usage')
    expect(aiProviderErrorKey(failed({ code: 'provider_unauthorized' }))).toBe('aiProvider.errors.provider_unauthorized')
    expect(aiProviderErrorKey(failed({ code: 'provider_file_unavailable' }, 503))).toBe('aiProvider.errors.provider_file_unavailable')
    expect(aiProviderErrorKey(failed({ code: 'surprise' }, 503))).toBe('aiProvider.errors.unavailable')
    expect(aiProviderErrorKey(failed({ code: 'surprise' }, 500))).toBe('aiProvider.errors.generic')
    expect(aiProviderErrorKey(new StepUpCancelled())).toBe('aiProvider.errors.stepUpCancelled')
    expect(aiProviderErrorKey(null)).toBe('aiProvider.errors.generic')
  })
})
