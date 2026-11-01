import { expect, test } from '@playwright/test'
import { login, open } from './support/tasmim6'

// Baselines on the isolated mock (e2e/pmo-baseline-mock-routes.mjs): project 2 is managed by the signed-in user and holds two
// baselines, project 3 is read-only for them. The mock keeps its baselines in memory, so every test restores the seed.
// Opt-in local UI fixture only: no production/default port or real database.
test.skip(process.env.E2E_PROJECT_POPUPS !== '1', 'Requires isolated PROJECTS_UI_PREVIEW mock server')

test.beforeEach(async ({ page }) => {
  await login(page)
  expect((await page.request.post('/api/v1/__mock/reset-baselines')).status()).toBe(200)
})

test('the baselines tab lists the snapshots and the variance against the latest one', async ({ page }) => {
  await open(page, '/projects/2/baselines')
  await expect(page.getByTestId('governance-tab-baselines')).toHaveAttribute('aria-current', 'page')
  await expect(page.getByTestId('baseline-variance-summary')).toBeVisible()
  await expect(page.getByTestId('baseline-variance-table')).toBeVisible()
  await expect(page.getByTestId('baseline-result-count')).toBeVisible()
  await page.getByRole('link', { name: 'بعد اعتماد طلب تغيير النطاق' }).click()
  await expect(page).toHaveURL(/\/projects\/2\/baselines\/2/)
  await expect(page.getByTestId('baseline-variance-table')).toBeVisible()
})

test('an earlier baseline is a frozen snapshot without variance', async ({ page }) => {
  await open(page, '/projects/2/baselines/1')
  await expect(page.getByTestId('baseline-snapshot-tasks')).toBeVisible()
  await expect(page.getByTestId('baseline-variance-table')).toHaveCount(0)
})

test('the manager takes a baseline after an inline confirmation', async ({ page }) => {
  await open(page, '/projects/2/baselines')
  await page.getByTestId('baseline-take').click()
  await expect(page.getByTestId('baseline-take-confirm')).toBeVisible()
  await page.getByTestId('baseline-note').fill('خطة بعد التمديد')
  await page.getByTestId('inline-confirm-action').click()
  await expect(page.getByRole('link', { name: 'خطة بعد التمديد' })).toBeVisible()
  await expect(page.getByTestId('baseline-take-confirm')).toHaveCount(0)
})

test('a reader sees the baselines but cannot take one', async ({ page }) => {
  await open(page, '/projects/3/baselines')
  await expect(page.getByTestId('baseline-take')).toHaveCount(0)
})

test('the schedule marks each task with its baseline dates', async ({ page }) => {
  await open(page, '/projects/2/schedule')
  await expect(page.getByTestId('schedule-gantt-baseline-legend')).toBeVisible()
})
