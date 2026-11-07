import { beforeEach, describe, expect, it, vi } from 'vitest'

const serviceFetch = vi.fn()
vi.mock('../upstream', () => ({ serviceFetch }))

const OWNER = { tenant: 't1', user: '42' }
const PROVIDERS = [{ name: 'ollama', needs_api_key: false, needs_base_url: false }, { name: 'anthropic', needs_api_key: true, needs_base_url: false }]
const NO_KEY = { configured: false, provider: null, model: null, last4: null, updated_at: null, base_url: null }
const KEY = { configured: true, provider: 'anthropic', model: 'claude-test', last4: 'abcd', updated_at: '2026-11-05T10:00:00Z', base_url: null }

function session(policy: Record<string, unknown>, mode: 'assistant' | 'setup' | 'help' = 'assistant') {
  return { owner: OWNER, mode, policy: { provider_mode: 'platform', consent_signed: true, tokens_monthly: null, tokens_used: 0, output_tokens_per_run: 8000, ...policy } } as any
}
function serviceConfig(key: object) {
  // A body is read once: each call gets its own response.
  serviceFetch.mockImplementation(async () => new Response(JSON.stringify({ retention_days: 30, leaver_retention_days: 30, key, platform: { provider: 'ollama', model: 'm' }, providers: PROVIDERS })))
}

beforeEach(() => {
  serviceFetch.mockReset()
  vi.stubGlobal('createError', (e: any) => Object.assign(new Error(e.data?.code ?? 'err'), e))
})

describe('the run policy sent to the AI service', () => {
  it('carries the acknowledgement and caps the output of platform runs only', async () => {
    const { runPolicy } = await import('../policy')
    expect(runPolicy(session({}))).toEqual({ provider_mode: 'platform', consent_signed: true, max_output_tokens: 8000 })
    expect(runPolicy(session({ provider_mode: 'tenant_key' })).max_output_tokens).toBeNull()
    // The free agents run on the platform provider whatever the tenant's own key.
    for (const mode of ['setup', 'help'] as const) expect(runPolicy(session({ provider_mode: 'tenant_key' }, mode))).toEqual({ provider_mode: 'setup', consent_signed: true, max_output_tokens: 8000 })
  })
})

describe('assertRunnable', () => {
  it('asks nothing of the service for a signed platform or setup run', async () => {
    const { assertRunnable } = await import('../policy')
    await assertRunnable({} as any, session({}))
    await assertRunnable({} as any, session({ provider_mode: 'tenant_key' }, 'setup'))
    await assertRunnable({} as any, session({ provider_mode: 'tenant_key' }, 'help'))
    expect(serviceFetch).not.toHaveBeenCalled()
  })

  it('refuses every mode without the signed acknowledgement, before anything is counted', async () => {
    const { assertRunnable } = await import('../policy')
    for (const [policy, mode] of [[{}, 'assistant'], [{ provider_mode: 'tenant_key' }, 'assistant'], [{}, 'setup'], [{}, 'help']] as const) {
      await expect(assertRunnable({} as any, session({ ...policy, consent_signed: false }, mode))).rejects.toMatchObject({ statusCode: 403, data: { code: 'ai_consent_required' } })
    }
    expect(serviceFetch).not.toHaveBeenCalled()
  })

  it('refuses a tenant-key policy without a key and lets a stored key run', async () => {
    const { assertRunnable } = await import('../policy')
    serviceConfig(NO_KEY)
    await expect(assertRunnable({} as any, session({ provider_mode: 'tenant_key' }))).rejects.toMatchObject({ statusCode: 409, data: { code: 'ai_tenant_key_missing' } })
    serviceConfig(KEY)
    await expect(assertRunnable({} as any, session({ provider_mode: 'tenant_key' }))).resolves.toBeUndefined()
  })
})
