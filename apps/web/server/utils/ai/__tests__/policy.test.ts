import { beforeEach, describe, expect, it, vi } from 'vitest'

const serviceFetch = vi.fn()
vi.mock('../upstream', () => ({ serviceFetch }))

const OWNER = { tenant: 't1', user: '42' }
const PROVIDERS = [{ name: 'ollama', location: 'inside', needs_api_key: false }, { name: 'anthropic', location: 'outside', needs_api_key: true }]
const NO_KEY = { configured: false, provider: null, model: null, last4: null, updated_at: null }
const KEY = { configured: true, provider: 'anthropic', model: 'claude-test', last4: 'abcd', updated_at: '2026-11-05T10:00:00Z' }

function session(policy: Record<string, unknown>) {
  return { owner: OWNER, policy: { provider_mode: 'platform', outside_allowed: false, tokens_monthly: null, tokens_used: 0, output_tokens_per_run: 8000, ...policy } } as any
}
function serviceConfig(platform: string, key: object = NO_KEY) {
  const location = PROVIDERS.find(item => item.name === platform)!.location
  // A body is read once: each call gets its own response.
  serviceFetch.mockImplementation(async () => new Response(JSON.stringify({ retention_days: 30, key, platform: { provider: platform, model: 'm', location }, providers: PROVIDERS })))
}

beforeEach(() => {
  serviceFetch.mockReset()
  vi.stubGlobal('createError', (e: any) => Object.assign(new Error(e.data?.code ?? 'err'), e))
})

describe('the run policy sent to the AI service', () => {
  it('caps the output of platform runs only', async () => {
    const { runPolicy } = await import('../policy')
    expect(runPolicy(session({}))).toEqual({ provider_mode: 'platform', outside_allowed: false, max_output_tokens: 8000 })
    expect(runPolicy(session({ provider_mode: 'tenant_key' })).max_output_tokens).toBeNull()
  })
})

describe('assertRunnable', () => {
  it('asks nothing of the service once a platform run has consent', async () => {
    const { assertRunnable } = await import('../policy')
    await assertRunnable({} as any, session({ outside_allowed: true }))
    expect(serviceFetch).not.toHaveBeenCalled()
  })

  it('lets a provider inside the Kingdom run without consent', async () => {
    const { assertRunnable } = await import('../policy')
    serviceConfig('ollama')
    await expect(assertRunnable({} as any, session({}))).resolves.toBeUndefined()
  })

  it('refuses an outside provider without consent before anything is counted', async () => {
    const { assertRunnable } = await import('../policy')
    serviceConfig('anthropic')
    await expect(assertRunnable({} as any, session({}))).rejects.toMatchObject({ statusCode: 403, data: { code: 'ai_consent_required' } })
  })

  it('refuses a tenant-key policy without a key and judges a stored key by its own provider', async () => {
    const { assertRunnable } = await import('../policy')
    serviceConfig('ollama')
    await expect(assertRunnable({} as any, session({ provider_mode: 'tenant_key' }))).rejects.toMatchObject({ statusCode: 409, data: { code: 'ai_tenant_key_missing' } })
    serviceConfig('ollama', KEY)
    await expect(assertRunnable({} as any, session({ provider_mode: 'tenant_key' }))).rejects.toMatchObject({ statusCode: 403 })
    await expect(assertRunnable({} as any, session({ provider_mode: 'tenant_key', outside_allowed: true }))).resolves.toBeUndefined()
  })
})
