import { expect, test, type Page } from '@playwright/test'

// Mock-stack spec for the /my-tasks list. It is deliberately NOT in `ci-mock-specs.txt`: the repo mock API
// (`internal-ui-audit-mock.mjs`) does not know the tasks app, so its /me has no `tasks.*` capability or
// `tasks.enabled` feature and the server-rendered access check would refuse the page. It therefore runs
// against the wrapper `e2e/my-tasks-mock.mjs` (which adds the tasks capabilities to /me on the server)
// with E2E_MY_TASKS=1, as described in docs/testing.md; the my-tasks responses are mocked per test with
// page.route. It talks to an isolated mock only: no production/default port or real database.
test.skip(process.env.E2E_MY_TASKS !== '1', 'Requires the isolated e2e/my-tasks-mock.mjs server (E2E_MY_TASKS=1)')
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

// `meDelay.ms` slows every client-side /me refresh, which every client navigation awaits: it keeps a
// navigation pending. The response itself is untouched (the wrapper already adds the tasks access).
const meDelay = { ms: 0 }

async function delayMe(page: Page) {
  await page.route('**/api/v1/me', async route => {
    if (meDelay.ms) await new Promise(resolve => setTimeout(resolve, meDelay.ms))
    await route.continue()
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
    assignees: [person], creator: person, parent: null, is_subtask: false, subtasks: [], attachment_count: 0,
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

// The app is entered through the client router, so the page does not render on the server again.
async function open(page: Page, path: string) {
  await page.evaluate(target => (window as unknown as { useNuxtApp: () => { $router: { push: (to: string) => Promise<unknown> } } })
    .useNuxtApp().$router.push(target), path)
}

test.beforeEach(async ({ page }) => {
  meDelay.ms = 0
  await delayMe(page)
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

test('typing keeps the whole text while an earlier search navigation is still pending', async ({ page }) => {
  const requests = await mockList(page, fixtureList)
  await open(page, '/my-tasks')
  await expect(rows(page)).toHaveCount(3)
  const input = page.getByLabel('ابحث في مهامي')
  // The debounce (250 ms) pushes 'تر'; its navigation is held 600 ms by the slow /me and lands at
  // ~850 ms. The rest is typed at ~700 ms: before the landing, and before the next debounce fires.
  meDelay.ms = 600
  await input.pressSequentially('تر')
  await page.waitForTimeout(700)
  await input.pressSequentially('تيب')
  await expect.poll(() => new URL(page.url()).searchParams.get('q'), { timeout: 10_000 }).toBe('ترتيب')
  await expect(input).toHaveValue('ترتيب')
  meDelay.ms = 0
  await expect(rows(page)).toHaveCount(1)
  expect(requests.at(-1)!.get('q')).toBe('ترتيب')
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

// What this proves: the list state lives in the URL, so history back to the list restores the tab, the
// scope and the search, and every personal row carries the list URL as `returnTo`. It does NOT prove that
// the task detail page's own back button honours `returnTo`: that is covered by the detail slice. It
// leaves through an existing page (/account) so it does not depend on the detail page being there.
test('the list state comes back from history and rows carry returnTo', async ({ page }) => {
  await mockList(page, fixtureList)
  await open(page, '/my-tasks?tab=done&scope=created&q=حجز')
  await expect(rows(page)).toHaveCount(1)
  const link = page.getByRole('link', { name: 'حجز قاعة الاجتماع' })
  const href = (await link.getAttribute('href'))!
  const returnTo = new URL(href, 'http://nasq.local').searchParams.get('returnTo')!
  expect(new URL(returnTo, 'http://nasq.local').searchParams.get('tab')).toBe('done')
  expect(new URL(returnTo, 'http://nasq.local').searchParams.get('scope')).toBe('created')
  expect(new URL(returnTo, 'http://nasq.local').searchParams.get('q')).toBe('حجز')

  await open(page, '/account')
  await expect(page).toHaveURL(/\/account/)
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

test('a failed next page keeps the rows and offers a retry', async ({ page }) => {
  let fail = true
  const make = (from: number, count: number) => Array.from({ length: count }, (_, i) => toItem(personal(2000 + from + i, `مهمة ${from + i}`)))
  await page.route('**/api/v1/my-tasks?**', route => {
    const offset = Number(new URL(route.request().url()).searchParams.get('offset'))
    if (offset === 0) return route.fulfill({ json: { items: make(0, 50), total: 60 } })
    return fail
      ? route.fulfill({ status: 500, json: { code: 'server_error', message: 'x' } })
      : route.fulfill({ json: { items: make(50, 10), total: 60 } })
  })
  await open(page, '/my-tasks')
  await expect(rows(page)).toHaveCount(50)
  await page.getByRole('button', { name: 'تحميل المزيد' }).click()
  const alert = page.getByRole('alert').filter({ hasText: 'تعذّر تحميل المزيد من المهام' })
  await expect(alert).toBeVisible({ timeout: 20_000 })
  await expect(rows(page)).toHaveCount(50)
  fail = false
  await alert.getByRole('button', { name: 'إعادة المحاولة' }).click()
  await expect(rows(page)).toHaveCount(60)
  await expect(alert).toHaveCount(0)
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
