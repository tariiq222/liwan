import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { H3Event } from 'h3'
import type { AiTool } from '@liwan/contracts'
import { tokenKeyFrom } from '../outbound'

const HEADER = 'x-liwan-expected-company-id'
const tenantHeaders = vi.hoisted(() => vi.fn())
const transport = vi.hoisted(() => vi.fn())
vi.mock('../../tenantRequest', () => ({ tenantUpstreamHeaders: tenantHeaders, tenantRequest: () => null }))
vi.mock('../../tenantTransport', () => ({ tenantTransport: transport }))

const eventWith = (headers: Record<string, string> = {}) => ({ node: { req: { headers: { cookie: 'session_id=s1', ...headers } }, res: { once: () => undefined, writableEnded: false } }, context: {} }) as unknown as H3Event
const sentHeaders = () => Object.fromEntries(vi.mocked(fetch).mock.calls.map(([url, init]) => [String(url), (init as RequestInit).headers as Record<string, string>]))
const conflict = () => new Response(JSON.stringify({ code: 'request_context_changed', message: 'reload' }), { status: 409 })

beforeEach(() => {
  tenantHeaders.mockReset().mockReturnValue({})
  transport.mockReset().mockResolvedValue(new Response('{}', { status: 200 }))
  vi.stubGlobal('useRuntimeConfig', () => ({ odooUrl: 'http://odoo.test', odooDb: '' }))
  vi.stubGlobal('createError', (e: any) => Object.assign(new Error(e.data?.code ?? 'err'), e))
  vi.stubGlobal('fetch', vi.fn(async () => new Response('{}', { status: 200 })))
})
afterEach(() => vi.unstubAllGlobals())

describe('odooJson states the tab\'s company', () => {
  it('forwards the header on a direct call, on reads and on writes', async () => {
    const { odooJson } = await import('../upstream')
    const event = eventWith({ [HEADER]: '7' })
    await odooJson(event, 'GET', '/api/v1/me')
    await odooJson(event, 'POST', '/api/v1/ai/audit', { body: {} })
    expect(Object.values(sentHeaders()).map(headers => headers[HEADER])).toEqual(['7', '7'])
  })
  it('forwards it to the tenant transport too', async () => {
    tenantHeaders.mockReturnValue({ host: 'a.example.test' })
    const { odooJson } = await import('../upstream')
    await odooJson(eventWith({ [HEADER]: '7' }), 'GET', '/api/v1/me')
    expect(transport.mock.calls[0]![3]).toMatchObject({ headers: { [HEADER]: '7' }, expectedContext: true })
  })
  it('sends nothing when the request stated no company', async () => {
    const { odooJson } = await import('../upstream')
    await odooJson(eventWith(), 'GET', '/api/v1/me')
    expect(Object.values(sentHeaders())[0]).not.toHaveProperty(HEADER)
  })
  it('leaves it out of a call that opts out (the usage report)', async () => {
    tenantHeaders.mockReturnValue({ host: 'a.example.test' })
    const { odooJson } = await import('../upstream')
    const event = eventWith({ [HEADER]: '7' })
    await odooJson(event, 'POST', '/api/v1/ai/usage', { body: {}, statesCompany: false })
    expect(transport.mock.calls[0]![3].headers).not.toHaveProperty(HEADER)
    expect(transport.mock.calls[0]![3]).toMatchObject({ expectedContext: false })
    tenantHeaders.mockReturnValue({})
    await odooJson(event, 'POST', '/api/v1/ai/usage', { body: {}, statesCompany: false })
    expect(Object.values(sentHeaders())[0]).not.toHaveProperty(HEADER)
  })
  it('never lets the service-key recorder carry it', async () => {
    const { odooServiceUsageJson } = await import('../upstream')
    await odooServiceUsageJson(eventWith({ [HEADER]: '7' }), 'k', { items: [] })
    expect(Object.values(sentHeaders())[0]).not.toHaveProperty(HEADER)
  })
})

describe('a company switched mid-run', () => {
  const tool: AiTool = {
    name: 'core.list_things', kind: 'read', description: { ar: 'م', en: 'm' }, input_schema: { type: 'object' },
    route: { method: 'GET', path: '/api/v1/things' }, input_map: {}, result_summary: ['total'], draft_target: null, draft_model: null, requires_approval: false, platform: false,
  }
  const session = { byName: new Map([[tool.name, tool]]), blockedFields: new Set<string>(), tokenKey: tokenKeyFrom('secret', { tenant: 't', user: '1' }) } as never
  const call = { call_id: 'c1', tool: tool.name, agent: 'core', input: {} }

  it('states the company on the tool call and on its audit row', async () => {
    const { executeTool } = await import('../pump')
    await executeTool(eventWith({ [HEADER]: '7' }), session, 'r_1', 'read', call)
    expect(vi.mocked(fetch).mock.calls.map(([url, init]) => [String(url), ((init as RequestInit).headers as Record<string, string>)[HEADER]]))
      .toEqual([['http://odoo.test/api/v1/things', '7'], ['http://odoo.test/api/v1/ai/audit', '7']])
  })
  it('stops the tool with Odoo\'s refusal and never reports it as success', async () => {
    vi.mocked(fetch).mockImplementation(async () => conflict())
    const { executeTool } = await import('../pump')
    const onAuditFailed = vi.fn()
    const result = await executeTool(eventWith({ [HEADER]: '7' }), session, 'r_1', 'read', call, { onAuditFailed })
    expect(result).toMatchObject({ ok: false, error: { code: 'request_context_changed' } })
    expect(onAuditFailed).toHaveBeenCalled()
  })
  it('forwards a refused /api/v1/me to the browser as 409 request_context_changed', async () => {
    vi.mocked(fetch).mockImplementation(async () => conflict())
    const { runSession } = await import('../session')
    await expect(runSession(eventWith({ [HEADER]: '3' }))).rejects.toMatchObject({ statusCode: 409, data: { code: 'request_context_changed' } })
  })
  it('runs as before for a request without the header', async () => {
    const { executeTool } = await import('../pump')
    const result = await executeTool(eventWith(), session, 'r_1', 'read', call)
    expect(result.ok).toBe(true)
    for (const headers of Object.values(sentHeaders())) expect(headers).not.toHaveProperty(HEADER)
  })
})
