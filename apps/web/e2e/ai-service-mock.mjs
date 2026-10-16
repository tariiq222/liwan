#!/usr/bin/env node
// A scripted Nasq AI service for the mock stack: no model, deterministic runs.
// A message containing «مشروع» asks for a project draft (a plain answer when the request's catalog has no draft tool);
// any other message reads the caller's tasks once and answers from the result.
import http from 'node:http'

const PORT = Number(process.env.AI_MOCK_PORT ?? 4499)
const runs = new Map()

function sse(res, events) {
  res.writeHead(200, { 'content-type': 'text/event-stream', 'cache-control': 'no-store' })
  for (const [event, data] of events) res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`)
  res.end()
}
function reply(res, status, body) {
  res.writeHead(status, { 'content-type': 'application/json' })
  res.end(JSON.stringify(body))
}
const readBody = req => new Promise((resolve) => { let b = ''; req.on('data', c => (b += c)); req.on('end', () => resolve(b)) })
const owner = req => `${req.headers['x-nasq-tenant']}|${req.headers['x-nasq-user']}`

function finish(run, text, records) {
  run.pending = null
  run.status = 'done'
  run.messages.push({ role: 'assistant', content: text })
  return [['token', { text: text.slice(0, 5) }], ['answer', { text, records }], ['done', { status: 'done' }]]
}

function start(run, id, message) {
  const hasDraftTool = run.tools.some(tool => tool.name === 'pmo.draft_project' && tool.kind === 'draft')
  if (/مشروع/.test(message)) {
    if (!hasDraftTool) return [['run', { run_id: id }], ...finish(run, 'لا أملك أداة لتجهيز مسودة مشروع لك، فصلاحياتك لا تسمح بإنشاء المشاريع.', [])]
    run.pending = { call_id: `c_${run.messages.length}`, tool: 'pmo.draft_project', kind: 'draft', input: { name: 'بوابة إرادة', charter: { objectives: ['إطلاق البوابة'] } } }
    run.status = 'waiting_user'
    return [['run', { run_id: id }], ['tool_request', { ...run.pending, summary_ar: 'سأجهّز مسودة مشروع', summary_en: 'I will prepare a project draft' }], ['done', { status: 'waiting_user' }]]
  }
  run.pending = { call_id: `c_${run.messages.length}`, tool: 'pmo.list_my_tasks', kind: 'read', input: { limit: 10 } }
  run.status = 'waiting_tool'
  return [['run', { run_id: id }], ['tool_request', { ...run.pending, summary_ar: 'سأقرأ مهامك', summary_en: 'I will read your tasks' }], ['done', { status: 'waiting_tool' }]]
}

function resume(run, id, result) {
  const wasDraft = run.pending.kind === 'draft'
  if (wasDraft) {
    const approved = result.decision === 'approved'
    const records = approved ? [{ type: 'project', id: result.data.id, label: 'بوابة إرادة' }] : []
    return [['run', { run_id: id }], ...finish(run, approved ? 'أُنشئ المشروع بعد اعتمادك.' : 'حسنًا، ألغيت المسودة.', records)]
  }
  if (!result.ok) return [['run', { run_id: id }], ...finish(run, 'لا تملك صلاحية قراءة المهام.', [])]
  const records = result.data.items.slice(0, 3).map(item => ({ type: 'task', id: item.id, label: item.name }))
  return [['run', { run_id: id }], ...finish(run, `عندك ${result.data.total} مهمة، منها «${result.data.items[0]?.name ?? '—'}».`, records)]
}

http.createServer(async (req, res) => {
  const url = new URL(req.url, `http://127.0.0.1:${PORT}`)
  const body = JSON.parse((await readBody(req)) || '{}')
  if (req.method === 'POST' && url.pathname === '/v1/runs') {
    const id = body.run_id ?? `r_${runs.size + 1}`
    const run = runs.get(id) ?? { owner: owner(req), messages: [], pending: null, status: 'running', tools: [] }
    runs.set(id, run)
    run.tools = body.tools ?? run.tools
    run.messages.push({ role: 'user', content: body.message })
    return sse(res, start(run, id, body.message))
  }
  const resumeMatch = url.pathname.match(/^\/v1\/runs\/([^/]+)\/resume$/)
  if (req.method === 'POST' && resumeMatch) {
    const run = runs.get(resumeMatch[1])
    if (!run || run.owner !== owner(req)) return reply(res, 404, {})
    if (!run.pending || run.pending.call_id !== body.call_id) return reply(res, 409, {})
    return sse(res, resume(run, resumeMatch[1], body.result))
  }
  const get = url.pathname.match(/^\/v1\/runs\/([^/]+)$/)
  if (req.method === 'GET' && get) {
    const run = runs.get(get[1])
    if (!run || run.owner !== owner(req)) return reply(res, 404, {})
    return reply(res, 200, { run_id: get[1], status: run.status, messages: run.messages, pending: run.pending })
  }
  if (url.pathname === '/healthz') return reply(res, 200, { ok: true })
  reply(res, 404, {})
}).listen(PORT, '127.0.0.1', () => process.stderr.write(`ai mock on ${PORT}\n`))
