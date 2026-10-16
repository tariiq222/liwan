import { afterEach, describe, expect, it, vi } from 'vitest'

/** Mirrors Nitro: the shared config is deep-frozen, every request gets its own mutable copy. */
async function request(aiServiceUrl: string) {
  const shared = Object.freeze({ aiServiceUrl, public: Object.freeze({ aiEnabled: false }) })
  const perRequest = { aiServiceUrl, public: { aiEnabled: false } }
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
  it('enables /ai from the runtime aiServiceUrl of the request', async () => {
    expect(await request('http://127.0.0.1:4499')).toBe(true)
  })
  it('keeps /ai off without a runtime aiServiceUrl', async () => {
    expect(await request('')).toBe(false)
  })
})
