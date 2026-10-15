// Isolated fixture for the my-tasks e2e specs (list, new, detail): the shared audit mock does not know
// the tasks application, so this wrapper runs it on an upstream port (MOCK_PORT + 1000) and answers
// `GET /api/v1/me` with the tasks feature and capabilities added. Nuxt renders the first paint on the
// server, where Playwright cannot intercept anything, so the detail page's first paint
// (`/api/v1/my-tasks/<id>`, its comments and attachments, and `/convert-targets`) is answered here from
// `my-tasks-fixtures.mjs`. Every other request is forwarded untouched; all later browser calls to the
// personal task routes are mocked per test with page.route.
//   MOCK_PORT=4301 node apps/web/e2e/my-tasks-mock.mjs
import http from 'node:http'
import { spawn } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { CONVERT_TARGETS, SSR_COMMENTS, SSR_LIST, SSR_TASKS } from './my-tasks-fixtures.mjs'

const port = Number(process.env.MOCK_PORT ?? 4301)
const upstream = port + 1000
const script = fileURLToPath(new URL('./internal-ui-audit-mock.mjs', import.meta.url))
const child = spawn(process.execPath, [script], {
  env: { ...process.env, PROJECTS_UI_PREVIEW: '1', MODULE_UI_PREVIEW: '1', MOCK_PORT: String(upstream) },
  stdio: 'inherit',
})
for (const signal of ['SIGINT', 'SIGTERM']) process.on(signal, () => { child.kill(); process.exit(0) })
child.on('exit', () => process.exit(0))

const capabilities = ['tasks.tasks.read', 'tasks.tasks.create', 'tasks.tasks.write', 'tasks.tasks.approve']

function withTasks(me) {
  const features = [...new Set([...(me.platform?.readable_features ?? []), 'tasks.enabled'])]
  return {
    ...me,
    capabilities: [...new Set([...(me.capabilities ?? []), ...capabilities])],
    modules: [...new Set([...(me.modules ?? []), 'nasq_tasks'])],
    entitlements: { ...me.entitlements, 'tasks.enabled': true },
    platform: { ...me.platform, readable_features: features, writable_features: features },
  }
}

// Only GETs the server issues while rendering `/my-tasks/<id>`; anything else goes upstream.
function serverRendered(req) {
  if (req.method !== 'GET') return null
  const url = new URL(req.url, 'http://localhost')
  if (url.pathname === '/api/v1/my-tasks') {
    const q = (url.searchParams.get('q') ?? '').trim().toLocaleLowerCase()
    const rows = SSR_LIST.filter(row => (row.state !== 'open') === (url.searchParams.get('closed') === '1') && (!q || row.name.toLocaleLowerCase().includes(q)))
    const offset = Number(url.searchParams.get('offset') ?? 0)
    const limit = Number(url.searchParams.get('limit') ?? 50)
    return { items: rows.slice(offset, offset + limit), total: rows.length }
  }
  if (req.url === '/api/v1/my-tasks/convert-targets') return { items: CONVERT_TARGETS, total: CONVERT_TARGETS.length }
  const match = /^\/api\/v1\/my-tasks\/(\d+)(\/comments|\/attachments)?(?:\?.*)?$/.exec(req.url ?? '')
  const task = match && SSR_TASKS[match[1]]
  if (!task) return null
  if (match[2] === '/comments') return { items: SSR_COMMENTS[match[1]] ?? [], total: (SSR_COMMENTS[match[1]] ?? []).length }
  return match[2] ? { items: [], total: 0 } : task
}

http.createServer((req, res) => {
  const fixture = serverRendered(req)
  if (fixture) {
    res.writeHead(200, { 'content-type': 'application/json' })
    res.end(JSON.stringify(fixture))
    return
  }
  const proxied = http.request({ host: '127.0.0.1', port: upstream, path: req.url, method: req.method, headers: req.headers }, upstreamRes => {
    const isMe = req.method === 'GET' && new URL(req.url, 'http://x').pathname === '/api/v1/me' && upstreamRes.statusCode === 200
    if (!isMe) {
      res.writeHead(upstreamRes.statusCode ?? 502, upstreamRes.headers)
      upstreamRes.pipe(res)
      return
    }
    const chunks = []
    upstreamRes.on('data', chunk => chunks.push(chunk))
    upstreamRes.on('end', () => {
      const body = JSON.stringify(withTasks(JSON.parse(Buffer.concat(chunks).toString('utf8'))))
      const headers = { ...upstreamRes.headers, 'content-length': Buffer.byteLength(body) }
      // The body was re-encoded: a chunked upstream must not also announce a length.
      delete headers['transfer-encoding']
      res.writeHead(200, headers)
      res.end(body)
    })
  })
  proxied.on('error', () => { res.writeHead(502); res.end() })
  req.pipe(proxied)
}).listen(port, '127.0.0.1', () => console.log(`my-tasks mock listening 127.0.0.1:${port} (upstream ${upstream})`))
