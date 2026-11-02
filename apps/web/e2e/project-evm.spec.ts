import { expect, test, type Page } from '@playwright/test'
import { login, open } from './support/tasmim6'

// Earned value on the isolated mock (e2e/pmo-evm-mock-routes.mjs): project 2 answers the worked example of the maths test,
// project 3 has no baseline. Opt-in local UI fixture only: no production/default port or real database.
test.skip(process.env.E2E_PROJECT_POPUPS !== '1', 'Requires isolated PROJECTS_UI_PREVIEW mock server')

const variant = async (page: Page, name: string) => expect((await page.request.post('/api/v1/__mock/evm-variant', { data: { name } })).status()).toBe(200)

test.beforeEach(async ({ page }) => {
  await login(page)
  await variant(page, '')
})

test('the earned value tab shows the indices, the method note and the planned value curve', async ({ page }) => {
  await open(page, '/projects/2/evm')
  await expect(page.getByTestId('governance-tab-evm')).toHaveAttribute('aria-current', 'page')
  await expect(page.getByTestId('evm-spi')).toHaveAttribute('data-band', 'danger')
  await expect(page.getByTestId('evm-cpi')).toHaveAttribute('data-band', 'danger')
  await expect(page.getByTestId('evm-spi')).toContainText('0.70')
  await expect(page.getByTestId('evm-cpi')).toContainText('0.88')
  await expect(page.getByTestId('evm-method')).toContainText('100%')
  await expect(page.getByTestId('evm-curve')).toBeVisible()
  await expect(page.getByTestId('chart-canvas')).toBeVisible()
  await expect(page.getByTestId('evm-notes')).toBeVisible()
})

test('an index between 0.9 and 1 reads as a warning', async ({ page }) => {
  await variant(page, 'warning')
  await open(page, '/projects/2/evm')
  await expect(page.getByTestId('evm-spi')).toHaveAttribute('data-band', 'warning')
  await expect(page.getByTestId('evm-cpi')).toHaveAttribute('data-band', 'warning')
})

test('a healthy project reads green', async ({ page }) => {
  await variant(page, 'healthy')
  await open(page, '/projects/2/evm')
  await expect(page.getByTestId('evm-spi')).toHaveAttribute('data-band', 'success')
})

test('a null index says there is not enough data', async ({ page }) => {
  await variant(page, 'empty')
  await open(page, '/projects/2/evm')
  await expect(page.getByTestId('evm-spi')).toContainText('لا بيانات كافية')
  await expect(page.getByTestId('evm-cpi')).toContainText('لا بيانات كافية')
  await expect(page.getByTestId('evm-no-budget')).toBeVisible()
  await expect(page.getByTestId('evm-hidden')).toBeVisible()
})

test('a project without a baseline points to the baselines tab', async ({ page }) => {
  await open(page, '/projects/3/evm')
  await expect(page.getByTestId('evm-no-baseline')).toBeVisible()
})
