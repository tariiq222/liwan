// Stateful synthetic meetings fixture. It never connects to Odoo or a customer database.
import http from 'node:http'
import { spawn } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { moduleUiPreviewData } from './module-ui-preview-data.mjs'

const port = Number(process.env.MOCK_PORT ?? 4514)
const upstreamPort = port + 1000
const upstream = spawn(process.execPath, [fileURLToPath(new URL('./internal-ui-audit-mock.mjs', import.meta.url))], {
  env: { ...process.env, MOCK_PORT: String(upstreamPort), MODULE_UI_PREVIEW: '1', PROJECTS_UI_PREVIEW: '1' }, stdio: ['ignore', 'inherit', 'inherit'],
})
const fixture = () => structuredClone(moduleUiPreviewData('/api/v1/meetings/1', new URL('http://fixture.local')))
let meeting = fixture()
let created = 0
let patches = 0
const json = (res, status, data) => { res.writeHead(status, { 'content-type': 'application/json' }); res.end(JSON.stringify(data)) }
async function body(req) {
  let value = ''
  for await (const chunk of req) value += chunk
  return JSON.parse(value || '{}')
}
const server = http.createServer(async (req, res) => {
  try {
    const url = new URL(req.url, `http://127.0.0.1:${port}`)
    const path = url.pathname
    if (path === '/api/v1/meetings-test/reset' && req.method === 'POST') {
      meeting = fixture(); created = 0; patches = 0
      return json(res, 200, { ok: true })
    }
    if (path === '/api/v1/meetings-test/state') return json(res, 200, { meeting, created, patches })
    if (path === '/api/v1/meetings/1') {
      if (req.method === 'PATCH') {
        const values = await body(req)
        if (values.write_date && values.write_date !== meeting.write_date) return json(res, 409, { code: 'conflict', message: 'تم تحديث الاجتماع بواسطة مستخدم آخر.' })
        Object.assign(meeting, values, { write_date: new Date().toISOString() }); patches++
      }
      return json(res, 200, meeting)
    }
    if (path === '/api/v1/meetings/1/resolutions' && req.method === 'POST') {
      const values = await body(req)
      const id = 20 + ++created
      const recommendation = { ...meeting.resolutions[0], ...values, id, state: 'open', responsible: { id: values.responsible_id, name: 'أحمد العتيبي' }, task_id: null, task_linked: false, execution_state: 'open', allowed_actions: ['start', 'complete', 'cancel', 'edit_result'], can_edit_decision: true, can_update_execution: true, deadline: values.deadline ?? null, execution_period: values.execution_period ?? '', result: '' }
      meeting.resolutions.push(recommendation)
      return json(res, 201, recommendation)
    }
    if (path === '/api/v1/meetings/resolutions') {
      let rows = meeting.resolutions.map(item => ({ ...item, meeting_id: meeting.id, meeting_name: meeting.name }))
      const q = url.searchParams.get('q')
      if (q) rows = rows.filter(item => `${item.name} ${item.meeting_name}`.includes(q))
      const state = url.searchParams.get('state')
      if (state === 'active') rows = rows.filter(item => ['open', 'in_progress'].includes(item.execution_state))
      else if (state && state !== 'overdue') rows = rows.filter(item => item.execution_state === state)
      const offset = Number(url.searchParams.get('offset') ?? 0)
      const limit = Number(url.searchParams.get('limit') ?? 25)
      return json(res, 200, { items: rows.slice(offset, offset + limit), total: rows.length })
    }
    const proxy = http.request({ hostname: '127.0.0.1', port: upstreamPort, path: req.url, method: req.method, headers: req.headers }, response => {
      res.writeHead(response.statusCode, response.headers); response.pipe(res)
    })
    proxy.on('error', () => json(res, 502, { code: 'unavailable', message: 'Synthetic upstream unavailable' }))
    req.pipe(proxy)
  } catch (error) {
    json(res, 500, { code: 'fixture_error', message: error.message })
  }
})
server.listen(port, '127.0.0.1', () => process.stdout.write(`Meetings synthetic fixture on ${port}\n`))
function stop() { upstream.kill('SIGTERM'); server.close(() => process.exit(0)) }
process.on('SIGTERM', stop)
process.on('SIGINT', stop)
