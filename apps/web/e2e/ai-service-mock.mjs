#!/usr/bin/env node
// A scripted LiwanOS AI service for the mock stack: no model, deterministic runs.
// A message containing «مشروع» asks for a project draft (a plain answer when the request's catalog has no draft tool);
// any other message reads the caller's tasks once and answers from the result.
import http from 'node:http'

const PORT = Number(process.env.AI_MOCK_PORT ?? 4499)
const runs = new Map()
let clock = 0
const TITLE_MAX = 60
const titleOf = message => { const text = message.split(/\s+/).filter(Boolean).join(' '); return text.length <= TITLE_MAX ? text : `${text.slice(0, TITLE_MAX - 1)}…` }
// The real service asks the model for a title after the first answer; the mock names a conversation by what it answered.
const generatedTitle = message => (/مشروع/.test(message) ? 'مسودة مشروع' : 'ملخص المهام')
const summary = (run_id, run) => ({ run_id, title: run.title, status: run.status, updated_at: run.updatedAt, archived: run.archived })
// Provider usage the real service reports before every model call (plan) and after the first answer (title); the Nuxt server forwards it to Odoo and never to the browser.
let callSeq = 0
function modelPair(kind, inputTokens, outputTokens) {
  const call_id = (++callSeq).toString(16).padStart(16, '0')
  const called_at = new Date(Date.UTC(2026, 9, 16, 8, 0, ++clock)).toISOString()
  return [
    ['model_call', { call_id, kind, provider: 'mock', model: 'mock-model', called_at }],
    ['model_usage', { call_id, outcome: 'ok', input_tokens: inputTokens, output_tokens: outputTokens }],
  ]
}
const touch = run => { run.updatedAt = new Date(Date.UTC(2026, 9, 16, 8, 0, ++clock)).toISOString() }

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
const owner = req => `${req.headers['x-liwan-tenant']}|${req.headers['x-liwan-user']}`

function finish(run, text, records) {
  run.pending = null
  run.status = 'done'
  run.messages.push({ role: 'assistant', content: text })
  const users = run.messages.filter(message => message.role === 'user')
  if (users.length === 1 && !run.titleLocked) run.title = generatedTitle(users[0].content)
  return [...modelPair('plan', 120, 12), ['token', { text: text.slice(0, 5) }], ['answer', { text, records }], ...(users.length === 1 ? modelPair('title', 40, 4) : []), ['done', { status: 'done' }]]
}

function start(run, id, message) {
  const hasDraftTool = run.tools.some(tool => tool.name === 'pmo.draft_project' && tool.kind === 'draft')
  if (/مشروع/.test(message)) {
    if (!hasDraftTool) return [['run', { run_id: id }], ...finish(run, 'لا أملك أداة لتجهيز مسودة مشروع لك، فصلاحياتك لا تسمح بإنشاء المشاريع.', [])]
    run.pending = { call_id: `c_${run.messages.length}`, tool: 'pmo.draft_project', kind: 'draft', input: { name: 'بوابة إرادة', charter: { objectives: ['إطلاق البوابة'] } } }
    run.status = 'waiting_user'
    return [['run', { run_id: id }], ...modelPair('plan', 90, 20), ['tool_request', { ...run.pending, summary_ar: 'سأجهّز مسودة مشروع', summary_en: 'I will prepare a project draft' }], ['done', { status: 'waiting_user' }]]
  }
  run.pending = { call_id: `c_${run.messages.length}`, tool: 'pmo.list_my_tasks', kind: 'read', input: { limit: 10 } }
  run.status = 'waiting_tool'
  return [['run', { run_id: id }], ...modelPair('plan', 90, 20), ['tool_request', { ...run.pending, summary_ar: 'سأقرأ مهامك', summary_en: 'I will read your tasks' }], ['done', { status: 'waiting_tool' }]]
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
    const id = body.run_id ?? body.new_run_id
    const run = runs.get(id) ?? { owner: owner(req), title: titleOf(body.message), titleLocked: false, archived: false, messages: [], pending: null, status: 'running', tools: [] }
    runs.set(id, run)
    touch(run)
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
  if (req.method === 'GET' && url.pathname === '/v1/runs') {
    const archived = url.searchParams.get('archived') === 'true'
    const mine = [...runs.entries()].filter(([, run]) => run.owner === owner(req) && run.archived === archived).sort(([, a], [, b]) => b.updatedAt.localeCompare(a.updatedAt))
    const items = mine.map(([run_id, run]) => summary(run_id, run))
    return reply(res, 200, { items, total: items.length })
  }
  const get = url.pathname.match(/^\/v1\/runs\/([^/]+)$/)
  if (req.method === 'PATCH' && get) {
    const run = runs.get(get[1])
    if (!run || run.owner !== owner(req)) return reply(res, 404, {})
    const title = typeof body.title === 'string' ? body.title.trim() : undefined
    if ((title === undefined && body.archived === undefined) || (title !== undefined && (title.length < 1 || title.length > 80))) return reply(res, 422, {})
    if (title !== undefined) Object.assign(run, { title, titleLocked: true })
    if (body.archived !== undefined) run.archived = body.archived
    return reply(res, 200, summary(get[1], run))
  }
  if (req.method === 'GET' && get) {
    const run = runs.get(get[1])
    if (!run || run.owner !== owner(req)) return reply(res, 404, {})
    return reply(res, 200, { run_id: get[1], status: run.status, messages: run.messages, pending: run.pending })
  }
  if (url.pathname === '/healthz') return reply(res, 200, { ok: true })
  reply(res, 404, {})
}).listen(PORT, '127.0.0.1', () => process.stderr.write(`ai mock on ${PORT}\n`))
