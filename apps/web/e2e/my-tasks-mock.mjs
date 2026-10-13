// Isolated fixture for the my-tasks e2e specs: the shared audit mock does not know the tasks
// application, so this wrapper runs it on an upstream port and answers `GET /api/v1/me` with the
// tasks feature and capabilities added. Every other request is forwarded untouched; the personal
// task routes themselves are mocked per test with page.route.
//   MOCK_PORT=4301 node apps/web/e2e/my-tasks-mock.mjs
import http from 'node:http'
import { spawn } from 'node:child_process'
import { fileURLToPath } from 'node:url'

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

http.createServer((req, res) => {
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
      res.writeHead(200, headers)
      res.end(body)
    })
  })
  proxied.on('error', () => { res.writeHead(502); res.end() })
  req.pipe(proxied)
}).listen(port, '127.0.0.1', () => console.log(`my-tasks mock listening 127.0.0.1:${port} (upstream ${upstream})`))
