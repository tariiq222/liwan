import { chromium } from '@playwright/test'
import { spawn, type ChildProcess } from 'node:child_process'
import { resolve } from 'node:path'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { DependencyCandidateListSchema, PersonRefSchema, TaskAttachmentListSchema, TaskDetailSchema, TaskListSchema } from '@nasq/contracts'

// An isolated copy can be supplied for patch review. Normal unit runs use the
// actual mock module; every child binds port 0 and is stopped by this harness.
const mockSource = process.env.NASQ_SYNTHETIC_MOCK_SOURCE
  ?? resolve(import.meta.dirname, '../../../e2e/internal-ui-audit-mock.mjs')
const children: ChildProcess[] = []
const bootstrap = `
import http from 'node:http';
import { pathToFileURL } from 'node:url';
const listen = http.Server.prototype.listen;
http.Server.prototype.listen = function(port, host, callback) {
  const server = this;
  return listen.call(this, port, host, () => {
    process.stdout.write(JSON.stringify({ readyPort: server.address().port }) + '\\n');
    callback?.call(server);
  });
};
await import(pathToFileURL(process.env.NASQ_SYNTHETIC_MOCK_SOURCE).href);
`

async function start(modulePreview = '1') {
  const child = spawn(process.execPath, ['--input-type=module', '-e', bootstrap], {
    env: { ...process.env, NASQ_SYNTHETIC_MOCK_SOURCE: mockSource, MOCK_PORT: '0', PROJECTS_UI_PREVIEW: '1', MODULE_UI_PREVIEW: modulePreview },
    stdio: ['ignore', 'pipe', 'pipe'],
  })
  children.push(child)
  const base = await new Promise<string>((resolve, reject) => {
    let output = ''; let errors = ''
    const timer = setTimeout(() => reject(new Error(`mock did not listen: ${errors}`)), 8000)
    child.stderr?.on('data', data => { errors += data })
    child.stdout?.on('data', data => {
      output += data
      const match = output.match(/\{"readyPort":(\d+)\}/)
      if (match) { clearTimeout(timer); resolve(`http://127.0.0.1:${match[1]}`) }
    })
    child.once('exit', code => { clearTimeout(timer); reject(new Error(`mock exited ${code}: ${errors}`)) })
  })
  const auth = await fetch(`${base}/web/session/authenticate`, {
    method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ params: { db: 'nasq_ui_mock_only', login: 'admin', password: 'admin' } }),
  })
  const cookie = auth.headers.get('set-cookie')!.split(';')[0]!
  return { base, cookie, get: (path: string) => fetch(`${base}${path}`, { headers: { cookie } }) }
}

afterAll(async () => {
  await Promise.all(children.map(child => new Promise<void>(resolve => {
    if (child.exitCode !== null) return resolve()
    child.once('exit', () => resolve()); child.kill('SIGTERM')
  })))
})

describe('synthetic task reads and bounded HR avatar assets', () => {
  let mock: Awaited<ReturnType<typeof start>>
  beforeAll(async () => { mock = await start() }, 15000)

  it('uses the winning people fixture name in task list and detail without changing the auth identity', async () => {
    const people = PersonRefSchema.array().parse(await (await mock.get('/api/v1/people')).json())
    const task = TaskDetailSchema.parse(await (await mock.get('/api/v1/tasks/101')).json())
    const list = TaskListSchema.parse(await (await mock.get('/api/v1/tasks')).json())
    expect(task.assignees[0]).toEqual({ id: 2, name: 'نورة الحربي' })
    expect(people.find(person => person.id === 2)?.name).toBe(task.assignees[0]!.name)
    expect(list.items.find(item => item.id === 101)?.assignees).toEqual(task.assignees)
    const me = await (await mock.get('/api/v1/me')).json()
    expect({ id: me.id, name: me.name, login: me.login }).toEqual({ id: 2, name: 'Admin', login: 'admin' })
  })

  it('keeps the project-only people priority when module preview is disabled', async () => {
    const projectOnly = await start('0')
    const people = PersonRefSchema.array().parse(await (await projectOnly.get('/api/v1/people')).json())
    const task = TaskDetailSchema.parse(await (await projectOnly.get('/api/v1/tasks/101')).json())
    expect(task.assignees[0]).toEqual({ id: 2, name: 'مدير المشروع' })
    expect(people.find(person => person.id === 2)?.name).toBe(task.assignees[0]!.name)
  })

  it('returns the task detail attachment collection with the actual list contract', async () => {
    const response = await mock.get('/api/v1/tasks/101/attachments')
    expect(response.status).toBe(200)
    const attachments = TaskAttachmentListSchema.parse(await response.json())
    const detail = TaskDetailSchema.parse(await (await mock.get('/api/v1/tasks/101')).json())
    expect(attachments).toEqual({ items: detail.attachments, total: detail.attachments.length })
  })

  it('derives dependency candidates from other tasks in the owning project', async () => {
    const response = await mock.get('/api/v1/tasks/101/dependencies/candidates?limit=50&offset=0')
    expect(response.status).toBe(200)
    const candidates = DependencyCandidateListSchema.parse(await response.json())
    expect(candidates.total).toBe(3)
    expect(candidates.items.map(item => item.id).sort()).toEqual([102, 103, 104])
    expect(candidates.items.find(item => item.id === 102)).toEqual({ id: 102, name: 'مهمة تحتاج تعديلاً', state: 'changes_requested' })
  })

  it('searches and pages candidates while retaining the filtered total', async () => {
    const searched = DependencyCandidateListSchema.parse(await (await mock.get('/api/v1/tasks/101/dependencies/candidates?q=تحتاج')).json())
    expect(searched).toEqual({ items: [{ id: 102, name: 'مهمة تحتاج تعديلاً', state: 'changes_requested' }], total: 1 })
    const paged = DependencyCandidateListSchema.parse(await (await mock.get('/api/v1/tasks/101/dependencies/candidates?limit=1&offset=1')).json())
    expect(paged.items).toHaveLength(1)
    expect(paged.total).toBe(3)
    const unlimited = DependencyCandidateListSchema.parse(await (await mock.get('/api/v1/tasks/101/dependencies/candidates?limit=0')).json())
    expect(unlimited.items).toHaveLength(3)
    expect(unlimited.total).toBe(3)
  })

  it('leaves unknown task reads as 404 and does not turn the reads into mutation endpoints', async () => {
    for (const suffix of ['attachments', 'dependencies/candidates']) {
      expect((await mock.get(`/api/v1/tasks/999/${suffix}`)).status).toBe(404)
      expect((await fetch(`${mock.base}/api/v1/tasks/101/${suffix}`, { method: 'POST', headers: { cookie: mock.cookie } })).status).toBe(404)
    }
  })

  it('serves deterministic local SVG avatars only for known fixture employees 1 and 3', async () => {
    const avatar1 = await mock.get('/web/image/hr.employee/1/avatar_128')
    const avatar3 = await mock.get('/web/image/hr.employee/3/avatar_128')
    expect(avatar1.status).toBe(200)
    expect(avatar3.status).toBe(200)
    expect(avatar1.headers.get('content-type')).toContain('image/svg+xml')
    const body = await avatar1.text()
    expect(body).toContain('xmlns="http://www.w3.org/2000/svg"')
    expect(body).toContain('width="128" height="128"')
    expect(await avatar3.text()).toBe(body)
    const browser = await chromium.launch()
    try {
      const context = await browser.newContext()
      const [name, value] = mock.cookie.split('=')
      await context.addCookies([{ name: name!, value: value!, url: mock.base }])
      const page = await context.newPage()
      await page.goto(`${mock.base}/api/v1/branding`)
      await page.setContent('<img id="avatar">')
      const dimensions = await page.evaluate(url => new Promise<{ width: number; height: number }>((resolve, reject) => {
        const image = document.querySelector<HTMLImageElement>('#avatar')!
        image.onload = () => resolve({ width: image.naturalWidth, height: image.naturalHeight })
        image.onerror = () => reject(new Error('fixture SVG did not decode'))
        image.src = url
      }), `${mock.base}/web/image/hr.employee/1/avatar_128`)
      expect(dimensions).toEqual({ width: 128, height: 128 })
    }
    finally { await browser.close() }

    expect((await mock.get('/web/image/hr.employee/2/avatar_128')).status).toBe(404)
    expect((await mock.get('/web/image/hr.employee/999/avatar_128')).status).toBe(404)
  })
})
