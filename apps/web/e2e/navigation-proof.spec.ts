import { test, expect, type Page } from '@playwright/test'

// The five navigation behaviours the product owner requires proven by running
// the app, not by a unit-test count. Runs against the mock API:
//   cd apps/web && PROJECTS_UI_PREVIEW=1 MODULE_UI_PREVIEW=1 MOCK_PORT=4512 \
//     MOCK_TASK_COUNT=60 node e2e/internal-ui-audit-mock.mjs
//   cd apps/web && NUXT_ODOO_URL=http://127.0.0.1:4512 \
//     NUXT_ODOO_DB=nasq_ui_mock_only NUXT_PUBLIC_WS_URL=ws://127.0.0.1:4512/websocket \
//     npx nuxt dev --port 4111
//   E2E_BASE_URL=http://localhost:4111 npx playwright test e2e/navigation-proof.spec.ts

const PROJECT = 1
const MEETING = 1
const DEPARTMENT = 1
const TASK = 101

async function login(page: Page) {
  await page.goto('/login')
  await page.getByLabel('اسم المستخدم').fill('admin')
  await page.getByLabel('كلمة المرور').fill('admin')
  await page.getByRole('button', { name: 'دخول' }).click()
  await page.waitForURL(url => !url.pathname.startsWith('/login'))
}

/**
 * Escape and every other authenticated control stay inert until the client app
 * has taken the server-rendered tree over, so a test that presses a key before
 * that is testing nothing. The Vue app instance appears on the root element at
 * mount, which is the same moment useHydrated() flips.
 */
async function whenHydrated(page: Page) {
  await expect.poll(() => page.evaluate(() => {
    const root = document.querySelector('#__nuxt') ?? document.body.firstElementChild
    return Boolean((root as unknown as { __vue_app__?: unknown })?.__vue_app__)
  }), { timeout: 15_000 }).toBe(true)
  // One frame past mount, so the first watcher pass has run.
  await page.evaluate(() => new Promise(frame => requestAnimationFrame(() => frame(null))))
}

async function open(page: Page, url: string) {
  const response = await page.goto(url)
  expect(response?.status(), `${url} must render, not error`).toBeLessThan(400)
  await whenHydrated(page)
  return response
}

const headings = (page: Page) => page.locator('h1')

test.describe('2. an edit form goes back to the record it edits, not to the family list', () => {
  test.beforeEach(async ({ page }) => { await login(page) })

  // Two modules, because a single one would only prove that page's own wiring.
  for (const record of [
    { module: 'meetings', edit: `/meetings/${MEETING}/edit`, record: `/meetings/${MEETING}`, list: '/meetings' },
    { module: 'hr departments', edit: `/hr/departments/${DEPARTMENT}/edit`, record: `/hr/departments/${DEPARTMENT}`, list: '/hr/departments' },
  ]) {
    test(`${record.module}: the back control on the edit form points at the record`, async ({ page }) => {
      await open(page, record.edit)
      const back = page.locator('[data-slot=page-header] a').filter({ hasText: /رجوع|العودة/ }).first()
      await expect(back).toHaveAttribute('href', record.record)
      await back.click()
      await page.waitForURL(url => url.pathname === record.record)
      // Naming the list explicitly is what keeps this from passing on a
      // control that merely happens to leave the form.
      expect(new URL(page.url()).pathname).not.toBe(record.list)
    })

    test(`${record.module}: Escape on the edit form also lands on the record`, async ({ page }) => {
      await open(page, record.edit)
      await page.keyboard.press('Escape')
      await page.waitForURL(url => url.pathname === record.record)
      expect(new URL(page.url()).pathname).not.toBe(record.list)
    })
  }
})

test.describe('3. Escape', () => {
  test.beforeEach(async ({ page }) => { await login(page) })

  // (a) Escape is the keyboard form of the page's own back control: it must
  // resolve to the identical target, inside a project and outside one.
  for (const record of [
    { where: 'outside a project', url: `/tasks/${TASK}`, back: '/tasks' },
    { where: 'inside a project', url: `/projects/${PROJECT}/tasks/${TASK}`, back: `/projects/${PROJECT}/tasks` },
  ]) {
    test(`(a) ${record.where}: Escape leaves for the same target the back control names`, async ({ page }) => {
      await open(page, record.url)
      const back = page.getByRole('link', { name: 'العودة إلى المهام' }).first()
      await expect(back).toHaveAttribute('href', record.back)

      await page.keyboard.press('Escape')
      await page.waitForURL(url => url.pathname === record.back)

      // And the visible control agrees: same start, same destination.
      await open(page, record.url)
      await page.getByRole('link', { name: 'العودة إلى المهام' }).first().click()
      await page.waitForURL(url => url.pathname === record.back)
    })
  }

  // (b) A menu, dropdown or dialog owns Escape while it is open. Dismissing it
  // must not also leave the page underneath.
  test('(b) Escape dismisses an open menu and leaves the page where it is', async ({ page }) => {
    const url = `/tasks/${TASK}`
    await open(page, url)
    const layer = page.locator('[data-dismissable-layer]')
    await expect(layer).toHaveCount(0)

    await page.getByRole('button', { name: 'حسابي: Admin' }).click()
    // reka-ui stamps this on the layer that owns Escape; its presence is the
    // condition useEscapeBack checks, so it is the condition worth asserting.
    await expect(layer.first()).toBeVisible()

    await page.keyboard.press('Escape')
    await expect(layer).toHaveCount(0)
    // The page did not move: the overlay consumed the key.
    expect(new URL(page.url()).pathname).toBe(url)

    // Escape still works for the page once nothing else owns it — otherwise
    // this test would also pass on an Escape that had simply been disabled.
    await page.keyboard.press('Escape')
    await page.waitForURL(u => u.pathname === '/tasks')
  })

  // (c) Escape is a navigation, not a bypass: the draft guard answers it.
  test('(c) Escape on a dirty form warns instead of discarding the draft', async ({ page }) => {
    const url = `/meetings/${MEETING}/edit`
    await open(page, url)
    const name = page.locator('#edit-name')
    await name.fill('مسودة لم تُحفظ')
    // Escape inside a text field belongs to the field. Leave it first, which
    // is also what a reader does before reaching for Escape.
    await page.locator('h1').first().click()
    await expect(page.locator('#edit-name')).not.toBeFocused()

    await page.keyboard.press('Escape')

    await expect(page.getByTestId('unsaved-changes-dialog')).toBeVisible()
    expect(new URL(page.url()).pathname, 'the dirty form must still be on screen').toBe(url)

    // Staying keeps the draft; the page never left. The modal animates in, so
    // let it settle rather than racing its enter transition.
    const stay = page.getByRole('button', { name: 'البقاء' })
    await expect(stay).toBeVisible()
    await page.waitForTimeout(500)
    await stay.click()
    await expect(page.getByTestId('unsaved-changes-dialog')).toBeHidden()
    expect(new URL(page.url()).pathname).toBe(url)
    await expect(page.locator('#edit-name')).toHaveValue('مسودة لم تُحفظ')
  })
})

test.describe('4. exactly one <h1> per page', () => {
  test.beforeEach(async ({ page }) => { await login(page) })

  // Several page families, not one: a list, a record, an edit form, an index
  // and a settings page, on both sides of the project frame.
  const OUTSIDE = ['/tasks', `/tasks/${TASK}`, '/projects', '/meetings', `/meetings/${MEETING}`,
    `/meetings/${MEETING}/edit`, '/hr', `/hr/departments/${DEPARTMENT}`,
    `/hr/departments/${DEPARTMENT}/edit`, '/settings/users', '/notifications']

  const INSIDE = [`/projects/${PROJECT}`, `/projects/${PROJECT}/tasks`, `/projects/${PROJECT}/tasks/${TASK}`,
    `/projects/${PROJECT}/schedule`, `/projects/${PROJECT}/milestones`, `/projects/${PROJECT}/governance`,
    `/projects/${PROJECT}/finance`, `/projects/${PROJECT}/updates`, `/projects/${PROJECT}/charter`,
    `/projects/${PROJECT}/raci`, `/projects/${PROJECT}/stakeholders`, `/projects/${PROJECT}/register`,
    `/projects/${PROJECT}/settings`]

  test('outside a project every page has one heading', async ({ page }) => {
    test.setTimeout(180_000)
    for (const url of OUTSIDE) {
      await open(page, url)
      await expect(headings(page), url).toHaveCount(1)
      await expect(headings(page), url).not.toHaveText('')
    }
  })

  test('inside a project the frame owns the one heading', async ({ page }) => {
    test.setTimeout(180_000)
    for (const url of INSIDE) {
      await open(page, url)
      await expect(headings(page), url).toHaveCount(1)
      // The frame's project name is that heading, and the child page's own
      // header has stepped down rather than competing with it.
      await expect(page.getByTestId('project-workspace-name'), url).toBeVisible()
      await expect(headings(page), url).toHaveText('مشروع ألفا')
    }
  })
})

test.describe('5. filters and permissions survive navigation', () => {
  test.beforeEach(async ({ page }) => { await login(page) })

  test('a filtered list keeps its filter through a record and back', async ({ page }) => {
    const list = `/projects/${PROJECT}/tasks`
    await open(page, `${list}?q=مهمة&view=board`)
    await expect(page).toHaveURL(/q=/)

    // Leave the list for a record the ordinary way.
    await open(page, `${list}?q=مهمة`)
    const row = page.locator('tbody tr').first()
    await expect(row).toBeVisible()
    await row.click()
    await page.waitForURL(/\/tasks\/\d+/)
    // The record carries the list state it was opened from, which is what
    // makes the return trip able to restore it.
    expect(new URL(page.url()).searchParams.get('q')).toBe('مهمة')

    const back = page.getByRole('link', { name: 'العودة إلى المهام' }).first()
    await back.click()
    await page.waitForURL(url => url.pathname === list)
    expect(new URL(page.url()).searchParams.get('q'), 'the filter must survive the return').toBe('مهمة')
    // And the control shows it, so the reader sees the list they left.
    await expect(page.getByPlaceholder('بحث في العناوين…')).toHaveValue('مهمة')
  })

  test('a capability-gated control is absent for an identity without it', async ({ page }) => {
    const url = `/projects/${PROJECT}`
    await open(page, url)
    // With pmo.tasks.read, the three work-planning sections are on the strip.
    for (const section of ['tasks', 'schedule', 'milestones']) {
      await expect(page.getByTestId(`project-tab-${section}`), section).toBeVisible()
    }

    // The identity the app actually consumes is /api/v1/me. Serve one without
    // pmo.tasks.read, then empty the cache so the client refetches it rather
    // than keeping the identity the server rendered with.
    await page.route('**/api/v1/me', async (route) => {
      const response = await route.fetch()
      const me = await response.json()
      await route.fulfill({
        response,
        json: { ...me, capabilities: (me.capabilities as string[]).filter(c => c !== 'pmo.tasks.read') },
      })
    })
    // useMe() is a Nuxt useFetch keyed 'me', seeded by the server render, so
    // emptying it is the only way to make the client ask again through the
    // browser — which is where the intercept above can answer.
    await page.evaluate(async () => {
      const app = (window as unknown as { useNuxtApp?: () => { _asyncData: Record<string, { refresh: () => Promise<unknown> }> } }).useNuxtApp?.()
      await app?._asyncData?.me?.refresh()
    })

    for (const section of ['tasks', 'schedule', 'milestones']) {
      await expect(page.getByTestId(`project-tab-${section}`), section).toHaveCount(0)
    }
    // The sections that do not need it are still there, so this is a gate and
    // not the whole strip having failed to render.
    for (const section of ['summary', 'governance', 'finance', 'updates']) {
      await expect(page.getByTestId(`project-tab-${section}`), section).toBeVisible()
    }
  })
})
