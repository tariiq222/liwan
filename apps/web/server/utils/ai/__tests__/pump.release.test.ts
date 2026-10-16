import { afterEach, expect, it, vi } from 'vitest'
import type { AiTool } from '@webvue/contracts'
import { executeTool } from '../pump'
import type { RunSession } from '../session'

vi.mock('../../tenantRequest', () => ({ tenantUpstreamHeaders: () => ({ host: 'a.example.test' }) }))
vi.mock('../../tenantTransport', () => ({
  tenantTransport: async (_event: unknown, _url: string, path: string) => {
    if (path === '/api/v1/tasks/7/transition') return new Response('{"id":7,"state":"done"}', { status: 200 })
    throw new Error('unexpected Odoo dispatch')
  },
}))

afterEach(() => { vi.unstubAllEnvs(); vi.unstubAllGlobals(); vi.restoreAllMocks() })

it('keeps a successful claimed effect when a later drain refuses its audit, without turning it into a rejection', async () => {
  vi.stubEnv('WEBVUE_RELEASE_ROUTES_DIR', '/trusted/routes')
  vi.stubGlobal('useRuntimeConfig', () => ({ odooUrl: 'http://odoo.test' }))
  vi.spyOn(console, 'error').mockImplementation(() => undefined)
  let permits = 0
  const event = {
    node: { req: { headers: { cookie: 'session_id=s1' } }, res: { once: () => undefined } },
    context: {
      webvueRelease: { releaseId: 'r1', poolId: 'blue', routeRevision: 3, fence: 8, aiUrl: 'http://ai-blue.test', aiStateVersion: '1' },
      webvueReleaseWritePermit: async <T>(action: () => Promise<T>): Promise<T> => {
        if (++permits > 1) throw new Error('generation drained before audit')
        return action()
      },
    },
  }
  const tool: AiTool = {
    name: 'pmo.update_task_state', kind: 'write_light', description: { ar: 'حالة', en: 'state' }, input_schema: { type: 'object' },
    route: { method: 'POST', path: '/api/v1/tasks/{task_id}/transition' },
    input_map: { path: { task_id: '$task_id' }, body: { state: '$state' } }, result_summary: ['id', 'state'], draft_target: null,
  }
  const session = { byName: new Map([[tool.name, tool]]) } as RunSession
  let auditFailed = false
  const result = await executeTool(event as never, session, 'r_1', 'write_light', { call_id: 'c_1', tool: tool.name, input: { task_id: 7, state: 'done' } }, {
    signal: null, onAuditFailed: () => { auditFailed = true },
  })
  expect(result).toEqual({ ok: true, data: { id: 7, state: 'done' } })
  expect(auditFailed).toBe(true)
})
