import { expect, type Page, type Route } from '@playwright/test'
import { ADMIN, SARA, CONVERT_TARGETS, SSR_COMMENTS, SSR_TASKS, closedActions, openActions, personalTask } from '../my-tasks-fixtures.mjs'

type Json = Record<string, any>
interface Call { method: string; path: string; body: Json | null }

export async function login(page: Page) {
  await page.goto('/login')
  await expect(page.getByRole('button', { name: 'دخول', exact: true })).toBeEnabled()
  await page.getByLabel('اسم المستخدم').fill('admin')
  await page.getByLabel('كلمة المرور', { exact: true }).fill('admin')
  await page.getByRole('button', { name: 'دخول', exact: true }).click()
  await expect(page).not.toHaveURL(/\/login/)
}

const PEOPLE = [ADMIN, SARA]
const ENVELOPE = (items: unknown[]) => ({ items, total: items.length })

// A small stateful fake of the personal task API, starting from the shared fixtures.
export async function fakeApi(page: Page, options: { convertHref?: string; writeDelayMs?: number } = {}) {
  const tasks = new Map<number, Json>(Object.entries(SSR_TASKS).map(([id, task]) => [Number(id), structuredClone(task) as Json]))
  const commentRows = new Map<number, Json[]>(Object.entries(SSR_COMMENTS).map(([id, rows]) => [Number(id), structuredClone(rows) as Json[]]))
  const attachmentRows = new Map<number, Json[]>()
  const rowsOf = (map: Map<number, Json[]>, id: number) => map.get(id) ?? map.set(id, []).get(id)!
  const calls: Call[] = []
  let nextId = 100
  const reply = (route: Route, status: number, body: unknown) =>
    route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(body) })
  const notFound = (route: Route) => reply(route, 404, { code: 'not_found', message: 'not found' })

  await page.route('**/api/v1/people**', route => reply(route, 200, PEOPLE))
  await page.route(/\/api\/v1\/my-tasks(\/|\?|$)/, async (route) => {
    const request = route.request()
    const url = new URL(request.url())
    const method = request.method()
    const path = url.pathname.replace('/api/v1/my-tasks', '') || '/'
    const body = request.postData() ? JSON.parse(request.postData()!) : null
    calls.push({ method, path, body })
    // A slow server keeps the first write in flight while a second one is attempted.
    if (method !== 'GET' && options.writeDelayMs) await new Promise(resolve => setTimeout(resolve, options.writeDelayMs))

    if (path === '/' && method === 'GET') return reply(route, 200, ENVELOPE([]))
    if (path === '/' && method === 'POST') {
      const parent = tasks.get(body.parent_id)
      const created = personalTask(nextId++, { name: body.name, is_subtask: Boolean(parent), parent: parent ? { id: parent.id, name: parent.name } : null })
      tasks.set(created.id, created)
      if (parent) parent.subtasks.push({ id: created.id, name: created.name, state: 'open' })
      return reply(route, 201, created)
    }
    if (path === '/convert-targets') {
      const q = url.searchParams.get('q') ?? ''
      return reply(route, 200, ENVELOPE(CONVERT_TARGETS.filter(p => p.name.includes(q))))
    }
    const match = /^\/(\d+)(?:\/([a-z]+)(?:\/(\d+))?)?$/.exec(path)
    const task = match ? tasks.get(Number(match[1])) : undefined
    if (!match || !task) return notFound(route)
    const [, , action, itemId] = match
    if (!action && method === 'GET') return reply(route, 200, task)
    if (!action && method === 'PATCH') {
      Object.assign(task, body, body.assignees ? { assignees: body.assignees.map((id: number) => PEOPLE.find(p => p.id === id)) } : {})
      if ('date_deadline' in body && body.date_deadline) task.date_deadline = `${body.date_deadline}T00:00:00Z`
      return reply(route, 200, task)
    }
    if (method === 'POST' && ['done', 'reopen', 'cancel'].includes(action ?? '')) {
      task.state = action === 'reopen' ? 'open' : action === 'done' ? 'done' : 'cancelled'
      task.allowed_actions = action === 'reopen' ? openActions() : closedActions()
      for (const parent of tasks.values()) {
        const row = parent.subtasks.find((sub: Json) => sub.id === task.id)
        if (row) row.state = task.state
      }
      return reply(route, 200, task)
    }
    const comments = rowsOf(commentRows, task.id)
    const attachments = rowsOf(attachmentRows, task.id)
    if (action === 'comments' && method === 'GET') return reply(route, 200, ENVELOPE(comments))
    if (action === 'comments' && method === 'POST') {
      const row = { id: nextId++, body: body.body, author: ADMIN, created_at: '2026-10-13T10:00:00Z' }
      comments.push(row)
      return reply(route, 201, row)
    }
    if (action === 'attachments' && method === 'GET') return reply(route, 200, ENVELOPE(attachments))
    if (action === 'attachments' && method === 'POST') {
      const id = nextId++
      const row = { id, name: body.name, mimetype: body.mimetype ?? 'text/plain', url: `/api/v1/my-tasks/${task.id}/attachments/${id}/download` }
      attachments.push(row)
      task.attachment_count = attachments.length
      return reply(route, 201, row)
    }
    if (action === 'attachments' && method === 'DELETE') {
      attachments.splice(attachments.findIndex(row => row.id === Number(itemId)), 1)
      task.attachment_count = attachments.length
      return reply(route, 200, {})
    }
    if (action === 'convert' && method === 'POST') return reply(route, 200, { href: options.convertHref ?? '/projects/1/tasks/9' })
    return notFound(route)
  })
  return { calls, tasks, writes: () => calls.filter(call => call.method !== 'GET') }
}

