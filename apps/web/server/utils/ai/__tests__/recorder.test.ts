import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { H3Event } from 'h3'

const probe = vi.hoisted(() => vi.fn())
const tenant = vi.hoisted(() => vi.fn())
vi.mock('../upstream', () => ({ odooServiceUsageJson: probe, logFailure: (what: string, error: unknown) => console.error(`[liwan-ai] ${what}: ${(error as object).constructor.name}`) }))
vi.mock('../../tenantRequest', () => ({ tenantRequest: tenant }))

const ROOT = Array.from({ length: 32 }, (_, index) => index.toString(16).padStart(2, '0')).join('')
const event = {} as H3Event
const NOW = new Date('2026-11-23T09:00:00.000Z')
const advance = (ms: number) => vi.setSystemTime(new Date(Date.now() + ms))
let database = 0
/** Each test works in its own database, because the recorder state is kept per tenant for the life of the process. */
const freshDatabase = () => `liwan_test_${++database}`

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date'] })
  vi.setSystemTime(NOW)
  probe.mockReset().mockResolvedValue({ status: 200, body: { items: [], total: 0 } })
  tenant.mockReset().mockReturnValue(null)
  vi.stubEnv('LIWAN_AI_USAGE_KEY', ROOT)
  vi.stubEnv('LIWAN_TENANCY_MODE', 'dedicated')
  vi.stubEnv('NUXT_ODOO_DB', freshDatabase())
  vi.spyOn(console, 'error').mockImplementation(() => undefined)
})
afterEach(() => { vi.useRealTimers(); vi.restoreAllMocks(); vi.unstubAllEnvs() })

describe('the derived bearer', () => {
  it('matches the fixed vector Odoo checks too (root bytes 0x00..0x1f)', async () => {
    const { usageBearer } = await import('../recorder')
    expect(usageBearer(ROOT, 'liwan_vector_db')).toBe('d0e9be6ebd73f6029db8709fa445f5051521423db46675b15ff528dd0182cdaf')
  })

  it('differs per database, so a bearer made for one tenant is refused by every other', async () => {
    const { usageBearer } = await import('../recorder')
    expect(usageBearer(ROOT, 'liwan_a')).not.toBe(usageBearer(ROOT, 'liwan_b'))
    expect(usageBearer(ROOT, 'liwan_a')).toMatch(/^[0-9a-f]{64}$/)
  })
})

describe('usageRecorder', () => {
  it('takes the database from NUXT_ODOO_DB in a dedicated deployment', async () => {
    const { usageRecorder, usageBearer } = await import('../recorder')
    vi.stubEnv('NUXT_ODOO_DB', 'liwan_dedicated')
    expect(usageRecorder(event)).toEqual({ tenant: 'liwan_dedicated', bearer: usageBearer(ROOT, 'liwan_dedicated') })
  })

  it('takes the database from the verified tenant binding in a shared deployment, never from NUXT_ODOO_DB', async () => {
    const { usageRecorder, usageBearer } = await import('../recorder')
    vi.stubEnv('LIWAN_TENANCY_MODE', 'shared')
    tenant.mockReturnValue({ database: 'liwan_tenant_one' })
    expect(usageRecorder(event)).toEqual({ tenant: 'liwan_tenant_one', bearer: usageBearer(ROOT, 'liwan_tenant_one') })
  })

  it.each([['a missing root', ''], ['a short root', 'ab'.repeat(31)], ['a non-hex root', 'zz'.repeat(32)], ['a long root', 'ab'.repeat(33)]])('is unavailable with %s', async (_label, root) => {
    const { usageRecorder } = await import('../recorder')
    vi.stubEnv('LIWAN_AI_USAGE_KEY', root)
    expect(() => usageRecorder(event)).toThrow()
  })

  it('is unavailable with no database', async () => {
    const { usageRecorder } = await import('../recorder')
    vi.stubEnv('NUXT_ODOO_DB', '')
    expect(() => usageRecorder(event)).toThrow()
  })
})

describe('assertUsageRecordable', () => {
  it('probes with no items and the tenant bearer, then holds healthy for ten minutes', async () => {
    const { assertUsageRecordable, usageBearer } = await import('../recorder')
    expect(await assertUsageRecordable(event)).toBe(false)
    expect(probe).toHaveBeenCalledTimes(1)
    expect(probe).toHaveBeenCalledWith(event, usageBearer(ROOT, process.env.NUXT_ODOO_DB!), { items: [] })
    advance(9 * 60 * 1000)
    await assertUsageRecordable(event)
    expect(probe).toHaveBeenCalledTimes(1)
    advance(2 * 60 * 1000)
    await assertUsageRecordable(event)
    expect(probe).toHaveBeenCalledTimes(2)
  })

  it.each([
    ['a missing root', () => vi.stubEnv('LIWAN_AI_USAGE_KEY', '')],
    ['a malformed root', () => vi.stubEnv('LIWAN_AI_USAGE_KEY', 'nope')],
    ['no database', () => vi.stubEnv('NUXT_ODOO_DB', '')],
  ])('refuses with 503 ai_unavailable on %s, without asking Odoo', async (_label, break_) => {
    const { assertUsageRecordable } = await import('../recorder')
    break_()
    await expect(assertUsageRecordable(event)).rejects.toMatchObject({ statusCode: 503, data: { code: 'ai_unavailable' } })
    expect(probe).not.toHaveBeenCalled()
  })

  it.each([[401], [403], [500]])('refuses with 503 ai_unavailable when the probe answers %i, and asks again only after fifteen seconds', async (status) => {
    const { assertUsageRecordable } = await import('../recorder')
    probe.mockResolvedValue({ status, body: {} })
    await expect(assertUsageRecordable(event)).rejects.toMatchObject({ statusCode: 503, data: { code: 'ai_unavailable' } })
    advance(14 * 1000)
    await expect(assertUsageRecordable(event)).rejects.toMatchObject({ statusCode: 503 })
    expect(probe).toHaveBeenCalledTimes(1)
    advance(2 * 1000)
    await expect(assertUsageRecordable(event)).rejects.toMatchObject({ statusCode: 503 })
    expect(probe).toHaveBeenCalledTimes(2)
  })

  it('treats an unreachable Odoo as a refused probe and logs only the class', async () => {
    const { assertUsageRecordable } = await import('../recorder')
    probe.mockRejectedValue(new TypeError('secret detail'))
    await expect(assertUsageRecordable(event)).rejects.toMatchObject({ statusCode: 503, data: { code: 'ai_unavailable' } })
    expect(JSON.stringify(vi.mocked(console.error).mock.calls)).not.toContain('secret detail')
  })

  it('flips a healthy tenant to refused at once on a 401 or 403 of a real report, and reports the recovery once', async () => {
    const { assertUsageRecordable, markUsageRefused } = await import('../recorder')
    await assertUsageRecordable(event)
    markUsageRefused(process.env.NUXT_ODOO_DB!)
    await expect(assertUsageRecordable(event)).rejects.toMatchObject({ statusCode: 503 })
    expect(probe).toHaveBeenCalledTimes(1)
    advance(16 * 1000)
    expect(await assertUsageRecordable(event)).toBe(true)
    expect(await assertUsageRecordable(event)).toBe(false)
  })

  it('keeps the state per tenant: one tenant refused never refuses another', async () => {
    const { assertUsageRecordable } = await import('../recorder')
    vi.stubEnv('LIWAN_TENANCY_MODE', 'shared')
    tenant.mockReturnValue({ database: 'liwan_bad' })
    probe.mockResolvedValueOnce({ status: 401, body: {} })
    await expect(assertUsageRecordable(event)).rejects.toMatchObject({ statusCode: 503 })
    tenant.mockReturnValue({ database: 'liwan_good' })
    expect(await assertUsageRecordable(event)).toBe(false)
  })
})
