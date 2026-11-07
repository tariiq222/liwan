import { describe, expect, it, vi } from 'vitest'
import { createAiProvider } from '../useAiProvider'

function setup(answer: unknown = {}) {
  const request = vi.fn().mockResolvedValue(answer)
  return { request, api: createAiProvider(request) }
}

describe('AI provider calls', () => {
  it('reads the current choice and the presets', async () => {
    const { api, request } = setup()
    await api.current()
    await api.presets()
    expect(request).toHaveBeenNthCalledWith(1, 'platform/ai-provider')
    expect(request).toHaveBeenNthCalledWith(2, 'platform/ai-provider/presets')
  })

  it('posts the models and test calls and patches the save, with the key only in what is sent', async () => {
    const { api, request } = setup()
    await api.models({ preset: 'openai', api_key: 'sk-secret-123' })
    await api.test({ preset: 'ollama', base_url: 'http://ollama:11434', model: 'qwen2.5:7b' })
    await api.save({ preset: 'groq', model: 'llama-3.3-70b', reason: 'Cheaper', api_key: 'sk-secret-123' })
    expect(request).toHaveBeenNthCalledWith(1, 'platform/ai-provider/models', { method: 'POST', body: { preset: 'openai', api_key: 'sk-secret-123' } })
    expect(request).toHaveBeenNthCalledWith(2, 'platform/ai-provider/test', { method: 'POST', body: { preset: 'ollama', base_url: 'http://ollama:11434', model: 'qwen2.5:7b' } })
    expect(request).toHaveBeenNthCalledWith(3, 'platform/ai-provider', { method: 'PATCH', body: { preset: 'groq', model: 'llama-3.3-70b', reason: 'Cheaper', api_key: 'sk-secret-123' } })
  })
})
