import { test, expect, type Page } from '@playwright/test'

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

// Regression coverage for the SSR hydration race: interactive controls
// (reka-ui Tabs, buttons with attached listeners) are visible and clickable
// before Nuxt finishes hydrating, so a click made immediately after
// navigation can land before the listener is attached and be silently
// dropped. useHydrated() gates such controls (disabled) until hydration
// completes; these tests click with NO retry loop and NO waitForTimeout —
// against the pre-fix code the /tasks case fails (click is dropped, tab
// never switches) and the /login case is a weaker check (the button being
// clickable pre-hydration isn't itself observable failure without racing a
// real submit, so we assert the disabled-state contract directly instead).

async function login(page) {
  await page.goto('/login')
  await page.getByLabel('اسم المستخدم').fill('admin')
  await page.getByLabel('كلمة المرور').fill('admin')
  await page.getByRole('button', { name: 'دخول' }).click()
  // Login lands on the first section the user may open (accessPolicy.firstAllowedPath).
  await expect(page).not.toHaveURL(/\/login(?:\?|$)/)
}

test('tasks: the KPI toggle is disabled pre-hydration, then an immediate click flips it with no retry', async ({ page }) => {
  await login(page)
  const hydrate = await beforeHydration(page, '/tasks')
  const toggle = page.getByTestId('kpi-toggle')
  // The control is in the SSR markup immediately, but must not be interactive yet.
  await expect(toggle).toBeVisible()
  await expect(toggle).toBeDisabled()
  hydrate()
  // Wait for hydration to flip it live, then a single un-retried click must land and actually switch it.
  await expect(toggle).toBeEnabled()
  const before = await toggle.getAttribute('aria-pressed')
  await toggle.click()
  await expect(toggle).not.toHaveAttribute('aria-pressed', before!)
})

test('login: submit button is disabled pre-hydration and becomes enabled once hydrated', async ({ page }) => {
  const hydrate = await beforeHydration(page, '/login')
  const submit = page.getByRole('button', { name: 'دخول' })
  await expect(submit).toBeVisible()
  await expect(submit).toBeDisabled()
  hydrate()
  await expect(submit).toBeEnabled()
  await page.getByLabel('اسم المستخدم').fill('admin')
  await page.getByLabel('كلمة المرور').fill('admin')
  await submit.click()
  await expect(page).not.toHaveURL(/\/login(?:\?|$)/)
})

test('tasks: "New task" button is disabled pre-hydration, then an immediate click routes to the create page', async ({ page }) => {
  await login(page)
  const hydrate = await beforeHydration(page, '/tasks')
  const createButton = page.getByRole('link', { name: 'مهمة مشروع جديدة' })
  // Same silently-dropped-click risk as the tab: SSR-rendered, visible, with
  // a listener attached only post-hydration — and the one most likely to
  // matter in practice (a user's first action on the page).
  await expect(createButton).toBeVisible()
  await expect(createButton).toBeDisabled()
  hydrate()
  await expect(createButton).toBeEnabled()
  await createButton.click()
  await expect(page).toHaveURL(/\/tasks\/new\?returnTo=/)
  await expect(page.getByLabel('عنوان المهمة')).toBeVisible()
  await expect(page.locator('[data-slot="dialog-content"], [data-slot="sheet-content"]').first()).toHaveCount(0)
})

test('hr: directory create is disabled pre-hydration, then an immediate click works with no retry', async ({ page }) => {
  await login(page)
  const hydrate = await beforeHydration(page, '/hr')
  const createButton = page.getByRole('link', { name: 'موظف جديد' })
  await expect(createButton).toBeVisible()
  await expect(createButton).toBeDisabled()
  hydrate()
  await expect(createButton).toBeEnabled()
  await createButton.click()
  await expect(page).toHaveURL(/\/hr\/employees\/new/)
})

test('task detail: JS controls are disabled pre-hydration, then an immediate click works with no retry', async ({ page }) => {
  await login(page)
  // Task 101 of the mock is the first of four, so «السابقة» stays disabled after hydration and «التالية» goes live.
  const hydrate = await beforeHydration(page, '/tasks/101')
  const detail = page.getByTestId('task-detail-page')
  const back = detail.getByRole('link', { name: 'العودة إلى المهام', exact: true })
  const prev = detail.getByRole('button', { name: 'السابقة' })
  const next = detail.getByRole('button', { name: 'التالية' })
  await expect(back).toBeVisible()
  await expect(back).toHaveAttribute('aria-disabled', 'true')
  await expect(back).toHaveAttribute('tabindex', '-1')
  await expect(prev).toBeDisabled()
  await expect(next).toBeDisabled()
  hydrate()
  await expect(next).toBeEnabled()
  await expect(back).not.toHaveAttribute('aria-disabled', 'true')
  await expect(back).not.toHaveAttribute('tabindex', '-1')
  await back.click()
  await expect(page).toHaveURL(/\/tasks$/)
})
