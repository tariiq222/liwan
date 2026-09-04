import { test, expect } from '@playwright/test'

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
  await expect(page).toHaveURL('http://localhost:3000/')
}

test('tasks: closed tab is disabled pre-hydration, then an immediate click switches it with no retry', async ({ page }) => {
  await login(page)
  await page.goto('/tasks')
  const closedTab = page.getByRole('tab', { name: 'منجزة' })
  // The control is present in the SSR markup immediately, but must not be
  // interactive yet.
  await expect(closedTab).toBeVisible()
  await expect(closedTab).toBeDisabled()
  // Wait for hydration to flip it live, then a single un-retried click must
  // land and actually switch the tab — no toPass()/toBeAttached() polling.
  await expect(closedTab).toBeEnabled()
  await closedTab.click()
  await expect(closedTab).toHaveAttribute('aria-selected', 'true')
})

test('login: submit button is disabled pre-hydration and becomes enabled once hydrated', async ({ page }) => {
  await page.goto('/login')
  const submit = page.getByRole('button', { name: 'دخول' })
  await expect(submit).toBeVisible()
  await expect(submit).toBeDisabled()
  await expect(submit).toBeEnabled()
  await page.getByLabel('اسم المستخدم').fill('admin')
  await page.getByLabel('كلمة المرور').fill('admin')
  await submit.click()
  await expect(page).toHaveURL('http://localhost:3000/')
})
