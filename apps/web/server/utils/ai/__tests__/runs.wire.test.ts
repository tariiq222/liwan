import http from 'node:http'
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { appendResponseHeader, createApp, createError, createEventStream, defineEventHandler, getCookie, getHeader, getQuery, getRequestHeader, getRouterParam, readBody, setResponseHeader, toNodeListener } from 'h3'

let odoo: http.Server, service: http.Server, app: http.Server
let odooUrl: string, serviceUrl: string, url: string
let odooCalls: { method: string; url: string; cookie?: string; body?: string }[] = []
let serviceCalls: { method: string; url: string; headers: http.IncomingHttpHeaders; body: string; at: number }[] = []
let scenario: 'read' | 'draft' | 'limit' | 'unknown' | 'draft_as_read' | 'write_light' | 'bogus_draft' | 'draft_wrong_kind' | 'abort' | 'read_slow_done' | 'error_only' = 'read'
let pending: Record<string, unknown> | null = null
let odooToolsStatus = 200
let deadServiceUrl = ''
let serviceDown = false
let serviceToken = ''
let claimMode: 'atomic' | 'conflict' = 'atomic'
let claimed = false
let doneSentAt = 0
let odooMode: 'normal' | 'destroy_writes' | 'hang_writes' | 'destroy_reads' = 'normal'
let auditFailKind: string | null = null
let runStatus = 'waiting_user'
let resumeMode: 'ok' | 'http500' | 'destroy' | 'slow' = 'ok'
let resumeStreamFinished = false
let resumeStreamCancelled = false
const RUN_LIST = { items: [{ run_id: 'r_1', title: 'هلا', status: 'done', updated_at: '2026-10-16T10:00:00.123456Z', archived: false }], total: 1 }
let runList: unknown = RUN_LIST
let patchStatus = 200

const TOOLS = {
  items: [
    { name: 'pmo.list_my_tasks', kind: 'read', description: { ar: 'م', en: 'm' }, input_schema: { type: 'object' }, route: { method: 'GET', path: '/api/v1/tasks' }, input_map: { query: { filter: 'mine' } }, result_summary: ['items[].id', 'items[].name', 'total'], draft_target: null },
    { name: 'pmo.update_task_state', kind: 'write_light', description: { ar: 'م', en: 'm' }, input_schema: { type: 'object' }, route: { method: 'POST', path: '/api/v1/tasks/{task_id}/transition' }, input_map: { path: { task_id: '$task_id' }, body: { state: '$state' } }, result_summary: ['id', 'state'], draft_target: null },
    { name: 'pmo.draft_project', kind: 'draft', description: { ar: 'م', en: 'm' }, input_schema: { type: 'object' }, route: null, input_map: {}, result_summary: [], draft_target: '/projects/new' },
  ],
  total: 3,
  limits: { tool_calls_per_run: 8, messages_monthly: 100, messages_used: 1 },
}
const ME = { id: 42, name: 'سارة', company: { id: 1, name: 'نسق' } }

function sse(res: http.ServerResponse, events: [string, unknown][]) {
  res.writeHead(200, { 'content-type': 'text/event-stream' })
  for (const [name, data] of events) res.write(`event: ${name}\ndata: ${JSON.stringify(data)}\n\n`)
  res.end()
}

beforeAll(async () => {
  for (const [name, value] of Object.entries({ appendResponseHeader, createError, createEventStream, defineEventHandler, getCookie, getHeader, getQuery, getRequestHeader, getRouterParam, readBody, setResponseHeader })) vi.stubGlobal(name, value)
  odoo = http.createServer(async (req, res) => {
    let body = ''
    for await (const chunk of req) body += chunk
    odooCalls.push({ method: req.method!, url: req.url!, cookie: req.headers.cookie, body })
    res.setHeader('content-type', 'application/json')
    if (req.url === '/api/v1/me') return res.end(JSON.stringify(ME))
    if (req.url === '/api/v1/ai/tools') { res.statusCode = odooToolsStatus; return res.end(JSON.stringify(odooToolsStatus === 200 ? TOOLS : { code: 'feature_not_included', message: 'limit', details: { reason: 'limit', limit_key: 'ai.messages.monthly' } })) }
    if (req.url === '/api/v1/ai/audit') {
      if (auditFailKind && JSON.parse(body).kind === auditFailKind) { res.statusCode = 500; return res.end(JSON.stringify({ code: 'boom', message: 'secret detail from odoo' })) }
      odooToolsStatus === 200 ? res.end(JSON.stringify({ id: 1, messages_used: 2, messages_limit: 100 })) : (res.statusCode = 403, res.end(JSON.stringify({ code: 'feature_not_included', message: 'limit', details: { reason: 'limit', limit_key: 'ai.messages.monthly' } }))); return }
    if (req.url?.startsWith('/api/v1/tasks/') && odooMode === 'destroy_writes') return req.socket.destroy()
    if (req.url?.startsWith('/api/v1/tasks/') && odooMode === 'hang_writes') return
    if (req.url?.startsWith('/api/v1/tasks?') && odooMode === 'destroy_reads') return req.socket.destroy()
    if (req.url === '/api/v1/tasks/7/transition') {
      if (req.headers.cookie !== 'session_id=s1') { res.statusCode = 403; return res.end(JSON.stringify({ code: 'forbidden', message: 'no' })) }
      return res.end(JSON.stringify({ id: 7, state: 'done', secret: 'x' }))
    }
    if (req.url?.startsWith('/api/v1/tasks')) {
      if (req.headers.cookie !== 'session_id=s1') { res.statusCode = 403; return res.end(JSON.stringify({ code: 'forbidden', message: 'no' })) }
      return res.end(JSON.stringify({ items: [{ id: 5, name: 'تقرير', secret: 'x' }], total: 1 }))
    }
    res.statusCode = 404; res.end('{}')
  })
  service = http.createServer(async (req, res) => {
    let body = ''
    for await (const chunk of req) body += chunk
    serviceCalls.push({ method: req.method!, url: req.url!, headers: req.headers, body, at: Date.now() })
    if (req.url === '/v1/runs/r_1/claim') {
      const ok = claimMode === 'atomic' && !claimed
      claimed ||= ok
      res.statusCode = ok ? 200 : 409
      res.setHeader('content-type', 'application/json')
      return res.end(JSON.stringify(ok ? { ok: true } : { code: 'conflict', message: 'not claimable' }))
    }
    if (req.url === '/v1/runs/r_1/resume' && resumeMode === 'http500') { res.statusCode = 500; return res.end('{}') }
    if (req.url === '/v1/runs/r_1/resume' && resumeMode === 'destroy') return res.destroy()
    if (req.url === '/v1/runs/r_1/resume' && resumeMode === 'slow') {
      res.writeHead(200, { 'content-type': 'text/event-stream' })
      res.on('close', () => { if (!resumeStreamFinished) resumeStreamCancelled = true })
      setTimeout(() => res.write('event: run\ndata: {"run_id":"r_1"}\n\n'), 100)
      setTimeout(() => res.write('event: token\ndata: {"text":"x"}\n\n'), 300)
      setTimeout(() => res.end('event: done\ndata: {"status":"done"}\n\n', () => { resumeStreamFinished = true }), 500)
      return
    }
    if (req.method === 'PATCH') {
      res.setHeader('content-type', 'application/json')
      res.statusCode = patchStatus
      return res.end(JSON.stringify(patchStatus === 200 ? { ...RUN_LIST.items[0], ...JSON.parse(body) } : { detail: 'x' }))
    }
    if (req.method === 'GET' && req.url?.split('?')[0] === '/v1/runs') {
      res.setHeader('content-type', 'application/json')
      return res.end(JSON.stringify(runList))
    }
    if (req.method === 'GET') { res.setHeader('content-type', 'application/json'); return res.end(JSON.stringify({ run_id: 'r_1', status: runStatus, messages: [{ role: 'user', content: 'هلا' }], pending })) }
    if (req.url === '/v1/runs') {
      if (scenario === 'abort') { res.writeHead(200, { 'content-type': 'text/event-stream' }); res.write('event: run\ndata: {"run_id":"r_1"}\n\n'); setTimeout(() => res.destroy(), 20); return }
      if (scenario === 'read_slow_done') {
        res.writeHead(200, { 'content-type': 'text/event-stream' })
        res.write('event: run\ndata: {"run_id":"r_1"}\n\n')
        res.write('event: tool_request\ndata: {"call_id":"c_1","tool":"pmo.list_my_tasks","kind":"read","input":{},"summary_ar":"س","summary_en":"s"}\n\n')
        setTimeout(() => { doneSentAt = Date.now(); res.write('event: done\ndata: {"status":"waiting_tool"}\n\n'); res.end() }, 300)
        return
      }
      if (scenario === 'error_only') return sse(res, [['run', { run_id: 'r_1' }], ['error', { code: 'model_failed', message: 'boom' }]])
      if (scenario === 'read') return sse(res, [['run', { run_id: 'r_1' }], ['tool_request', { call_id: 'c_1', tool: 'pmo.list_my_tasks', kind: 'read', input: {}, summary_ar: 'سأقرأ', summary_en: 'read' }], ['done', { status: 'waiting_tool' }]])
      if (scenario === 'draft_as_read') return sse(res, [['run', { run_id: 'r_1' }], ['tool_request', { call_id: 'c_4', tool: 'pmo.draft_project', kind: 'read', input: { name: 'x' }, summary_ar: 'س', summary_en: 's' }], ['done', { status: 'waiting_tool' }]])
      if (scenario === 'bogus_draft') return sse(res, [['run', { run_id: 'r_1' }], ['tool_request', { call_id: 'c_7', tool: 'pmo.draft_nothing', kind: 'draft', input: { name: 'x' }, summary_ar: 'س', summary_en: 's' }], ['done', { status: 'waiting_user' }]])
      if (scenario === 'draft_wrong_kind') return sse(res, [['run', { run_id: 'r_1' }], ['tool_request', { call_id: 'c_8', tool: 'pmo.list_my_tasks', kind: 'write_light', input: {}, summary_ar: 'س', summary_en: 's' }], ['done', { status: 'waiting_user' }]])
      if (scenario === 'unknown') return sse(res, [['run', { run_id: 'r_1' }], ['tool_request', { call_id: 'c_9', tool: 'pmo.delete_all', kind: 'read', input: {}, summary_ar: 'س', summary_en: 's' }], ['done', { status: 'waiting_tool' }]])
      return sse(res, [['run', { run_id: 'r_1' }], ['tool_request', { call_id: 'c_2', tool: 'pmo.draft_project', kind: 'draft', input: { name: 'بوابة' }, summary_ar: 'س', summary_en: 's' }], ['done', { status: 'waiting_user' }]])
    }
    return sse(res, [['run', { run_id: 'r_1' }], ['token', { text: 'عندك' }], ['answer', { text: 'عندك مهمة', records: [{ type: 'task', id: 5, label: 'تقرير' }] }], ['done', { status: 'done' }]])
  })
  await new Promise<void>(r => odoo.listen(0, '127.0.0.1', r))
  await new Promise<void>(r => service.listen(0, '127.0.0.1', r))
  odooUrl = `http://127.0.0.1:${(odoo.address() as any).port}`
  serviceUrl = `http://127.0.0.1:${(service.address() as any).port}`
  const dead = http.createServer()
  await new Promise<void>(r => dead.listen(0, '127.0.0.1', r))
  deadServiceUrl = `http://127.0.0.1:${(dead.address() as any).port}`
  await new Promise<void>(r => dead.close(() => r()))
  vi.stubGlobal('useRuntimeConfig', () => ({ odooUrl, aiServiceUrl: serviceDown ? deadServiceUrl : serviceUrl, aiServiceToken: serviceToken, odooDb: 'x', authProxyClientIpHeader: '' }))
  const { assertSameSiteJson } = await import('../../same-site')
  vi.stubGlobal('assertSameSiteJson', assertSameSiteJson)
  const start = (await import('../../../api/ai/runs/index.post')).default
  const resume = (await import('../../../api/ai/runs/[id]/resume.post')).default
  const status = (await import('../../../api/ai/runs/[id]/index.get')).default
  const list = (await import('../../../api/ai/runs/index.get')).default
  const patch = (await import('../../../api/ai/runs/[id]/index.patch')).default
  const h3app = createApp()
  h3app.use('/api/ai/runs', defineEventHandler((event) => {
    const match = event.path.match(/^\/([^/?]+)(\/resume)?/) // h3 strips the mount prefix
    if (!match) return event.method === 'GET' ? list(event) : start(event)
    event.context.params = { id: match[1]! }
    return match[2] ? resume(event) : event.method === 'PATCH' ? patch(event) : status(event)
  }))
  app = http.createServer(toNodeListener(h3app))
  await new Promise<void>(r => app.listen(0, '127.0.0.1', r))
  url = `http://127.0.0.1:${(app.address() as any).port}`
})
afterAll(() => { odoo.close(); service.close(); app.close() })
const DRAFT_PENDING = { call_id: 'c_2', tool: 'pmo.draft_project', kind: 'draft', input: { name: 'بوابة' } }
const WRITE_PENDING = { call_id: 'c_3', tool: 'pmo.update_task_state', kind: 'write_light', input: { task_id: 7, state: 'done' } }
beforeEach(() => { odooCalls = []; serviceCalls = []; scenario = 'read'; serviceDown = false; odooToolsStatus = 200; pending = DRAFT_PENDING; serviceToken = ''; claimMode = 'atomic'; claimed = false; doneSentAt = 0; odooMode = 'normal'; auditFailKind = null; runStatus = 'waiting_user'; resumeMode = 'ok'; resumeStreamFinished = false; resumeStreamCancelled = false; runList = RUN_LIST; patchStatus = 200 })

const post = (path: string, body: unknown, cookie = 'session_id=s1') => fetch(`${url}${path}`, {
  method: 'POST', headers: { 'content-type': 'application/json', cookie, origin: url, 'sec-fetch-site': 'same-origin' }, body: JSON.stringify(body),
})
const events = async (response: Response) => (await response.text()).trim().split('\n\n').map((block) => {
  const name = block.match(/^event: (.+)$/m)![1]!
  return [name, JSON.parse(block.match(/^data: (.+)$/m)![1]!)] as [string, any]
})

describe('POST /api/ai/runs', () => {
  it('executes a read tool with the caller cookie, audits it, and resumes in one stream', async () => {
    const list = await events(await post('/api/ai/runs', { message: 'هلا' }))
    const names = list.map(([n]) => n)
    expect(names).toEqual(['run', 'tool_request', 'tool_result', 'token', 'answer', 'done'])
    expect(list[2]![1]).toMatchObject({ call_id: 'c_1', tool: 'pmo.list_my_tasks', ok: true })
    const tasksCall = odooCalls.find(c => c.url.startsWith('/api/v1/tasks'))!
    expect(tasksCall.cookie).toBe('session_id=s1')
    expect(tasksCall.url).toBe('/api/v1/tasks?filter=mine')
    const resumeCall = serviceCalls.find(c => c.url === '/v1/runs/r_1/resume')!
    expect(resumeCall.headers['x-nasq-tenant']).toBe('x')
    expect(resumeCall.headers['x-nasq-user']).toBe('42')
    expect(JSON.parse(resumeCall.body)).toEqual({ call_id: 'c_1', result: { ok: true, data: { items: [{ id: 5, name: 'تقرير' }], total: 1 } } })
    const audits = odooCalls.filter(c => c.url === '/api/v1/ai/audit').map(c => JSON.parse(c.body!))
    expect(audits.map(a => [a.kind, a.result])).toEqual([['message', 'ok'], ['read', 'ok']])
    const started = JSON.parse(serviceCalls.find(c => c.url === '/v1/runs')!.body)
    expect(started.tools.map((t: any) => t.name)).toEqual(['pmo.list_my_tasks', 'pmo.update_task_state', 'pmo.draft_project'])
    expect(started.limits).toEqual({ max_steps: 12, max_tool_calls: 8, timeout_seconds: 120 })
  })

  it('reports a denied read as a failed tool result and keeps streaming', async () => {
    const list = await events(await post('/api/ai/runs', { message: 'هلا' }, 'session_id=other'))
    expect(list.map(([n]) => n)).toContain('answer')
    const resumeCall = serviceCalls.find(c => c.url === '/v1/runs/r_1/resume')!
    expect(JSON.parse(resumeCall.body).result).toEqual({ ok: false, error: { code: 'forbidden', message: 'no' } })
    const audit = odooCalls.filter(c => c.url === '/api/v1/ai/audit').map(c => JSON.parse(c.body!)).at(-1)
    expect([audit.kind, audit.result, audit.http_status]).toEqual(['read', 'denied', 403])
  })

  it('never calls Odoo for a tool outside the fetched catalog', async () => {
    scenario = 'unknown'
    await events(await post('/api/ai/runs', { message: 'هلا' }))
    expect(odooCalls.some(c => c.url.includes('delete'))).toBe(false)
    expect(JSON.parse(serviceCalls.find(c => c.url === '/v1/runs/r_1/resume')!.body).result).toEqual({ ok: false, error: { code: 'unknown_tool', message: 'pmo.delete_all is not in the catalog' } })
  })

  it('passes a draft request through and stops at waiting_user', async () => {
    scenario = 'draft'
    const list = await events(await post('/api/ai/runs', { message: 'سوّ مشروع' }))
    expect(list.map(([n]) => n)).toEqual(['run', 'tool_request', 'done'])
    expect(list.at(-1)![1]).toEqual({ status: 'waiting_user' })
    const audit = odooCalls.filter(c => c.url === '/api/v1/ai/audit').map(c => JSON.parse(c.body!)).at(-1)
    expect([audit.kind, audit.result, audit.draft]).toEqual(['draft', 'proposed', { name: 'بوابة' }])
    expect(serviceCalls.some(c => c.url.endsWith('/resume'))).toBe(false)
  })

  it('never executes a draft tool even when the service names it as a read request', async () => {
    scenario = 'draft_as_read'
    await events(await post('/api/ai/runs', { message: 'سوّ مشروع' }))
    expect(odooCalls.filter(c => !['/api/v1/me', '/api/v1/ai/tools', '/api/v1/ai/audit'].includes(c.url))).toEqual([])
    expect(odooCalls.filter(c => c.url === '/api/v1/ai/audit').map(c => JSON.parse(c.body!).kind)).toEqual(['message'])
    expect(JSON.parse(serviceCalls.find(c => c.url === '/v1/runs/r_1/resume')!.body).result).toEqual({ ok: false, error: { code: 'not_executable', message: 'pmo.draft_project cannot be executed as read' } })
  })

  it('answers a draft request for a tool missing from the catalog with unknown_tool and finishes the run', async () => {
    scenario = 'bogus_draft'
    const list = await events(await post('/api/ai/runs', { message: 'سوّ مشروع' }))
    expect(list.map(([n]) => n)).toEqual(['run', 'token', 'answer', 'done'])
    expect(JSON.parse(serviceCalls.find(c => c.url === '/v1/runs/r_1/resume')!.body)).toEqual({ call_id: 'c_7', result: { ok: false, error: { code: 'unknown_tool', message: 'pmo.draft_nothing is not a draft tool of the catalog' } } })
    expect(odooCalls.filter(c => c.url !== '/api/v1/me' && c.url !== '/api/v1/ai/tools').map(c => c.url)).toEqual(['/api/v1/ai/audit'])
    expect(odooCalls.filter(c => c.url === '/api/v1/ai/audit').map(c => JSON.parse(c.body!).kind)).toEqual(['message'])
  })

  it('answers a write_light request whose catalog kind differs with unknown_tool and executes nothing', async () => {
    scenario = 'draft_wrong_kind'
    const list = await events(await post('/api/ai/runs', { message: 'هلا' }))
    expect(list.map(([n]) => n)).toEqual(['run', 'token', 'answer', 'done'])
    expect(JSON.parse(serviceCalls.find(c => c.url === '/v1/runs/r_1/resume')!.body).result.error.code).toBe('unknown_tool')
    expect(odooCalls.some(c => c.url.startsWith('/api/v1/tasks'))).toBe(false)
  })

  it('answers 403 with the limit code before contacting the service when the monthly limit is reached', async () => {
    odooToolsStatus = 403
    const response = await post('/api/ai/runs', { message: 'هلا' })
    expect(response.status).toBe(403)
    expect(await response.json()).toMatchObject({ data: { code: 'feature_not_included', details: { limit_key: 'ai.messages.monthly' } } })
    expect(serviceCalls).toEqual([])
  })

  it('answers 503 ai_unavailable when the service refuses the connection', async () => {
    serviceDown = true
    const response = await post('/api/ai/runs', { message: 'هلا' })
    expect(response.status).toBe(503)
    const json = await response.json()
    expect(json.data.code).toBe('ai_unavailable')
    expect(JSON.stringify(json)).not.toMatch(/fetch failed|ECONNREFUSED/)
  })

  it('ends a stream whose service connection drops with one ai_unavailable error event', async () => {
    scenario = 'abort'
    const list = await events(await post('/api/ai/runs', { message: 'هلا' }))
    expect(list.map(([n]) => n)).toEqual(['run', 'error', 'done'])
    expect(list[1]![1].code).toBe('ai_unavailable')
    expect(list[2]![1]).toEqual({ status: 'failed' })
    expect(JSON.stringify(list[1]![1])).not.toMatch(/terminated|ECONNRESET|fetch failed/)
  })

  it('sends the service locale from the nasq-locale cookie', async () => {
    await events(await post('/api/ai/runs', { message: 'هلا' }, 'session_id=s1; nasq-locale=en'))
    expect(JSON.parse(serviceCalls.find(c => c.url === '/v1/runs')!.body).locale).toBe('en')
    serviceCalls = []
    await events(await post('/api/ai/runs', { message: 'هلا' }, 'session_id=s1; i18n_redirected=en'))
    expect(JSON.parse(serviceCalls.find(c => c.url === '/v1/runs')!.body).locale).toBe('ar')
  })

  it('rejects a cross-site post', async () => {
    const response = await fetch(`${url}/api/ai/runs`, { method: 'POST', headers: { 'content-type': 'application/json', cookie: 'session_id=s1', origin: 'https://evil.example', 'sec-fetch-site': 'cross-site' }, body: '{"message":"x"}' })
    expect(response.status).toBeGreaterThanOrEqual(400)
    expect(serviceCalls).toEqual([])
  })
})

describe('resume and status', () => {
  it('resumes with the user decision and relays the stream', async () => {
    const list = await events(await post('/api/ai/runs/r_1/resume', { call_id: 'c_2', decision: 'approved', data: { id: 77, name: 'بوابة' } }))
    expect(list.map(([n]) => n)).toEqual(['run', 'token', 'answer', 'done'])
    expect(JSON.parse(serviceCalls.at(-1)!.body)).toEqual({ call_id: 'c_2', result: { ok: true, decision: 'approved', data: { id: 77, name: 'بوابة' } } })
  })
  it('executes an approved write_light with the caller cookie, audits it, and passes the real result', async () => {
    pending = WRITE_PENDING
    const list = await events(await post('/api/ai/runs/r_1/resume', { call_id: 'c_3', decision: 'approved', data: { task_id: 99, state: 'cancelled' } }))
    expect(list.map(([n]) => n)).toEqual(['run', 'token', 'answer', 'done'])
    const call = odooCalls.find(c => c.url === '/api/v1/tasks/7/transition')!
    expect(call.method).toBe('POST')
    expect(call.cookie).toBe('session_id=s1')
    expect(JSON.parse(call.body!)).toEqual({ state: 'done' })
    const audit = odooCalls.filter(c => c.url === '/api/v1/ai/audit').map(c => JSON.parse(c.body!)).at(-1)
    expect([audit.kind, audit.result, audit.tool_name, audit.http_status]).toEqual(['write_light', 'ok', 'pmo.update_task_state', 200])
    expect(JSON.parse(serviceCalls.at(-1)!.body)).toEqual({ call_id: 'c_3', result: { ok: true, data: { id: 7, state: 'done' }, decision: 'approved' } })
    expect(serviceCalls.filter(c => c.method === 'POST').map(c => c.url)).toEqual(['/v1/runs/r_1/claim', '/v1/runs/r_1/resume'])
    expect(JSON.parse(serviceCalls.find(c => c.url.endsWith('/claim'))!.body)).toEqual({ call_id: 'c_3' })
  })

  it('reports a denied write_light as a failed real result', async () => {
    pending = WRITE_PENDING
    await events(await post('/api/ai/runs/r_1/resume', { call_id: 'c_3', decision: 'approved' }, 'session_id=other'))
    const audit = odooCalls.filter(c => c.url === '/api/v1/ai/audit').map(c => JSON.parse(c.body!)).at(-1)
    expect([audit.kind, audit.result, audit.http_status]).toEqual(['write_light', 'denied', 403])
    expect(JSON.parse(serviceCalls.at(-1)!.body).result).toEqual({ ok: false, error: { code: 'forbidden', message: 'no' }, decision: 'approved' })
  })

  it('executes nothing for a rejected write_light', async () => {
    pending = WRITE_PENDING
    await events(await post('/api/ai/runs/r_1/resume', { call_id: 'c_3', decision: 'rejected' }))
    expect(odooCalls.some(c => c.url.includes('transition') || c.url === '/api/v1/ai/audit')).toBe(false)
    expect(JSON.parse(serviceCalls.at(-1)!.body)).toEqual({ call_id: 'c_3', result: { ok: false, decision: 'rejected' } })
  })

  it('answers 409 and executes nothing when the call_id does not match the pending call', async () => {
    pending = WRITE_PENDING
    const response = await post('/api/ai/runs/r_1/resume', { call_id: 'c_other', decision: 'approved' })
    expect(response.status).toBe(409)
    expect(odooCalls.some(c => c.url.includes('transition'))).toBe(false)
    expect(serviceCalls.some(c => c.url.endsWith('/resume'))).toBe(false)
  })

  it('answers 409 when the run has no pending call', async () => {
    pending = null
    expect((await post('/api/ai/runs/r_1/resume', { call_id: 'c_2', decision: 'approved' })).status).toBe(409)
    expect(serviceCalls.some(c => c.url.endsWith('/resume'))).toBe(false)
  })

  describe('a stalled read call', () => {
    const READ_PENDING = { call_id: 'c_1', tool: 'pmo.list_my_tasks', kind: 'read', input: {} }
    it('is executed again by the server on "approved", audited, announced and resumed', async () => {
      pending = READ_PENDING
      runStatus = 'waiting_tool'
      const list = await events(await post('/api/ai/runs/r_1/resume', { call_id: 'c_1', decision: 'approved' }))
      expect(list.map(([n]) => n)).toEqual(['tool_result', 'run', 'token', 'answer', 'done'])
      expect(list[0]![1]).toMatchObject({ call_id: 'c_1', tool: 'pmo.list_my_tasks', kind: 'read', ok: true })
      const tasksCall = odooCalls.find(c => c.url.startsWith('/api/v1/tasks'))!
      expect([tasksCall.cookie, tasksCall.url]).toEqual(['session_id=s1', '/api/v1/tasks?filter=mine'])
      expect(odooCalls.filter(c => c.url === '/api/v1/ai/audit').map(c => JSON.parse(c.body!)).map(a => [a.kind, a.result])).toEqual([['read', 'ok']])
      expect(lastResume()).toEqual({ call_id: 'c_1', result: { ok: true, data: { items: [{ id: 5, name: 'تقرير' }], total: 1 } } })
      expect(serviceCalls.some(c => c.url.endsWith('/claim'))).toBe(false)
    })
    it('answers 409 to a rejection and executes nothing', async () => {
      pending = READ_PENDING
      expect((await post('/api/ai/runs/r_1/resume', { call_id: 'c_1', decision: 'rejected' })).status).toBe(409)
      expect(odooCalls.some(c => c.url.startsWith('/api/v1/tasks'))).toBe(false)
      expect(serviceCalls.some(c => c.url.endsWith('/resume'))).toBe(false)
    })
  })

  it.each([
    ['approved a write_light', WRITE_PENDING, 'approved'],
    ['rejected a write_light', WRITE_PENDING, 'rejected'],
    ['approved a draft', DRAFT_PENDING, 'approved'],
    ['rejected a draft', DRAFT_PENDING, 'rejected'],
  ])('answers 409 for every decision while the run is executing (%s)', async (_label, call, decision) => {
    pending = call
    runStatus = 'executing'
    expect((await post('/api/ai/runs/r_1/resume', { call_id: call.call_id, decision })).status).toBe(409)
    expect(odooCalls.some(c => c.url.startsWith('/api/v1/tasks') || c.url === '/api/v1/ai/audit')).toBe(false)
    expect(serviceCalls.some(c => c.method === 'POST')).toBe(false)
  })

  it('rejects a cross-site resume', async () => {
    const response = await fetch(`${url}/api/ai/runs/r_1/resume`, { method: 'POST', headers: { 'content-type': 'application/json', cookie: 'session_id=s1', origin: 'https://evil.example', 'sec-fetch-site': 'cross-site' }, body: '{"call_id":"c_2","decision":"approved"}' })
    expect(response.status).toBe(403)
    expect(serviceCalls).toEqual([])
  })

  it('returns the run status with its pending call', async () => {
    const response = await fetch(`${url}/api/ai/runs/r_1`, { headers: { cookie: 'session_id=s1' } })
    expect((await response.json()).pending.tool).toBe('pmo.draft_project')
    expect(serviceCalls.at(-1)!.headers['x-nasq-user']).toBe('42')
  })
})

describe('GET /api/ai/runs', () => {
  const get = (cookie = 'session_id=s1') => fetch(`${url}/api/ai/runs`, { headers: { cookie } })

  it('lists the caller own runs by asking the service with the caller identity only', async () => {
    const response = await get()
    expect(response.status).toBe(200)
    expect(await response.json()).toMatchObject({ total: 1, items: [{ run_id: 'r_1', title: 'هلا', status: 'done' }] })
    const call = serviceCalls.at(-1)!
    expect([call.method, call.url, call.headers['x-nasq-tenant'], call.headers['x-nasq-user'], call.headers.cookie]).toEqual(['GET', '/v1/runs', 'x', '42', undefined])
    expect(odooCalls.map(c => c.url)).toEqual(['/api/v1/me', '/api/v1/ai/tools'])
  })

  it('forwards an Odoo denial and never reaches the service', async () => {
    odooToolsStatus = 403
    expect((await get()).status).toBe(403)
    expect(serviceCalls).toEqual([])
  })

  it('answers 503 ai_unavailable when the service is down and refuses a list that breaks the contract', async () => {
    serviceDown = true
    const down = await get()
    expect([down.status, (await down.json()).data.code]).toEqual([503, 'ai_unavailable'])
    serviceDown = false
    runList = { items: [{ run_id: 'r_1', title: 'x', status: 'done', updated_at: 'yesterday', archived: false }], total: 1 }
    expect((await get()).status).toBe(500)
  })
})

describe('GET /api/ai/runs?archived=true', () => {
  const get = (query: string, cookie = 'session_id=s1') => fetch(`${url}/api/ai/runs${query}`, { headers: { cookie } })

  it('asks the service for the archived conversations only when told to', async () => {
    expect((await get('?archived=true')).status).toBe(200)
    expect(serviceCalls.at(-1)!.url).toBe('/v1/runs?archived=true')
    await get('?archived=false')
    expect(serviceCalls.at(-1)!.url).toBe('/v1/runs')
    await get('')
    expect(serviceCalls.at(-1)!.url).toBe('/v1/runs')
  })

  it('refuses an unknown archived value before calling anything', async () => {
    const response = await get('?archived=maybe')
    expect([response.status, (await response.json()).data.code]).toEqual([422, 'invalid'])
    expect(serviceCalls).toEqual([])
    expect(odooCalls).toEqual([])
  })
})

describe('PATCH /api/ai/runs/{id}', () => {
  const patch = (body: unknown, extra: Record<string, string> = {}, path = '/api/ai/runs/r_1') => fetch(`${url}${path}`, {
    method: 'PATCH', headers: { 'content-type': 'application/json', cookie: 'session_id=s1', origin: url, 'sec-fetch-site': 'same-origin', ...extra }, body: JSON.stringify(body),
  })

  it('renames and archives through the service as the caller and returns the updated row', async () => {
    const response = await patch({ title: '  مشروع البوابة ', archived: true })
    expect(response.status).toBe(200)
    expect(await response.json()).toMatchObject({ run_id: 'r_1', title: 'مشروع البوابة', archived: true })
    const call = serviceCalls.at(-1)!
    expect([call.method, call.url, call.headers['x-nasq-tenant'], call.headers['x-nasq-user'], call.headers.cookie]).toEqual(['PATCH', '/v1/runs/r_1', 'x', '42', undefined])
    expect(JSON.parse(call.body)).toEqual({ title: 'مشروع البوابة', archived: true })
  })

  it('sends the service only the fields of the contract', async () => {
    expect((await patch({ archived: false })).status).toBe(200)
    expect(JSON.parse(serviceCalls.at(-1)!.body)).toEqual({ archived: false })
    const bad = await patch({ title: 'ok', owner: 'x' })
    expect(bad.status).toBe(422)
  })

  it.each([{}, { title: '' }, { title: '   ' }, { title: 'x'.repeat(81) }, { title: 'a\nb' }, { archived: 'yes' }])('refuses %j before reaching Odoo or the service', async (body) => {
    const response = await patch(body)
    expect([response.status, (await response.json()).data.code]).toEqual([422, 'invalid'])
    expect(serviceCalls).toEqual([])
    expect(odooCalls).toEqual([])
  })

  it('refuses a cross-site or non-JSON request', async () => {
    expect((await patch({ title: 'x' }, { 'sec-fetch-site': 'cross-site' })).status).toBe(403)
    expect((await patch({ title: 'x' }, { 'content-type': 'text/plain' })).status).toBe(415)
    expect(serviceCalls).toEqual([])
  })

  it('answers 404 not_found for a run that is not the caller own and 502 for any other service failure', async () => {
    patchStatus = 404
    const missing = await patch({ title: 'x' })
    expect([missing.status, (await missing.json()).data.code]).toEqual([404, 'not_found'])
    patchStatus = 500
    const broken = await patch({ title: 'x' })
    expect([broken.status, (await broken.json()).data.code]).toEqual([502, 'ai_upstream'])
  })

  it('forwards an Odoo denial and answers 503 when the service is down', async () => {
    odooToolsStatus = 403
    expect((await patch({ title: 'x' })).status).toBe(403)
    expect(serviceCalls).toEqual([])
    odooToolsStatus = 200
    serviceDown = true
    const down = await patch({ title: 'x' })
    expect([down.status, (await down.json()).data.code]).toEqual([503, 'ai_unavailable'])
  })
})

const approve = (callId = 'c_3') => post('/api/ai/runs/r_1/resume', { call_id: callId, decision: 'approved' })
const transitions = () => odooCalls.filter(c => c.url.includes('/transition'))
const lastResume = () => JSON.parse(serviceCalls.filter(c => c.url.endsWith('/resume')).at(-1)!.body)

describe('claim before executing a write_light', () => {
  it('executes exactly once for two concurrent approvals', async () => {
    pending = WRITE_PENDING
    const [a, b] = await Promise.all([approve(), approve()])
    await Promise.all([a.text(), b.text()])
    expect([a.status, b.status].sort()).toEqual([200, 409])
    expect(transitions()).toHaveLength(1)
    expect(serviceCalls.filter(c => c.url.endsWith('/resume'))).toHaveLength(1)
  })

  it('answers 409 and executes nothing when the claim is refused', async () => {
    pending = WRITE_PENDING
    claimMode = 'conflict'
    expect((await approve()).status).toBe(409)
    expect(transitions()).toHaveLength(0)
    expect(odooCalls.some(c => c.url === '/api/v1/ai/audit')).toBe(false)
    expect(serviceCalls.some(c => c.url.endsWith('/resume'))).toBe(false)
  })

  it('does not claim drafts or rejections', async () => {
    await events(await post('/api/ai/runs/r_1/resume', { call_id: 'c_2', decision: 'approved', data: { id: 1 } }))
    pending = WRITE_PENDING
    await events(await post('/api/ai/runs/r_1/resume', { call_id: 'c_3', decision: 'rejected' }))
    expect(serviceCalls.some(c => c.url.endsWith('/claim'))).toBe(false)
  })

  it('keeps the real result and does not repeat the write when the audit fails afterwards', async () => {
    pending = WRITE_PENDING
    auditFailKind = 'write_light'
    const spy = vi.spyOn(console, 'error').mockImplementation(() => undefined)
    const list = await events(await approve())
    expect(transitions()).toHaveLength(1)
    expect(lastResume()).toEqual({ call_id: 'c_3', result: { ok: true, data: { id: 7, state: 'done' }, decision: 'approved' } })
    expect(list.map(([n]) => n)).toEqual(['run', 'token', 'answer', 'error', 'done'])
    expect(list.find(([n]) => n === 'error')![1]).toEqual({ code: 'audit_failed', message: expect.any(String) })
    expect(JSON.stringify(list)).not.toContain('secret detail')
    expect(list.at(-1)![1]).toEqual({ status: 'done' })
    expect(JSON.stringify(spy.mock.calls)).not.toContain('secret detail')
    expect(spy).toHaveBeenCalled()
    spy.mockRestore()
  })

  it('answers invalid_arguments to the service for a path value that would traverse', async () => {
    pending = { ...WRITE_PENDING, input: { task_id: '..', state: 'done' } }
    await events(await approve())
    expect(odooCalls.some(c => c.url.startsWith('/api/v1/tasks'))).toBe(false)
    expect(lastResume().result).toMatchObject({ ok: false, error: { code: 'invalid_arguments' }, decision: 'approved' })
  })
})

describe('Odoo network failures never strand the run', () => {
  it('resumes a claimed write with upstream_unavailable when the Odoo socket is destroyed', async () => {
    pending = WRITE_PENDING
    odooMode = 'destroy_writes'
    const list = await events(await approve())
    expect(lastResume()).toEqual({ call_id: 'c_3', result: { ok: false, error: { code: 'upstream_unavailable', message: expect.any(String) }, decision: 'approved' } })
    expect(JSON.stringify(lastResume())).not.toMatch(/ECONNRESET|fetch failed|socket/)
    expect(list.at(-1)![0]).toBe('done')
  })

  it('resumes a claimed write with upstream_unavailable when Odoo hangs past the timeout', async () => {
    pending = WRITE_PENDING
    odooMode = 'hang_writes'
    const original = AbortSignal.timeout.bind(AbortSignal)
    const spy = vi.spyOn(AbortSignal, 'timeout').mockImplementation(ms => original(ms === 15000 ? 150 : ms))
    try {
      await events(await approve())
    } finally { spy.mockRestore() }
    expect(lastResume().result).toMatchObject({ ok: false, error: { code: 'upstream_unavailable' }, decision: 'approved' })
  })

  it('resumes a read with upstream_unavailable when the Odoo socket is destroyed', async () => {
    odooMode = 'destroy_reads'
    const list = await events(await post('/api/ai/runs', { message: 'هلا' }))
    expect(lastResume()).toEqual({ call_id: 'c_1', result: { ok: false, error: { code: 'upstream_unavailable', message: expect.any(String) } } })
    expect(list.map(([n]) => n)).toContain('answer')
  })
})

describe('stream shape', () => {
  it('ends an error-only stream with done failed', async () => {
    scenario = 'error_only'
    const list = await events(await post('/api/ai/runs', { message: 'هلا' }))
    expect(list.map(([n]) => n)).toEqual(['run', 'error', 'done'])
    expect(list.at(-1)![1]).toEqual({ status: 'failed' })
  })

  it('resumes only after the service stream delivered done', async () => {
    scenario = 'read_slow_done'
    const list = await events(await post('/api/ai/runs', { message: 'هلا' }))
    const resumeAt = serviceCalls.find(c => c.url.endsWith('/resume'))!.at
    expect(doneSentAt).toBeGreaterThan(0)
    expect(resumeAt).toBeGreaterThanOrEqual(doneSentAt)
    expect(list.map(([n]) => n)).toEqual(['run', 'tool_request', 'tool_result', 'token', 'answer', 'done'])
  })

  it('surfaces audit_failed for a failed read audit but still hands the result to the service', async () => {
    auditFailKind = 'read'
    const spy = vi.spyOn(console, 'error').mockImplementation(() => undefined)
    const list = await events(await post('/api/ai/runs', { message: 'هلا' }))
    spy.mockRestore()
    expect(list.map(([n]) => n)).toEqual(['run', 'tool_request', 'tool_result', 'token', 'answer', 'error', 'done'])
    expect(lastResume().result.ok).toBe(true)
  })

  it('stops silently when the browser aborts mid-stream: no more Odoo calls, no service resume', async () => {
    scenario = 'read_slow_done'
    const controller = new AbortController()
    const response = await fetch(`${url}/api/ai/runs`, {
      method: 'POST', signal: controller.signal,
      headers: { 'content-type': 'application/json', cookie: 'session_id=s1', origin: url, 'sec-fetch-site': 'same-origin' }, body: JSON.stringify({ message: 'هلا' }),
    })
    const reader = response.body!.getReader()
    await reader.read()
    controller.abort()
    await reader.cancel().catch(() => undefined)
    await new Promise(r => setTimeout(r, 700))
    expect(odooCalls.some(c => c.url.startsWith('/api/v1/tasks'))).toBe(false)
    expect(serviceCalls.some(c => c.url.endsWith('/resume'))).toBe(false)
  })
})

describe('draft rejection audit', () => {
  const rejectDraft = () => post('/api/ai/runs/r_1/resume', { call_id: 'c_2', decision: 'rejected' })
  it('audits a rejected draft before resuming', async () => {
    await events(await rejectDraft())
    const rejected = odooCalls.filter(c => c.url === '/api/v1/ai/audit').map(c => JSON.parse(c.body!)).at(-1)
    expect(rejected).toEqual({ conversation_id: 'r_1', kind: 'draft', tool_name: 'pmo.draft_project', input: { name: 'بوابة' }, result: 'rejected', http_status: null, draft: { name: 'بوابة' }, approved: null, attested: false })
    expect(lastResume()).toEqual({ call_id: 'c_2', result: { ok: false, decision: 'rejected' } })
  })
  it('resumes even when that audit fails', async () => {
    auditFailKind = 'draft'
    const spy = vi.spyOn(console, 'error').mockImplementation(() => undefined)
    const list = await events(await rejectDraft())
    spy.mockRestore()
    expect(lastResume()).toEqual({ call_id: 'c_2', result: { ok: false, decision: 'rejected' } })
    expect(list.map(([n]) => n)).toContain('answer')
  })
})

describe('service token', () => {
  it('sends X-Nasq-Service-Token only when configured', async () => {
    await events(await post('/api/ai/runs', { message: 'هلا' }))
    expect(serviceCalls.every(c => c.headers['x-nasq-service-token'] === undefined)).toBe(true)
    serviceCalls = []; serviceToken = 'tok-123'
    await events(await post('/api/ai/runs', { message: 'هلا' }))
    expect(serviceCalls.length).toBeGreaterThan(0)
    expect(serviceCalls.every(c => c.headers['x-nasq-service-token'] === 'tok-123')).toBe(true)
  })
})

describe('start validation', () => {
  it.each([
    [{ message: 5 }], [{ message: 'x', run_id: 7 }], [{ message: 'x', context: 'project' }], [{ message: 'x', context: { page: 3 } }],
    [{ message: 'x', context: { page: 'project', id: 'a' } }], [{ message: ['x'] }],
  ])('answers 422 for %j', async (body) => {
    const response = await post('/api/ai/runs', body)
    expect(response.status).toBe(422)
    expect(odooCalls).toEqual([])
    expect(serviceCalls).toEqual([])
  })
  it('accepts a context with a page slug and an integer id', async () => {
    const list = await events(await post('/api/ai/runs', { message: 'هلا', context: { page: 'project', id: 12 } }))
    expect(list.at(-1)![0]).toBe('done')
    expect(JSON.parse(serviceCalls.find(c => c.url === '/v1/runs')!.body).context).toEqual({ page: 'project', id: 12 })
  })
})


describe('a failed service resume after the write ran', () => {
  it.each(['http500', 'destroy'] as const)('answers 200 with resume_failed and done failed (%s), having executed once', async (mode) => {
    pending = WRITE_PENDING
    resumeMode = mode
    const spy = vi.spyOn(console, 'error').mockImplementation(() => undefined)
    const response = await approve()
    expect(response.status).toBe(200)
    const list = await events(response)
    spy.mockRestore()
    expect(list).toEqual([['error', { code: 'resume_failed', message: expect.any(String) }], ['done', { status: 'failed' }]])
    expect(JSON.stringify(list)).not.toMatch(/ECONNRESET|socket|fetch failed|status 500/)
    expect(transitions()).toHaveLength(1)
  })
  it('puts audit_failed before resume_failed when the audit also failed', async () => {
    pending = WRITE_PENDING
    resumeMode = 'destroy'
    auditFailKind = 'write_light'
    const spy = vi.spyOn(console, 'error').mockImplementation(() => undefined)
    const list = await events(await approve())
    spy.mockRestore()
    expect(list.map(([n, d]) => [n, d.code ?? d.status])).toEqual([['error', 'audit_failed'], ['error', 'resume_failed'], ['done', 'failed']])
  })
  it('still fails with the service status when nothing was executed (an approved draft)', async () => {
    resumeMode = 'destroy'
    const response = await post('/api/ai/runs/r_1/resume', { call_id: 'c_2', decision: 'approved', data: { id: 1 } })
    expect(response.status).toBe(503)
    await response.text()
  })
})

describe('a claimed write outlives the browser', () => {
  it('reads the service resume stream to its end silently when the browser aborts after the claim', async () => {
    pending = WRITE_PENDING
    resumeMode = 'slow'
    const controller = new AbortController()
    const response = await fetch(`${url}/api/ai/runs/r_1/resume`, {
      method: 'POST', signal: controller.signal,
      headers: { 'content-type': 'application/json', cookie: 'session_id=s1', origin: url, 'sec-fetch-site': 'same-origin' }, body: JSON.stringify({ call_id: 'c_3', decision: 'approved' }),
    })
    const reader = response.body!.getReader()
    await reader.read()
    controller.abort()
    await reader.cancel().catch(() => undefined)
    await new Promise(r => setTimeout(r, 900))
    expect(transitions()).toHaveLength(1)
    expect(resumeStreamFinished).toBe(true)
    expect(resumeStreamCancelled).toBe(false)
  })
})
