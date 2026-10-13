import { expect, test, type Page, type Route } from '@playwright/test'
import { ADMIN, SARA, CONVERT_TARGETS, SSR_COMMENTS, SSR_TASKS, closedActions, openActions, personalTask } from './my-tasks-fixtures.mjs'

// Isolated stack only (apps/web/e2e/my-tasks-upstream.mjs in front of internal-ui-audit-mock.mjs):
//   E2E_MY_TASKS=1 E2E_BASE_URL=http://localhost:<nuxt> npx playwright test e2e/my-tasks-detail.spec.ts
// The first paint is served by the upstream's fixtures; every browser call to /api/v1/my-tasks is faked here.
test.skip(process.env.E2E_MY_TASKS !== '1', 'Requires the isolated my-tasks upstream (see header)')
test.describe.configure({ timeout: 45_000 })

type Json = Record<string, any>
interface Call { method: string; path: string; body: Json | null }

async function login(page: Page) {
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
async function fakeApi(page: Page, options: { convertHref?: string } = {}) {
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

    if (path === '/' && method === 'GET') return reply(route, 200, ENVELOPE([]))
    if (path === '/' && method === 'POST') {
      const parent = tasks.get(body.parent_id)
      const created = personalTask(nextId++, { name: body.name, parent: parent ? { id: parent.id, name: parent.name } : null })
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
      const row = { id: nextId++, name: body.name, mimetype: body.mimetype ?? 'text/plain', url: `/web/content/${nextId}?download=true` }
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

test.beforeEach(async ({ page }) => { await login(page) })

test('detail renders and the inline edit PATCHes exactly the changed fields once', async ({ page }) => {
  const api = await fakeApi(page)
  await page.goto('/my-tasks/7')
  await expect(page.getByRole('heading', { name: 'اشترِ الورق', level: 1 })).toBeVisible()
  await expect(page.getByTestId('my-task-state')).toHaveText('مفتوحة')
  await expect(page.getByText('ورق A4 للطابعة')).toBeVisible()

  await page.getByRole('button', { name: 'تعديل', exact: true }).click()
  await page.getByLabel('عنوان المهمة', { exact: true }).fill('اشترِ ورقًا ملونًا')
  await page.getByRole('combobox', { name: 'الأولوية', exact: true }).click()
  await page.getByRole('option', { name: 'عالية' }).click()
  await page.getByRole('button', { name: 'حفظ التغييرات' }).click()

  await expect(page.getByRole('heading', { name: 'اشترِ ورقًا ملونًا', level: 1 })).toBeVisible()
  const patches = api.writes().filter(call => call.method === 'PATCH')
  expect(patches).toHaveLength(1)
  expect(patches[0]!.body).toEqual({ name: 'اشترِ ورقًا ملونًا', priority: 'high' })
  await expect(page.getByTestId('my-task-priority')).toHaveText('عالية')
})

test('clearing the deadline sends null and an empty edit sends nothing', async ({ page }) => {
  const api = await fakeApi(page)
  await page.goto('/my-tasks/7')
  await page.getByRole('button', { name: 'تعديل', exact: true }).click()
  await page.getByRole('button', { name: 'حفظ التغييرات' }).click()
  await expect(page.getByRole('button', { name: 'تعديل', exact: true })).toBeVisible()
  expect(api.writes()).toHaveLength(0)

  await page.getByRole('button', { name: 'تعديل', exact: true }).click()
  await page.getByRole('button', { name: /الموعد النهائي/ }).click()
  await page.getByRole('button', { name: 'مسح التاريخ' }).click()
  await page.getByRole('button', { name: 'حفظ التغييرات' }).click()
  await expect(page.getByTestId('my-task-deadline')).toHaveText('بلا موعد')
  expect(api.writes().map(call => call.body)).toEqual([{ date_deadline: null }])
})

test('a field error from the server is shown next to the field', async ({ page }) => {
  await fakeApi(page)
  await page.route('**/api/v1/my-tasks/7', async (route) => {
    if (route.request().method() !== 'PATCH') return route.fallback()
    await route.fulfill({ status: 422, contentType: 'application/json', body: JSON.stringify({ code: 'invalid', message: 'العنوان طويل جدًا', field: 'name' }) })
  })
  await page.goto('/my-tasks/7')
  await page.getByRole('button', { name: 'تعديل', exact: true }).click()
  await page.getByLabel('عنوان المهمة', { exact: true }).fill('عنوان جديد')
  await page.getByRole('button', { name: 'حفظ التغييرات' }).click()
  await expect(page.getByText('العنوان طويل جدًا')).toBeVisible()
})

test('mark done follows the server answer and reopen becomes available', async ({ page }) => {
  const api = await fakeApi(page)
  await page.goto('/my-tasks/7')
  await expect(page.getByRole('button', { name: 'إعادة فتح', exact: true })).toHaveCount(0)
  await page.getByRole('button', { name: 'إنجاز', exact: true }).click()
  await expect(page.getByTestId('my-task-state')).toHaveText('منجزة')
  await expect(page.getByRole('button', { name: 'إنجاز', exact: true })).toHaveCount(0)
  await expect(page.getByRole('button', { name: 'إعادة فتح', exact: true })).toBeVisible()
  expect(api.writes().map(call => call.path)).toEqual(['/7/done'])

  await page.getByRole('button', { name: 'إعادة فتح', exact: true }).click()
  await expect(page.getByTestId('my-task-state')).toHaveText('مفتوحة')
  await expect(page.getByRole('button', { name: 'إنجاز', exact: true })).toBeVisible()
})

test('cancel asks inline first and sends nothing until confirmed', async ({ page }) => {
  const api = await fakeApi(page)
  await page.goto('/my-tasks/7')
  await page.getByRole('button', { name: 'إلغاء المهمة', exact: true }).click()
  const confirm = page.getByTestId('inline-confirm')
  await expect(confirm).toContainText('إلغاء هذه المهمة؟')
  await expect(page.getByRole('dialog')).toHaveCount(0)
  expect(api.writes()).toHaveLength(0)

  await confirm.getByRole('button', { name: 'إبقاء المهمة' }).click()
  await expect(confirm).toHaveCount(0)
  expect(api.writes()).toHaveLength(0)

  await page.getByRole('button', { name: 'إلغاء المهمة', exact: true }).click()
  await page.getByTestId('inline-confirm-action').click()
  await expect(page.getByTestId('my-task-state')).toHaveText('ملغاة')
  expect(api.writes().map(call => call.path)).toEqual(['/7/cancel'])
})

test('sub-tasks: add by name and toggle done; a sub-task page links to its parent and has no sub-tasks', async ({ page }) => {
  const api = await fakeApi(page)
  await page.goto('/my-tasks/7')
  const section = page.getByTestId('my-task-subtasks')
  await expect(section.getByRole('link', { name: 'اطبع القائمة' })).toHaveAttribute('href', /\/my-tasks\/11/)

  await section.getByLabel('عنوان المهمة الفرعية').fill('اطلب الحبر')
  await section.getByRole('button', { name: 'إضافة مهمة فرعية' }).click()
  await expect(section.getByRole('link', { name: 'اطلب الحبر' })).toBeVisible()
  expect(api.writes()[0]).toEqual({ method: 'POST', path: '/', body: { name: 'اطلب الحبر', parent_id: 7 } })

  await section.getByRole('button', { name: /إنجاز/ }).first().click()
  await expect(section.getByRole('button', { name: /إعادة فتح/ })).toHaveCount(1)
  expect(api.writes().map(call => call.path)).toContain('/11/done')

  await page.goto('/my-tasks/10')
  await expect(page.getByRole('heading', { name: 'اطبع القائمة', level: 1 })).toBeVisible()
  await expect(page.getByRole('link', { name: 'اشترِ الورق' })).toHaveAttribute('href', /\/my-tasks\/7/)
  await expect(page.getByTestId('my-task-subtasks')).toHaveCount(0)
})

test('comments: post plain text, oldest first, unknown author gets a neutral label', async ({ page }) => {
  const api = await fakeApi(page)
  await page.goto('/my-tasks/12')
  const section = page.getByTestId('my-task-comments')
  await expect(section.getByText('تعليق قديم <b>نص</b>')).toBeVisible()
  await expect(section.getByText('مستخدم غير معروف')).toBeVisible()

  const post = section.getByRole('button', { name: 'نشر التعليق' })
  await expect(post).toBeDisabled()
  await section.getByLabel('اكتب تعليقًا').fill('تم الاتفاق مع المورّد')
  await post.click()
  await expect(section.getByText('تم الاتفاق مع المورّد')).toBeVisible()
  await expect(section.getByLabel('اكتب تعليقًا')).toHaveValue('')
  const items = section.getByRole('listitem')
  await expect(items.first()).toContainText('تعليق قديم')
  await expect(items.last()).toContainText('تم الاتفاق مع المورّد')
  expect(api.writes()).toEqual([{ method: 'POST', path: '/12/comments', body: { body: 'تم الاتفاق مع المورّد' } }])
})

test('attachments: upload, download link, delete only after the inline confirmation', async ({ page }) => {
  const api = await fakeApi(page)
  await page.goto('/my-tasks/7')
  const section = page.getByTestId('my-task-attachments')
  await expect(section.getByText('لا توجد مرفقات')).toBeVisible()

  await expect(section.getByRole('button', { name: 'إضافة مرفق' })).toBeEnabled()
  await section.locator('input[type=file]').setInputFiles({ name: 'ملاحظات.txt', mimeType: 'text/plain', buffer: Buffer.from('hello') })
  const link = section.getByRole('link', { name: 'ملاحظات.txt' })
  await expect(link).toBeVisible()
  await expect(link).toHaveAttribute('href', /\/web\/content\//)
  await expect(section).toContainText('1 مرفق')
  const upload = api.writes()[0]!
  expect(upload.path).toBe('/7/attachments')
  expect(upload.body).toEqual({ name: 'ملاحظات.txt', mimetype: 'text/plain', data: Buffer.from('hello').toString('base64') })

  await section.getByRole('button', { name: 'حذف المرفق' }).click()
  await expect(section.getByTestId('inline-confirm')).toContainText('حذف هذا المرفق نهائيًا؟')
  expect(api.writes().filter(call => call.method === 'DELETE')).toHaveLength(0)
  await section.getByTestId('inline-confirm-action').click()
  await expect(section.getByText('لا توجد مرفقات')).toBeVisible()
  expect(api.writes().filter(call => call.method === 'DELETE')).toHaveLength(1)
})

test('attachments: a wrong type or an oversized file is refused before any request', async ({ page }) => {
  const api = await fakeApi(page)
  await page.goto('/my-tasks/7')
  const section = page.getByTestId('my-task-attachments')
  await expect(section.getByRole('button', { name: 'إضافة مرفق' })).toBeEnabled()
  await section.locator('input[type=file]').setInputFiles({ name: 'virus.exe', mimeType: 'application/octet-stream', buffer: Buffer.from('x') })
  await expect(section.getByRole('alert')).toContainText('نوع الملف غير مسموح')
  await section.locator('input[type=file]').setInputFiles({ name: 'big.pdf', mimeType: 'application/pdf', buffer: Buffer.alloc(10 * 1024 * 1024 + 1) })
  await expect(section.getByRole('alert')).toContainText('10 ميغابايت')
  expect(api.writes()).toHaveLength(0)
})

test('convert panel: hidden without the permission, otherwise search, confirm and go to the server href', async ({ page }) => {
  const api = await fakeApi(page, { convertHref: '/projects/1/tasks/9' })
  await page.goto('/my-tasks/7')
  await expect(page.getByRole('heading', { name: 'اشترِ الورق', level: 1 })).toBeVisible()
  await expect(page.getByTestId('my-task-convert')).toHaveCount(0)

  await page.goto('/my-tasks/8')
  const panel = page.getByTestId('my-task-convert')
  await expect(panel).toBeVisible()
  await panel.getByRole('button', { name: 'المشروع' }).click()
  await page.getByPlaceholder('ابحث عن مشروع').fill('الأتمتة')
  await page.getByRole('option', { name: 'مشروع الأتمتة' }).click()
  await panel.getByRole('button', { name: 'تحويل المهمة' }).click()
  await expect(panel.getByTestId('inline-confirm')).toContainText('لا يمكن التراجع عن هذا التحويل.')
  expect(api.writes()).toHaveLength(0)
  await panel.getByTestId('inline-confirm-action').click()
  await expect(page).toHaveURL(/\/projects\/1\/tasks\/9$/)
  expect(api.writes()).toEqual([{ method: 'POST', path: '/8/convert', body: { project_id: 1 } }])
})

test('an unknown or foreign task shows the not-found state', async ({ page }) => {
  await fakeApi(page)
  await page.goto('/my-tasks/999')
  await expect(page.getByText('هذه المهمة غير موجودة أو لا تملك صلاحية عرضها.')).toBeVisible({ timeout: 15_000 })
  await expect(page.getByRole('link', { name: 'العودة إلى مهامي' })).toHaveAttribute('href', '/my-tasks')
})

test('the back link honours a safe returnTo and ignores an unsafe one', async ({ page }) => {
  await fakeApi(page)
  await page.goto('/my-tasks/7?returnTo=%2Fmy-tasks%3Ftab%3Ddone%26q%3Dx')
  await expect(page.getByRole('link', { name: 'العودة إلى مهامي' })).toHaveAttribute('href', '/my-tasks?tab=done&q=x')
  await page.goto('/my-tasks/7?returnTo=https%3A%2F%2Fevil.example')
  await expect(page.getByRole('link', { name: 'العودة إلى مهامي' })).toHaveAttribute('href', '/my-tasks')
})

test('first-click safety: every action is disabled until hydration, then the first click lands', async ({ page }) => {
  const api = await fakeApi(page)
  let resume!: () => void
  const gate = new Promise<void>(resolve => { resume = resolve })
  await page.route('**/_nuxt/**', async (route) => {
    if (route.request().resourceType() === 'script') await gate
    await route.continue()
  })
  await page.goto('/my-tasks/7', { waitUntil: 'commit' })
  const done = page.getByRole('button', { name: 'إنجاز', exact: true })
  const cancel = page.getByRole('button', { name: 'إلغاء المهمة', exact: true })
  const edit = page.getByRole('button', { name: 'تعديل', exact: true })
  const post = page.getByTestId('my-task-comments').getByRole('button', { name: 'نشر التعليق' })
  await expect(done).toBeVisible()
  for (const control of [done, cancel, edit, post]) await expect(control).toBeDisabled()
  resume()
  await expect(done).toBeEnabled()
  await done.click()
  await expect(page.getByTestId('my-task-state')).toHaveText('منجزة')
  expect(api.writes().map(call => call.path)).toEqual(['/7/done'])
})

// Visual proof only: E2E_MY_TASKS_SHOTS=<absolute dir> writes the screenshots, otherwise skipped.
test('screenshots of the detail page (desktop and mobile, RTL)', async ({ page }) => {
  test.skip(!process.env.E2E_MY_TASKS_SHOTS, 'set E2E_MY_TASKS_SHOTS to a directory')
  const dir = process.env.E2E_MY_TASKS_SHOTS!
  await fakeApi(page)
  for (const [name, size] of [['desktop', { width: 1440, height: 900 }], ['mobile', { width: 390, height: 844 }]] as const) {
    await page.setViewportSize(size)
    await page.goto('/my-tasks/7')
    await expect(page.getByRole('button', { name: 'إنجاز', exact: true })).toBeEnabled()
    await page.screenshot({ path: `${dir}/detail-open-${name}.png`, fullPage: true })
    await page.getByRole('button', { name: 'إلغاء المهمة', exact: true }).click()
    await expect(page.getByTestId('inline-confirm')).toBeVisible()
    await page.screenshot({ path: `${dir}/detail-cancel-confirm-${name}.png`, fullPage: true })
    await page.goto('/my-tasks/9')
    await expect(page.getByRole('button', { name: 'إعادة فتح', exact: true })).toBeEnabled()
    await page.screenshot({ path: `${dir}/detail-done-${name}.png`, fullPage: true })
    await page.goto('/my-tasks/8')
    await expect(page.getByRole('button', { name: 'المشروع' })).toBeEnabled()
    await page.getByRole('button', { name: 'المشروع' }).click()
    await page.getByRole('option', { name: 'مشروع الأتمتة' }).click()
    await page.getByRole('button', { name: 'تحويل المهمة' }).click()
    await expect(page.getByTestId('my-task-convert').getByTestId('inline-confirm')).toBeVisible()
    await page.screenshot({ path: `${dir}/detail-convert-${name}.png`, fullPage: true })
    await page.goto('/my-tasks/7')
    await page.getByRole('button', { name: 'تعديل', exact: true }).click()
    await expect(page.getByRole('button', { name: 'حفظ التغييرات' })).toBeEnabled()
    await page.screenshot({ path: `${dir}/detail-edit-${name}.png`, fullPage: true })
  }
})
