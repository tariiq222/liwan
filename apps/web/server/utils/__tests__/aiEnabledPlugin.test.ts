import { afterEach, describe, expect, it, vi } from 'vitest'

/** Mirrors Nitro: the shared config is deep-frozen, every request gets its own mutable copy. */
async function request(aiServiceUrl: string, aiServiceToken: string) {
  const shared = Object.freeze({ aiServiceUrl, aiServiceToken, public: Object.freeze({ aiEnabled: false }) })
  const perRequest = { aiServiceUrl, aiServiceToken, public: { aiEnabled: false } }
  const event = { context: {} }
  vi.stubGlobal('useRuntimeConfig', (given?: unknown) => (given ? perRequest : shared))
  let onRequest: (event: unknown) => void = () => undefined
  vi.stubGlobal('defineNitroPlugin', (plugin: (app: unknown) => void) => plugin)
  const plugin = (await import('../../plugins/ai-enabled')).default as unknown as (app: unknown) => void
  plugin({ hooks: { hook: (name: string, handler: (event: unknown) => void) => { if (name === 'request') onRequest = handler } } })
  onRequest(event)
  return perRequest.public.aiEnabled
}

describe('ai-enabled Nitro plugin', () => {
  afterEach(() => { vi.unstubAllGlobals(); vi.resetModules() })
  it('enables /ai from the runtime aiServiceUrl and token of the request', async () => {
    expect(await request('http://127.0.0.1:4499', 't'.repeat(32))).toBe(true)
  })
  it('keeps /ai off without a runtime aiServiceUrl', async () => {
    expect(await request('', '')).toBe(false)
  })
  it('hides AI when the token is missing in production', async () => {
    const error = vi.spyOn(console, 'error').mockImplementation(() => undefined)
    expect(await request('http://ai:8600', '')).toBe(false)
    expect(error).toHaveBeenCalledWith('[liwan-ai] NUXT_AI_SERVICE_TOKEN is empty: /ai stays hidden')
    error.mockRestore()
  })
})
