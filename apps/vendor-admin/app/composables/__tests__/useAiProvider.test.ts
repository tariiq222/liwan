import { describe, expect, it, vi } from 'vitest'
import { aiProviderModelsRequestSchema, aiProviderSaveSchema, aiProviderTestRequestSchema } from '@liwan/commercial-contracts'
import { createAiProvider } from '../useAiProvider'

function setup(answer: unknown = {}) {
  const request = vi.fn().mockResolvedValue(answer)
  return { request, api: createAiProvider(request) }
}

describe('AI provider calls', () => {
  it('reads the current configuration and the presets', async () => {
    const { api, request } = setup()
    await api.current()
    await api.presets()
    expect(request).toHaveBeenNthCalledWith(1, 'platform/ai-provider')
    expect(request).toHaveBeenNthCalledWith(2, 'platform/ai-provider/presets')
  })

  it('lists and tests by saved provider id, sending no key, and the bodies pass the control plane schemas', async () => {
    const { api, request } = setup()
    await api.models('oai')
    await api.test('oai', 'gpt-4o')
    const [models, test] = request.mock.calls.map(call => call[1] as { method: string, body: unknown })
    expect(request).toHaveBeenNthCalledWith(1, 'platform/ai-provider/models', { method: 'POST', body: { provider: 'oai' } })
    expect(request).toHaveBeenNthCalledWith(2, 'platform/ai-provider/test', { method: 'POST', body: { provider: 'oai', model: 'gpt-4o' } })
    expect(aiProviderModelsRequestSchema.safeParse(models!.body).success).toBe(true)
    expect(aiProviderTestRequestSchema.safeParse(test!.body).success).toBe(true)
  })

  it('patches the whole configuration in one call', async () => {
    const { api, request } = setup()
    const body = { margin_bps: 2000, providers: { oai: { preset: 'openai', api_key: 'sk-secret-123' } }, models: {}, routes: {}, reason: 'Set up' }
    await api.save(body)
    expect(request).toHaveBeenCalledWith('platform/ai-provider', { method: 'PATCH', body })
    expect(aiProviderSaveSchema.safeParse(body).success).toBe(true)
  })
})
