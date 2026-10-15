import { expect, test, type Page } from '@playwright/test'

// Runs against the isolated wrapper `MOCK_PORT=<port> node apps/web/e2e/my-tasks-mock.mjs` with
// E2E_MY_TASKS=1: the login and `/me` come from e2e/my-tasks-mock.mjs (the shared audit mock plus the tasks capabilities); the personal task
// routes are mocked per test with page.route, so nothing here needs Odoo.
test.skip(process.env.E2E_MY_TASKS !== '1', 'Requires the isolated e2e/my-tasks-mock.mjs server')
test.describe.configure({ timeout: 60_000 })

const PERSON = { id: 5, name: 'نورة الحربي', user_id: 5 }
const CREATED = {
  id: 42, name: 'كتابة التقرير', description: '', state: 'open', priority: 'normal', date_deadline: null,
  assignees: [], creator: { id: 2, name: 'Admin', user_id: 2 }, parent: null, is_subtask: false, subtasks: [], attachment_count: 0,
  created_at: '2026-10-13T08:00:00Z', updated_at: '2026-10-13T08:00:00Z',
  allowed_actions: { write: true, done: true, reopen: false, cancel: true, convert: true },
}

async function beforeHydration(page: Page, path: string) {
  let resume!: () => void
  const gate = new Promise<void>(resolve => { resume = resolve })
  await page.route('**/_nuxt/**', async route => {
    if (route.request().resourceType() === 'script') await gate
    await route.continue()
  })
  await page.goto(path, { waitUntil: 'commit' })
  return resume
}

async function login(page: Page) {
  await page.goto('/login')
  await expect(page.getByRole('button', { name: 'دخول', exact: true })).toBeEnabled()
  await page.getByLabel('اسم المستخدم').fill('admin')
  await page.getByLabel('كلمة المرور', { exact: true }).fill('admin')
  await page.getByRole('button', { name: 'دخول', exact: true }).click()
  await expect(page).not.toHaveURL(/\/login/)
}

/** Answers every my-tasks request: empty lists, and `onPost` decides what a create returns. */
async function mockMyTasks(page: Page, onPost: (body: unknown) => { status: number; body: unknown; delayMs?: number }) {
  const posts: unknown[] = []
  await page.route('**/api/v1/people**', route => route.fulfill({
    status: 200, contentType: 'application/json', body: JSON.stringify([PERSON, { id: 6, name: 'سارة محمد', user_id: 6 }]),
  }))
  await page.route('**/api/v1/my-tasks**', async route => {
    const request = route.request()
    if (request.method() === 'POST') {
      const body = request.postDataJSON()
      posts.push(body)
      const reply = onPost(body)
      if (reply.delayMs) await new Promise(resolve => setTimeout(resolve, reply.delayMs))
      await route.fulfill({ status: reply.status, contentType: 'application/json', body: JSON.stringify(reply.body) })
      return
    }
    await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ items: [], total: 0 }) })
  })
  return posts
}

test.beforeEach(async ({ page }) => { await login(page) })

test('the create button is not usable before hydration and works with one click after it', async ({ page }) => {
  const posts = await mockMyTasks(page, () => ({ status: 200, body: CREATED }))
  const hydrate = await beforeHydration(page, '/my-tasks/new')
  const submit = page.getByTestId('my-task-form-submit')
  // The create panel is a portalled slide-over, so it is not in the server markup at all: before
  // hydration there is no submit button whose first click could be dropped.
  await expect(submit).toHaveCount(0)
  hydrate()
  await expect(submit).toBeEnabled()
  await page.getByLabel('عنوان المهمة').fill('كتابة التقرير')
  await submit.click()
  await expect(page).toHaveURL(/\/my-tasks\/42/)
  expect(posts).toHaveLength(1)
})

test('the name field takes focus once the page is hydrated', async ({ page }) => {
  await mockMyTasks(page, () => ({ status: 200, body: CREATED }))
  await page.goto('/my-tasks/new')
  await expect(page.getByLabel('عنوان المهمة')).toBeEnabled()
  await expect(page.getByLabel('عنوان المهمة')).toBeFocused()
})

test('saving posts the exact body once and redirects to the new task', async ({ page }) => {
  const posts = await mockMyTasks(page, () => ({ status: 200, body: { ...CREATED, priority: 'high' } }))
  await page.goto('/my-tasks/new?returnTo=/my-tasks%3Ftab%3Ddone')
  await expect(page.getByRole('heading', { name: 'مهمة شخصية جديدة', level: 1 })).toBeVisible()
  await expect(page.getByTestId('my-task-form-submit')).toBeEnabled()

  await page.getByLabel('عنوان المهمة').fill('  كتابة التقرير ')
  await page.getByLabel('الوصف').fill('ملاحظات المهمة')

  await page.getByRole('button', { name: 'الموعد النهائي' }).click()
  const day = page.locator('[data-reka-calendar-cell-trigger]:not([data-disabled]):not([data-outside-view])').first()
  const deadline = await day.getAttribute('data-value')
  expect(deadline).toMatch(/^\d{4}-\d{2}-\d{2}$/)
  await day.click()
  await page.keyboard.press('Escape')

  await page.getByRole('combobox', { name: 'الأولوية' }).click()
  await page.getByRole('option', { name: 'مرتفعة' }).click()

  await page.getByRole('button', { name: 'المسؤولون' }).click()
  await page.getByRole('option', { name: PERSON.name }).click()
  await page.keyboard.press('Escape')

  await page.getByTestId('my-task-form-submit').click()
  await expect(page).toHaveURL(/\/my-tasks\/42/)
  expect(posts).toEqual([{
    name: 'كتابة التقرير', description: 'ملاحظات المهمة', date_deadline: deadline, priority: 'high', assignees: [PERSON.user_id],
  }])
})

const toasts = (page: Page) => page.getByLabel('Notifications (F8)')

// A 422 that names a form field shows under that field only; `user_ids` is the storage name of
// `assignees`. A field the form does not show gets the form-level alert and a toast.
for (const field of ['name', 'description', 'date_deadline', 'priority', 'assignees', 'user_ids']) {
  test(`a 422 on ${field} stays on the page and shows the error under the field only`, async ({ page }) => {
    const message = `خطأ في الحقل ${field}`
    const posts = await mockMyTasks(page, () => ({ status: 422, body: { code: 'invalid', message, field } }))
    await page.goto('/my-tasks/new')
    await expect(page.getByTestId('my-task-form-submit')).toBeEnabled()
    await page.getByLabel('عنوان المهمة').fill('مهمة')
    await page.getByTestId('my-task-form-submit').click()
    await expect(page.getByTestId('my-task-form').getByText(message)).toBeVisible()
    if (field === 'name') await expect(page.getByLabel('عنوان المهمة')).toHaveAttribute('aria-invalid', 'true')
    await expect(page.getByTestId('my-task-form-error')).toHaveCount(0)
    await expect(toasts(page).getByText(message)).toHaveCount(0)
    await expect(page).toHaveURL(/\/my-tasks\/new$/)
    expect(posts).toEqual([{ name: 'مهمة', priority: 'normal' }])
  })
}

test('a 422 on an unknown field shows the form alert and a toast', async ({ page }) => {
  const message = 'حقل غير معروف'
  await mockMyTasks(page, () => ({ status: 422, body: { code: 'invalid', message, field: 'parent_id' } }))
  await page.goto('/my-tasks/new')
  await expect(page.getByTestId('my-task-form-submit')).toBeEnabled()
  await page.getByLabel('عنوان المهمة').fill('مهمة')
  await page.getByTestId('my-task-form-submit').click()
  await expect(page.getByTestId('my-task-form-error')).toContainText(message)
  await expect(toasts(page).getByText(message)).toBeVisible()
  await expect(page).toHaveURL(/\/my-tasks\/new$/)
})

test('a double click creates exactly one task', async ({ page }) => {
  const posts = await mockMyTasks(page, () => ({ status: 200, body: CREATED, delayMs: 800 }))
  await page.goto('/my-tasks/new')
  await expect(page.getByTestId('my-task-form-submit')).toBeEnabled()
  await page.getByLabel('عنوان المهمة').fill('كتابة التقرير')
  await page.getByTestId('my-task-form-submit').dblclick()
  await expect(page).toHaveURL(/\/my-tasks\/42/)
  expect(posts).toHaveLength(1)
})

test('two submit events in the same task create exactly one task', async ({ page }) => {
  // vue-query publishes isPending on a later task, so a prop alone cannot stop a second event that
  // arrives before the re-render; the page needs its own synchronous in-flight guard.
  const posts = await mockMyTasks(page, () => ({ status: 200, body: CREATED, delayMs: 800 }))
  await page.goto('/my-tasks/new')
  await expect(page.getByTestId('my-task-form-submit')).toBeEnabled()
  await page.getByLabel('عنوان المهمة').fill('كتابة التقرير')
  await page.getByTestId('my-task-form').evaluate((form: HTMLFormElement) => { form.requestSubmit(); form.requestSubmit() })
  await expect(page).toHaveURL(/\/my-tasks\/42/)
  expect(posts).toHaveLength(1)
})

test('Enter pressed twice creates exactly one task', async ({ page }) => {
  const posts = await mockMyTasks(page, () => ({ status: 200, body: CREATED, delayMs: 800 }))
  await page.goto('/my-tasks/new')
  await expect(page.getByTestId('my-task-form-submit')).toBeEnabled()
  const name = page.getByLabel('عنوان المهمة')
  await name.fill('كتابة التقرير')
  await name.press('Enter')
  await page.keyboard.press('Enter')
  await expect(page).toHaveURL(/\/my-tasks\/42/)
  expect(posts).toHaveLength(1)
})

test('an empty name is refused before any request', async ({ page }) => {
  const posts = await mockMyTasks(page, () => ({ status: 200, body: CREATED }))
  await page.goto('/my-tasks/new')
  await expect(page.getByTestId('my-task-form-submit')).toBeEnabled()
  await page.getByTestId('my-task-form-submit').click()
  await expect(page.getByText('عنوان المهمة مطلوب')).toBeVisible()
  expect(posts).toEqual([])
})

test('a direct link keeps the return path, survives a refresh and cancel goes back', async ({ page }) => {
  await mockMyTasks(page, () => ({ status: 200, body: CREATED }))
  await page.goto('/my-tasks/new?returnTo=/my-tasks%3Ftab%3Ddone%26q%3Dtest')
  await expect(page.getByRole('heading', { name: 'مهمة شخصية جديدة', level: 1 })).toBeVisible()
  await page.reload()
  await expect(page.getByRole('heading', { name: 'مهمة شخصية جديدة', level: 1 })).toBeVisible()
  await expect(page.getByTestId('my-task-form-submit')).toBeEnabled()
  await page.getByTestId('my-task-form-cancel').click()
  await expect(page).toHaveURL(/\/my-tasks\?tab=done&q=test$/)
})

test('creation returns to a known accessible source outside the owning list', async ({ page }) => {
  await mockMyTasks(page, () => ({ status: 200, body: CREATED }))
  await page.goto('/my-tasks/new?returnTo=%2Fprojects%3Fq%3Dsource')
  await expect(page.getByTestId('my-task-form-submit')).toBeEnabled()
  await page.getByTestId('my-task-form-cancel').click()
  await expect(page).toHaveURL(/\/projects\?q=source$/)
})

for (const hostile of ['/projects/unknown', 'javascript:alert(1)', '//evil.example/my-tasks', 'https://evil.example/my-tasks', '/\\evil.example']) {
  test(`return path ${hostile} falls back to the list`, async ({ page }) => {
    await mockMyTasks(page, () => ({ status: 200, body: CREATED }))
    await page.goto(`/my-tasks/new?returnTo=${encodeURIComponent(hostile)}`)
    await expect(page.getByTestId('my-task-form-submit')).toBeEnabled()
    await page.getByTestId('my-task-form-cancel').click()
    await expect(page).toHaveURL(/\/my-tasks$/)
  })
}
