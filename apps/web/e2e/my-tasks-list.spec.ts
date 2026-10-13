import { expect, test, type Page } from '@playwright/test'

// Opt-in local UI fixture only: the repo mock API does not know the tasks app, so every my-tasks and
// /me response used here is mocked in the page. No production/default port or real database.
test.skip(process.env.E2E_MY_TASKS_LIST !== '1', 'Requires the isolated mock server (E2E_MY_TASKS_LIST=1)')
test.describe.configure({ timeout: 60_000 })

const person = { id: 2, name: 'Admin', user_id: 2 }
const stamp = (day: string) => `${day}T00:00:00Z`

interface Row {
  id: number
  name: string
  state: 'open' | 'done' | 'cancelled'
  priority: 'normal' | 'high'
  date_deadline: string | null
  assignees: typeof person[]
  source: 'personal' | 'project'
  project: { id: number; name: string } | null
  href: string
  roles: ('assigned' | 'created')[]
}

const personal = (id: number, name: string, extra: Partial<Row> = {}): Row => ({
  id, name, state: 'open', priority: 'normal', date_deadline: null, assignees: [person],
  source: 'personal', project: null, href: `/my-tasks/${id}`, roles: ['assigned', 'created'], ...extra,
})

const ROWS: Row[] = [
  personal(101, 'شراء هدايا العملاء', { date_deadline: stamp('2030-03-05'), priority: 'high' }),
  personal(102, 'ترتيب ملفات الأرشيف', { roles: ['created'] }),
  { ...personal(42, 'مراجعة العقد', { roles: ['assigned'] }), source: 'project', project: { id: 7, name: 'مشروع الأفق' }, href: '/projects/7/tasks/42' },
  personal(103, 'إرسال التقرير الشهري', { state: 'done' }),
  personal(104, 'حجز قاعة الاجتماع', { state: 'done', roles: ['created'] }),
]

const toItem = ({ roles: _roles, ...row }: Row) => row

async function mockMe(page: Page) {
  await page.route('**/api/v1/me', async route => {
    const response = await route.fetch()
    const me = await response.json()
    const features = [...new Set([...(me.platform?.readable_features ?? []), 'tasks.enabled'])]
    await route.fulfill({
      response,
      json: {
        ...me,
        capabilities: [...new Set([...me.capabilities, 'tasks.tasks.read', 'tasks.tasks.create', 'tasks.tasks.write'])],
        entitlements: { ...me.entitlements, 'tasks.enabled': true },
        platform: { ...me.platform, readable_features: features, writable_features: features },
      },
    })
  })
}

// `serve` answers one list request: it receives the parsed query of the request.
async function mockList(page: Page, serve: (query: URLSearchParams) => { items: unknown[]; total: number }) {
  const requests: URLSearchParams[] = []
  await page.route('**/api/v1/my-tasks?**', async route => {
    const query = new URL(route.request().url()).searchParams
    requests.push(query)
    await route.fulfill({ json: serve(query) })
  })
  await page.route(/\/api\/v1\/my-tasks\/\d+$/, route => route.fulfill({ json: detail(Number(route.request().url().split('/').pop())) }))
  return requests
}

function detail(id: number) {
  return {
    id, name: 'شراء هدايا العملاء', description: '', state: 'open', priority: 'normal', date_deadline: null,
    assignees: [person], creator: person, parent: null, subtasks: [], attachment_count: 0,
    created_at: '2030-01-01T00:00:00Z', updated_at: '2030-01-01T00:00:00Z',
    allowed_actions: { write: true, done: true, reopen: false, cancel: true, convert: false },
  }
}

const fixtureList = (query: URLSearchParams) => {
  const closed = query.get('closed') === '1'
  const assigned = query.get('assigned') === 'me'
  const created = query.get('created') === 'me'
  const q = (query.get('q') ?? '').trim()
  const items = ROWS
    .filter(row => (row.state === 'open') !== closed)
    .filter(row => (!assigned && !created) || (assigned && row.roles.includes('assigned')) || (created && row.roles.includes('created')))
    .filter(row => !q || row.name.includes(q))
    .map(toItem)
  return { items, total: items.length }
}

async function login(page: Page) {
  await page.goto('/login')
  await expect(page.getByRole('button', { name: 'دخول', exact: true })).toBeEnabled()
  await page.getByLabel('اسم المستخدم').fill('admin')
  await page.getByLabel('كلمة المرور', { exact: true }).fill('admin')
  await page.getByRole('button', { name: 'دخول', exact: true }).click()
  await expect(page).not.toHaveURL(/\/login/)
}

// The server render checks access with the real mock /me, which does not know the tasks app. After
// the first client navigation every /me refresh goes through the mocked response, so the app is
// entered through the client router (never `page.goto`, which would render on the server again).
async function open(page: Page, path: string) {
  await page.evaluate(target => (window as unknown as { useNuxtApp: () => { $router: { push: (to: string) => Promise<unknown> } } })
    .useNuxtApp().$router.push(target), path)
}

test.beforeEach(async ({ page }) => {
  await mockMe(page)
  await login(page)
})

const rows = (page: Page) => page.getByTestId('my-task-row')

test('the open tab lists open rows and the done tab asks the API for closed rows', async ({ page }) => {
  const requests = await mockList(page, fixtureList)
  await open(page, '/my-tasks')
  await expect(page.getByRole('heading', { name: 'مهامي', level: 1 })).toBeVisible()
  await expect(rows(page)).toHaveCount(3)
  await expect(page.getByRole('link', { name: 'شراء هدايا العملاء' })).toBeVisible()
  expect(requests.at(-1)!.get('closed')).toBe('0')

  const done = page.getByRole('tab', { name: 'المنجزة' })
  await expect(done).toBeEnabled()
  await done.click()
  await expect(page).toHaveURL(/tab=done/)
  await expect(rows(page)).toHaveCount(2)
  await expect(page.getByRole('link', { name: 'إرسال التقرير الشهري' })).toBeVisible()
  expect(requests.at(-1)!.get('closed')).toBe('1')
})

test('the scope filter and the search live in the URL and refetch', async ({ page }) => {
  const requests = await mockList(page, fixtureList)
  await open(page, '/my-tasks')
  await expect(rows(page)).toHaveCount(3)
  expect(requests.at(-1)!.has('assigned')).toBe(false)
  expect(requests.at(-1)!.has('created')).toBe(false)

  await page.getByRole('button', { name: 'التي أنشأتها' }).click()
  await expect(page).toHaveURL(/scope=created/)
  await expect(rows(page)).toHaveCount(2)
  expect(requests.at(-1)!.get('created')).toBe('me')
  expect(requests.at(-1)!.has('assigned')).toBe(false)

  await page.getByRole('button', { name: 'المسندة إليّ' }).click()
  await expect(page).toHaveURL(/scope=assigned/)
  expect(requests.at(-1)!.get('assigned')).toBe('me')

  await page.getByRole('button', { name: 'الكل', exact: true }).click()
  await expect.poll(() => new URL(page.url()).searchParams.has('scope')).toBe(false)

  await page.getByLabel('ابحث في مهامي').fill('الأرشيف')
  await expect(page).toHaveURL(/q=/)
  expect(new URL(page.url()).searchParams.get('q')).toBe('الأرشيف')
  await expect(rows(page)).toHaveCount(1)
  expect(requests.at(-1)!.get('q')).toBe('الأرشيف')
})

test('a project row links to its href and a personal row to its detail page', async ({ page }) => {
  await mockList(page, fixtureList)
  await open(page, '/my-tasks')
  const project = page.getByRole('link', { name: 'مراجعة العقد' })
  await expect(project).toHaveAttribute('href', '/projects/7/tasks/42')
  await expect(rows(page).filter({ hasText: 'مشروع الأفق' })).toHaveCount(1)
  const personalLink = page.getByRole('link', { name: 'ترتيب ملفات الأرشيف' })
  await expect(personalLink).toHaveAttribute('href', /^\/my-tasks\/102\?returnTo=/)
})

test('going back from a task restores the tab, scope and search', async ({ page }) => {
  await mockList(page, fixtureList)
  await open(page, '/my-tasks?tab=done&scope=created&q=حجز')
  await expect(rows(page)).toHaveCount(1)
  const link = page.getByRole('link', { name: 'حجز قاعة الاجتماع' })
  const href = (await link.getAttribute('href'))!
  const returnTo = new URL(href, 'http://nasq.local').searchParams.get('returnTo')!
  expect(new URL(returnTo, 'http://nasq.local').searchParams.get('tab')).toBe('done')
  expect(new URL(returnTo, 'http://nasq.local').searchParams.get('scope')).toBe('created')
  expect(new URL(returnTo, 'http://nasq.local').searchParams.get('q')).toBe('حجز')

  await link.click()
  await expect(page).toHaveURL(/\/my-tasks\/104/)
  await page.goBack()
  await expect(page).toHaveURL(/\/my-tasks\?/)
  const url = new URL(page.url())
  expect(url.searchParams.get('tab')).toBe('done')
  expect(url.searchParams.get('scope')).toBe('created')
  expect(url.searchParams.get('q')).toBe('حجز')
  await expect(page.getByRole('tab', { name: 'المنجزة' })).toHaveAttribute('aria-selected', 'true')
  await expect(page.getByLabel('ابحث في مهامي')).toHaveValue('حجز')
  await expect(page.getByRole('button', { name: 'التي أنشأتها' })).toHaveAttribute('aria-pressed', 'true')
  await expect(rows(page)).toHaveCount(1)
})

test('paging continues by offset against the total and tolerates a short page', async ({ page }) => {
  const make = (from: number, count: number) => Array.from({ length: count }, (_, i) => toItem(personal(1000 + from + i, `مهمة ${from + i}`)))
  const requests = await mockList(page, query => {
    const offset = Number(query.get('offset'))
    // total counts rows the server dropped: the first page holds 48 of its 50.
    if (offset === 0) return { items: make(0, 48), total: 120 }
    if (offset === 50) return { items: make(50, 50), total: 120 }
    return { items: make(100, 20), total: 120 }
  })
  await open(page, '/my-tasks')
  await expect(rows(page)).toHaveCount(48)
  const more = page.getByRole('button', { name: 'تحميل المزيد' })
  await expect(more).toBeEnabled()
  await more.click()
  await expect(rows(page)).toHaveCount(98)
  await more.click()
  await expect(rows(page)).toHaveCount(118)
  await expect(more).toHaveCount(0)
  expect(requests.map(query => query.get('offset'))).toEqual(['0', '50', '100'])
  expect(new Set(requests.map(query => query.get('limit')))).toEqual(new Set(['50']))
})

test('an empty list shows the empty state for each tab and for a search', async ({ page }) => {
  await mockList(page, () => ({ items: [], total: 0 }))
  await open(page, '/my-tasks')
  await expect(page.getByText('لا توجد مهام مفتوحة. ابدأ بإضافة مهمة جديدة.')).toBeVisible()
  await expect(rows(page)).toHaveCount(0)
  await page.getByRole('tab', { name: 'المنجزة' }).click()
  await expect(page.getByText('لا توجد مهام منجزة بعد.')).toBeVisible()
  await open(page, '/my-tasks?q=zzz')
  await expect(page.getByText('لا توجد مهام تطابق بحثك.')).toBeVisible()
})

test('a failed load shows an error with a retry', async ({ page }) => {
  let fail = true
  await page.route('**/api/v1/my-tasks?**', route => fail
    ? route.fulfill({ status: 500, json: { code: 'server_error', message: 'x' } })
    : route.fulfill({ json: fixtureList(new URL(route.request().url()).searchParams) }))
  await open(page, '/my-tasks')
  await expect(page.getByRole('alert').filter({ hasText: 'حدث خطأ غير متوقع' })).toBeVisible({ timeout: 20_000 })
  fail = false
  await page.getByRole('button', { name: 'إعادة المحاولة' }).click()
  await expect(rows(page)).toHaveCount(3)
})
