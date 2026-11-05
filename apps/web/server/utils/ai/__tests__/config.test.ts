import { beforeEach, describe, expect, it, vi } from 'vitest'

const odooJson = vi.fn()
const serviceFetch = vi.fn()
vi.mock('../upstream', () => ({ odooJson, serviceFetch, forwardUpstream: (u: any) => { throw Object.assign(new Error('forwarded'), { statusCode: u.status }) } }))
vi.mock('../session', () => ({ ownerFor: async () => ({ tenant: 't1', user: '42' }) }))

const TENANT_KEY = 'sk-tenant-0123456789abcd'
const CONFIG = {
  retention_days: 30, leaver_retention_days: 30, key: { configured: true, provider: 'anthropic', model: 'claude-test', last4: 'abcd', updated_at: '2026-11-05T10:00:00Z' },
  platform: { provider: 'ollama', model: 'm', location: 'inside' }, providers: [],
}

beforeEach(() => {
  odooJson.mockReset(); serviceFetch.mockReset()
  vi.stubGlobal('createError', (e: any) => Object.assign(new Error(e.data?.code ?? 'err'), e))
})

describe('tenantConfig', () => {
  it('refuses a caller without ai.settings.manage before the service is reached', async () => {
    const { tenantConfig } = await import('../config')
    odooJson.mockResolvedValue({ status: 403, body: { code: 'forbidden' } })
    await expect(tenantConfig({} as any, 'PUT', '/v1/tenant/config/key', { api_key: TENANT_KEY })).rejects.toMatchObject({ statusCode: 403 })
    expect(serviceFetch).not.toHaveBeenCalled()
  })

  it('sends the key to the service only and returns the parsed configuration without it', async () => {
    const { tenantConfig } = await import('../config')
    odooJson.mockResolvedValue({ status: 200, body: {} })
    serviceFetch.mockResolvedValue(new Response(JSON.stringify(CONFIG)))
    const body = { provider: 'anthropic', model: 'claude-test', api_key: TENANT_KEY }
    const config = await tenantConfig({} as any, 'PUT', '/v1/tenant/config/key', body)
    expect(serviceFetch).toHaveBeenCalledWith({}, 'PUT', '/v1/tenant/config/key', { tenant: 't1', user: '42' }, body)
    expect(JSON.stringify(config)).not.toContain(TENANT_KEY)
    expect(odooJson).toHaveBeenCalledWith({}, 'POST', '/api/v1/ai/config/authorize', { body: {} })
  })

  it('authorizes a read with the settings read only', async () => {
    const { tenantConfig } = await import('../config')
    odooJson.mockResolvedValue({ status: 200, body: {} })
    serviceFetch.mockResolvedValue(new Response(JSON.stringify(CONFIG)))
    await tenantConfig({} as any, 'GET', '/v1/tenant/config')
    expect(odooJson).toHaveBeenCalledWith({}, 'GET', '/api/v1/ai/settings')
  })

  it('names a missing keyring and hides other service failures', async () => {
    const { tenantConfig } = await import('../config')
    odooJson.mockResolvedValue({ status: 200, body: {} })
    serviceFetch.mockResolvedValue(new Response(JSON.stringify({ detail: 'ai_key_unavailable' }), { status: 503 }))
    await expect(tenantConfig({} as any, 'GET', '/v1/tenant/config')).rejects.toMatchObject({ statusCode: 503, data: { code: 'ai_key_unavailable' } })
    serviceFetch.mockResolvedValue(new Response('{}', { status: 500 }))
    await expect(tenantConfig({} as any, 'GET', '/v1/tenant/config')).rejects.toMatchObject({ statusCode: 502 })
  })
})
