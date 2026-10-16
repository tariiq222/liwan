import { expect, test } from '@playwright/test'
import { login, open } from './support/tasmim6'

// Runs against the isolated mock (e2e/internal-ui-audit-mock.mjs): project 8001 starts at initiating with a
// submitted charter the signed-in user may approve, project 8002 at initiating with a returned draft charter.
// The mock keeps phase and charter state in memory, so every test starts by restoring the seeds.
const APPROVABLE = 8001
const BLOCKED = 8002

test.beforeEach(async ({ page }) => {
  await login(page)
  expect((await page.request.post('/api/v1/__mock/reset-charters')).status()).toBe(200)
})

test.afterEach(async ({ page }) => {
  await page.request.post('/api/v1/__mock/reset-charters')
})

test('a project with an unapproved charter is blocked and links to the charter', async ({ page }) => {
  await open(page, `/projects/${BLOCKED}`)
  await expect(page.getByTestId('project-phase-initiating')).toHaveAttribute('data-state', 'current')
  await expect(page.getByTestId('project-phase-check-charter_approved')).toHaveAttribute('data-ok', 'false')
  await expect(page.getByTestId('project-phase-move')).toBeDisabled()
  await page.getByTestId('project-phase-fix').click()
  await expect(page).toHaveURL(new RegExp(`/projects/${BLOCKED}/charter`))
})

test('the manager moves to planning once the charter is approved, then steps back inline', async ({ page }) => {
  await open(page, `/projects/${APPROVABLE}`)
  await expect(page.getByTestId('project-phase-move')).toBeDisabled()
  const detail = await (await page.request.get(`/api/v1/projects/${APPROVABLE}`)).json()
  const approved = await page.request.post(`/api/v1/projects/${APPROVABLE}/charter/approve`, { data: { expected_updated_at: detail.updated_at } })
  expect(approved.status()).toBe(200)
  await open(page, `/projects/${APPROVABLE}`)
  await expect(page.getByTestId('project-phase-move')).toBeEnabled()
  await page.getByTestId('project-phase-move').click()
  await expect(page.getByTestId('project-phase-planning')).toHaveAttribute('data-state', 'current')
  await expect(page.getByTestId('project-phase-initiating')).toHaveAttribute('data-state', 'done')
  await page.getByTestId('project-phase-back').click()
  await expect(page.getByTestId('project-phase-back-confirm')).toBeVisible()
  await page.getByTestId('inline-confirm-action').click()
  await expect(page.getByTestId('project-phase-initiating')).toHaveAttribute('data-state', 'current')
})

test('a read-only project without gate checks shows its phase but no gate card', async ({ page }) => {
  await open(page, '/projects/3')
  await expect(page.getByTestId('project-phase-planning')).toHaveAttribute('data-state', 'current')
  await expect(page.getByTestId('project-phase-gate')).toHaveCount(0)
  await expect(page.getByTestId('project-phase-move')).toHaveCount(0)
  await expect(page.getByTestId('project-phase-back')).toHaveCount(0)
})
