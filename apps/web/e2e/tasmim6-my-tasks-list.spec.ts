import { test, expect, type Page } from '@playwright/test'
import { login, open as openBase, DESKTOP, PHONE, rows, mobileRows, fitsWidth, expectFrameOwnsH1, typeThenOpen } from './support/tasmim6'

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

async function open(page: Page, path: string) {
  await page.evaluate(target => (window as unknown as { useNuxtApp: () => { $router: { push: (to: string) => Promise<unknown> } } })
    .useNuxtApp().$router.push(target), path)
}


test.skip(process.env.E2E_MY_TASKS !== '1', 'Requires the isolated e2e/my-tasks-mock.mjs server (E2E_MY_TASKS=1)')
// … copy `person`, `stamp`, `Row`, `personal`, `project`, `toItem`, `fixtureList`, `mockList`, `delayMe`, `open` from my-tasks-list.spec.ts …

test.describe('Plan 6a: my tasks list', () => {
  test.beforeEach(async ({ page }) => { await login(page); await openBase(page, '/projects') })
  test.describe('desktop', () => {
    test.use({ viewport: DESKTOP })
    test('the list is the list template: one h1, the create button, the tabs, the toolbar and a table', async ({ page }) => {
      await mockList(page, fixtureList)
      await open(page, '/my-tasks')
      await expect(page.getByRole('heading', { level: 1, name: 'مهامي' })).toHaveCount(1)
      await expect(page.locator('[data-template="list"]')).toHaveCount(1)
      const create = page.getByTestId('my-tasks-new')
      await expect(create).toHaveAttribute('data-shortcut-create', '')
      await expect(page.getByTestId('my-tasks-tabs')).toBeVisible()
      await expect(page.getByTestId('my-tasks-toolbar')).toBeVisible()
      await expect(rows(page)).toHaveCount(3)
      await expect(page.getByTestId('my-task-row')).toHaveCount(3)
      await expect(rows(page).first().getByTestId('my-task-deadline')).toBeVisible()
    })
    test('J and K move between rows and Enter opens the focused task', async ({ page }) => {
      await mockList(page, fixtureList)
      await open(page, '/my-tasks')
      await page.getByRole('heading', { level: 1 }).click()
      await page.keyboard.press('j')
      await expect(rows(page).nth(0)).toBeFocused()
      await page.keyboard.press('j')
      await expect(rows(page).nth(1)).toBeFocused()
    })
    test('C opens the new-task panel and / focuses the search', async ({ page }) => {
      await mockList(page, fixtureList)
      await open(page, '/my-tasks')
      await page.getByRole('heading', { level: 1 }).click()
      await page.keyboard.press('/')
      await expect(page.locator('[data-shortcut-search] input')).toBeFocused()
      await page.getByRole('heading', { level: 1 }).click()
      await page.keyboard.press('c')
      await expect(page).toHaveURL(/\/my-tasks\/new/)
    })
    test('a row opened right after typing keeps the search in its return path', async ({ page }) => {
      await mockList(page, fixtureList)
      await open(page, '/my-tasks')
      await expect(rows(page)).toHaveCount(3)
      await expect(page.locator('tbody tr[data-shortcut-row] a[href^="/my-tasks/"]').first()).toBeVisible()
      await page.route('**/api/v1/me', async route => {
        await new Promise(resolve => setTimeout(resolve, 400))
        await route.continue()
      })
      await typeThenOpen(page, { search: 'ترتيب', link: 'tbody tr[data-shortcut-row] a[href^="/my-tasks/"]' })
      await expect(page).toHaveURL(/\/my-tasks\/\d+/)
      const returnTo = new URL(page.url()).searchParams.get('returnTo') ?? ''
      expect(new URL(returnTo, 'http://nasq.local').searchParams.get('q')).toBe('ترتيب')
    })

  })
  test.describe('phone', () => {
    test.use({ viewport: PHONE })
    test('the cards view carries name, state, deadline and assignees with keyboard navigation', async ({ page }) => {
      await mockList(page, fixtureList)
      await open(page, '/my-tasks')
      await page.getByTestId('my-tasks-view-cards').click()
      await expect(mobileRows(page)).toHaveCount(3)
      await expect(page.locator('table')).toHaveCount(0)
      await expect(page.getByTestId('my-task-row-card')).toHaveCount(3)
      await expect(mobileRows(page).first()).toContainText('شراء هدايا العملاء')
      expect(await fitsWidth(page)).toBe(true)
      await page.getByRole('heading', { level: 1 }).click()
      await page.keyboard.press('j')
      await expect(mobileRows(page).nth(0)).toBeFocused()
      await page.keyboard.press('Enter')
      await expect(page).toHaveURL(/\/my-tasks\/101\?returnTo=/)
    })
  })
})
