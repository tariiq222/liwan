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

test('the open tab lists open rows and the closed tab asks the API for closed rows', async ({ page }) => {
  const requests = await mockList(page, fixtureList)
  await open(page, '/my-tasks')
  await expect(page.getByRole('heading', { name: 'مهامي', level: 1 })).toBeVisible()
  await expect(rows(page)).toHaveCount(3)
  await expect(page.locator('tbody').getByRole('link', { name: 'شراء هدايا العملاء' })).toBeVisible()
  expect(requests.at(-1)!.get('closed')).toBe('0')

  const done = page.getByRole('tab', { name: 'المغلقة' })
  await expect(done).toBeEnabled()
  await done.click()
  await expect(page).toHaveURL(/tab=closed/)
  await expect(rows(page)).toHaveCount(2)
  await expect(page.locator('tbody').getByRole('link', { name: 'إرسال التقرير الشهري' })).toBeVisible()
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
  const project = page.locator('tbody').getByRole('link', { name: 'مراجعة العقد' })
  await expect(project).toHaveAttribute('href', '/projects/7/tasks/42?returnTo=/my-tasks')
  await expect(rows(page).filter({ hasText: 'مشروع الأفق' })).toHaveCount(1)
  const personalLink = page.locator('tbody').getByRole('link', { name: 'ترتيب ملفات الأرشيف' })
  await expect(personalLink).toHaveAttribute('href', /^\/my-tasks\/102\?returnTo=/)
})

// What this proves: the list state lives in the URL, so history back to the list restores the tab, the
// scope and the search, and every personal row carries the list URL as `returnTo`. It does NOT prove that
// the task detail page's own back button honours `returnTo`: that is covered by the detail slice. It
// leaves through an existing page (/account) so it does not depend on the detail page being there.
test('the list state comes back from history and rows carry returnTo', async ({ page }) => {
  await mockList(page, fixtureList)
  await open(page, '/my-tasks?tab=closed&scope=created&q=حجز')
  await expect(rows(page)).toHaveCount(1)
  const link = page.locator('tbody').getByRole('link', { name: 'حجز قاعة الاجتماع' })
  const href = (await link.getAttribute('href'))!
  const returnTo = new URL(href, 'http://nasq.local').searchParams.get('returnTo')!
  expect(new URL(returnTo, 'http://nasq.local').searchParams.get('tab')).toBe('closed')
  expect(new URL(returnTo, 'http://nasq.local').searchParams.get('scope')).toBe('created')
  expect(new URL(returnTo, 'http://nasq.local').searchParams.get('q')).toBe('حجز')

  await open(page, '/account')
  await expect(page).toHaveURL(/\/account/)
  await page.goBack()
  await expect(page).toHaveURL(/\/my-tasks\?/)
  const url = new URL(page.url())
  expect(url.searchParams.get('tab')).toBe('closed')
  expect(url.searchParams.get('scope')).toBe('created')
  expect(url.searchParams.get('q')).toBe('حجز')
  await expect(page.getByRole('tab', { name: 'المغلقة' })).toHaveAttribute('aria-selected', 'true')
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
  const pagination = page.getByTestId('shared-pagination')
  const more = pagination.getByRole('button', { name: 'Page 2', exact: true })
  await expect(more).toBeEnabled()
  await more.click()
  await expect(rows(page)).toHaveCount(50)
  await pagination.getByRole('button', { name: 'Page 3', exact: true }).click()
  await expect(rows(page)).toHaveCount(20)
  await expect(page).toHaveURL(/offset=100/)
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
  await page.getByTestId('shared-pagination').getByRole('button', { name: 'Page 2', exact: true }).click()
  const alert = page.getByRole('alert').filter({ hasText: 'تعذّر تحميل المهام المطلوبة' })
  await expect(alert).toBeVisible({ timeout: 20_000 })
  await expect(rows(page)).toHaveCount(50)
  fail = false
  await alert.getByRole('button', { name: 'إعادة المحاولة' }).click()
  await expect(rows(page)).toHaveCount(10)
  await expect(alert).toHaveCount(0)
})

test('an empty list shows the empty state for each tab and for a search', async ({ page }) => {
  await mockList(page, () => ({ items: [], total: 0 }))
  await open(page, '/my-tasks')
  await expect(page.getByText('لا توجد مهام مفتوحة. ابدأ بإضافة مهمة جديدة.')).toBeVisible()
  await expect(rows(page)).toHaveCount(0)
  await page.getByRole('tab', { name: 'المغلقة' }).click()
  await expect(page.getByText('لا توجد مهام مغلقة بعد.')).toBeVisible()
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

test('a second-page live Arabic ampersand search carries the reset offset and hash before debounce', async ({ page }) => {
  await mockList(page, () => ({ items: [toItem(personal(102, 'ترتيب ملفات الأرشيف'))], total: 100 }))
  await open(page, '/my-tasks?offset=50&scope=created#rows')
  const input = page.getByLabel('ابحث في مهامي')
  await expect(input).toBeEnabled()
  await page.clock.install()
  await input.fill('عربي & بحث')
  const link = page.locator('tbody').getByRole('link', { name: 'ترتيب ملفات الأرشيف', exact: true })
  await expect(link).toHaveAttribute('href', /returnTo=/)
  const origin = new URL((await link.getAttribute('href'))!, 'http://nasq.local').searchParams.get('returnTo')!
  const url = new URL(origin, 'http://nasq.local')
  expect(url.searchParams.get('q')).toBe('عربي & بحث')
  expect(url.searchParams.has('offset')).toBe(false)
  expect(url.searchParams.get('scope')).toBe('created')
  expect(url.hash).toBe('#rows')
  await link.click()
  await page.clock.resume()
  await expect(page).toHaveURL(/\/my-tasks\/102\?returnTo=/)
  await page.getByRole('link', { name: 'العودة إلى مهامي', exact: true }).click()
  await expect.poll(() => new URL(page.url()).searchParams.get('q')).toBe('عربي & بحث')
  expect(new URL(page.url()).searchParams.has('offset')).toBe(false)
  expect(new URL(page.url()).hash).toBe('#rows')
})

test('table and cards keep filters hash and the selected view across opening and returning', async ({ page }) => {
  await mockList(page, fixtureList)
  await open(page, '/my-tasks?scope=created#rows')
  await expect(page.getByRole('table', { name: 'مهامي', exact: true })).toBeVisible()
  await page.getByTestId('my-tasks-view-cards').click()
  await expect(page.getByTestId('my-tasks-cards').getByTestId('my-task-row-card')).toHaveCount(2)
  let url = new URL(page.url())
  expect(url.searchParams.get('view')).toBe('cards')
  expect(url.searchParams.get('scope')).toBe('created')
  expect(url.hash).toBe('#rows')
  await page.reload()
  await expect(page.getByTestId('my-tasks-view-cards')).toHaveAttribute('aria-pressed', 'true')
  await page.getByLabel('ابحث في مهامي').fill('الأرشيف')
  await expect(page.getByTestId('my-tasks-cards').getByTestId('my-task-row-card')).toHaveCount(1)
  await page.getByTestId('my-tasks-cards').getByRole('link', { name: 'ترتيب ملفات الأرشيف', exact: true }).click()
  await expect(page).toHaveURL(/\/my-tasks\/102\?returnTo=/)
  await page.getByRole('link', { name: 'العودة إلى مهامي', exact: true }).click()
  await expect(page.getByTestId('my-tasks-cards')).toBeVisible()
  url = new URL(page.url())
  expect(url.searchParams.get('view')).toBe('cards')
  expect(url.hash).toBe('#rows')
  await page.getByTestId('my-tasks-view-table').click()
  await expect(page.getByRole('table', { name: 'مهامي', exact: true })).toBeVisible()
  expect(new URL(page.url()).searchParams.has('view')).toBe(false)
})

test('switching view before search debounce keeps the whole draft search', async ({ page }) => {
  await mockList(page, fixtureList)
  await open(page, '/my-tasks')
  await page.clock.install()
  await page.getByLabel('ابحث في مهامي').fill('ترتيب')
  await page.getByTestId('my-tasks-view-cards').click()
  await page.clock.resume()
  await expect(page.getByTestId('my-tasks-cards').getByTestId('my-task-row-card')).toHaveCount(1)
  expect(new URL(page.url()).searchParams.get('q')).toBe('ترتيب')
  await expect(page.getByLabel('ابحث في مهامي')).toHaveValue('ترتيب')
})

for (const width of [390, 768, 1440]) {
  test(`table and cards fit a ${width}px viewport with visible source and assignee`, async ({ page }, testInfo) => {
    await page.setViewportSize({ width, height: 950 })
    await mockList(page, fixtureList)
    await open(page, '/my-tasks')
    for (const mode of ['table', 'cards']) {
      await page.getByTestId(`my-tasks-view-${mode}`).click()
      await expect(page.getByTestId(`my-tasks-view-${mode}`)).toHaveAttribute('aria-pressed', 'true')
      expect(await page.evaluate(() => document.documentElement.scrollWidth - innerWidth)).toBeLessThanOrEqual(1)
      await expect(page.getByTestId('my-tasks-toolbar').getByLabel('ابحث في مهامي')).toBeVisible()
      const root = mode === 'table' ? page.locator('tbody') : page.getByTestId('my-tasks-cards')
      await expect(root.getByRole('link', { name: 'مراجعة العقد', exact: true })).toBeVisible()
      await expect(root.getByText('مشروع الأفق', { exact: true })).toBeVisible()
      await expect(root.getByText('Admin', { exact: true }).first()).toBeVisible()
      await page.screenshot({ path: testInfo.outputPath(`my-tasks-${mode}-${width}.png`), fullPage: true })
    }
  })
}

test('continued typing survives a view switch whose authorization is still pending', async ({ page }) => {
  await mockList(page, fixtureList)
  await open(page, '/my-tasks')
  const input = page.getByLabel('ابحث في مهامي')
  await input.fill('تر')
  meDelay.ms = 600
  await page.getByTestId('my-tasks-view-cards').click()
  await input.fill('ترتيب')
  await expect.poll(() => new URL(page.url()).searchParams.get('q'), { timeout: 10_000 }).toBe('ترتيب')
  await expect(input).toHaveValue('ترتيب')
  await expect(page.getByTestId('my-tasks-view-cards')).toHaveAttribute('aria-pressed', 'true')
})
