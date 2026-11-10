import { beforeEach, describe, expect, it, vi } from 'vitest'

const tenantRequest = vi.fn()
const odooJson = vi.fn()
vi.mock('../../tenantRequest', () => ({ tenantRequest, tenantUpstreamHeaders: () => ({}) }))
vi.mock('../upstream', () => ({ odooJson, forwardUpstream: (u: any) => { throw Object.assign(new Error('forwarded'), { statusCode: u.status }) } }))

const TOOLS = { items: [], total: 0, agents: [], limits: { tool_calls_per_run: null, messages_monthly: null, messages_used: 0, assist_monthly: null, assist_used: 0, policy: { provider_mode: 'platform', consent_signed: true, balance_granted: null, balance_left: null, allowance: null, allowance_left: null, allowance_resets_at: null, blocked: null, blocked_resets_at: null, spend_ceiling: null, spend_this_month: null, output_tokens_per_run: 8000, input_tokens_per_run: 100000 } }, blocked_fields: [] }
let config: Record<string, unknown>

beforeEach(() => {
  tenantRequest.mockReset(); odooJson.mockReset()
  config = { odooDb: '' }
  vi.stubGlobal('useRuntimeConfig', () => config)
  vi.stubGlobal('createError', (e: any) => Object.assign(new Error(e.data?.code ?? 'err'), e))
  odooJson.mockImplementation(async (_e: unknown, _m: string, path: string) => path === '/api/v1/me' ? { status: 200, body: { id: 42, company: { id: 7 } } } : { status: 200, body: TOOLS })
  delete process.env.LIWAN_TENANCY_MODE
})

async function owner() {
  const { runSession } = await import('../session')
  return (await runSession({} as any)).owner
}

describe('runSession tenant identity', () => {
  it('uses the tenant resolved by the shared edge before odooDb', async () => {
    process.env.LIWAN_TENANCY_MODE = 'shared'
    tenantRequest.mockReturnValue({ tenantId: 'acme', database: 'acme_db', registryRevision: 3, host: 'acme.liwan.test' })
    config = { odooDb: 'ignored' }
    expect(await owner()).toEqual({ tenant: 'acme', user: '42' })
  })
  it('uses odooDb in the dedicated lane', async () => {
    tenantRequest.mockReturnValue(null)
    config = { odooDb: 'odoo19' }
    expect(await owner()).toEqual({ tenant: 'odoo19', user: '42' })
  })
  it('falls back to the company id only in dedicated mode', async () => {
    tenantRequest.mockReturnValue(null)
    expect(await owner()).toEqual({ tenant: 'company:7', user: '42' })
  })
  it('refuses with 403 in shared mode when no tenant was resolved', async () => {
    process.env.LIWAN_TENANCY_MODE = 'shared'
    tenantRequest.mockReturnValue(null)
    await expect(owner()).rejects.toMatchObject({ statusCode: 403 })
  })
  it('does not swallow the shared-edge rejection', async () => {
    process.env.LIWAN_TENANCY_MODE = 'shared'
    tenantRequest.mockImplementation(() => { throw Object.assign(new Error('tenant_boundary_rejected'), { statusCode: 403 }) })
    await expect(owner()).rejects.toMatchObject({ statusCode: 403 })
  })
})

describe('modeForAgent', () => {
  it('names the free agents and leaves every other agent, including a platform tool\'s, to the ordinary conversation', async () => {
    const { modeForAgent } = await import('../session')
    expect([modeForAgent('ai'), modeForAgent('ai_help'), modeForAgent('pmo'), modeForAgent('core')]).toEqual(['setup', 'help', 'assistant', 'assistant'])
  })
})
