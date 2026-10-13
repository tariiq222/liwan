#!/usr/bin/env node
// Pass-through in front of the shared mock API for the my-tasks specs. Nuxt renders the first page on
// the server, where Playwright cannot intercept anything, so the identity the server sees must already
// carry the personal tasks application. Only `/api/v1/me` is rewritten (tasks capabilities and the
// `tasks.enabled` feature added) and the ids of `my-tasks-fixtures.mjs` are answered for the first paint;
// every later `/api/v1/my-tasks/**` call is faked in the browser with `page.route`.
//
//   MOCK_PORT=4303 PROJECTS_UI_PREVIEW=1 MODULE_UI_PREVIEW=1 node e2e/internal-ui-audit-mock.mjs
//   UPSTREAM_PORT=4303 PORT=4313 node e2e/my-tasks-upstream.mjs
//   NUXT_ODOO_URL=http://127.0.0.1:4313 ... npx nuxt dev --port 4203
import http from 'node:http'
import { CONVERT_TARGETS, SSR_COMMENTS, SSR_TASKS } from './my-tasks-fixtures.mjs'

const PORT = Number(process.env.PORT || 4313)
const UPSTREAM = { host: '127.0.0.1', port: Number(process.env.UPSTREAM_PORT || 4303) }
const TASKS_CAPABILITIES = ['tasks.tasks.read', 'tasks.tasks.create', 'tasks.tasks.write']

function addTasks(me) {
  const platform = me.platform ? {
    ...me.platform,
    readable_features: [...new Set([...me.platform.readable_features, 'tasks.enabled'])],
    writable_features: [...new Set([...me.platform.writable_features, 'tasks.enabled'])],
  } : me.platform
  return {
    ...me,
    capabilities: [...new Set([...me.capabilities, ...TASKS_CAPABILITIES])],
    modules: [...new Set([...(me.modules ?? []), 'nasq_tasks'])],
    entitlements: { ...me.entitlements, 'tasks.enabled': true },
    platform,
  }
}

function serverRendered(req) {
  if (req.method !== 'GET') return null
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
  const upstream = http.request({ ...UPSTREAM, method: req.method, path: req.url, headers: req.headers }, (answer) => {
    const path = (req.url ?? '').split('?')[0]
    if (req.method !== 'GET' || path !== '/api/v1/me' || answer.statusCode !== 200) {
      res.writeHead(answer.statusCode ?? 502, answer.headers)
      answer.pipe(res)
      return
    }
    const chunks = []
    answer.on('data', chunk => chunks.push(chunk))
    answer.on('end', () => {
      const body = JSON.stringify(addTasks(JSON.parse(Buffer.concat(chunks).toString('utf8'))))
      const headers = { ...answer.headers, 'content-length': Buffer.byteLength(body) }
      delete headers['content-encoding']
      res.writeHead(200, headers)
      res.end(body)
    })
  })
  upstream.on('error', () => { res.writeHead(502); res.end() })
  req.pipe(upstream)
}).listen(PORT, '127.0.0.1', () => console.log(`my-tasks upstream on ${PORT} -> ${UPSTREAM.port}`))
