import { test, expect } from '@playwright/test'
import { login, open, DESKTOP, PHONE, rows, mobileRows, fitsWidth, expectFrameOwnsH1, typeThenOpen } from './support/tasmim6'

test.skip(process.env.E2E_MY_TASKS !== '1', 'Requires the isolated e2e/my-tasks-mock.mjs server (E2E_MY_TASKS=1)')
import { SSR_TASKS } from './my-tasks-fixtures.mjs'
const ID = Object.keys(SSR_TASKS)[0]

test.describe('Plan 6a: my task record', () => {
  test.beforeEach(async ({ page }) => { await login(page) })
  test.describe('desktop', () => {
    test.use({ viewport: DESKTOP })
    test('the record is a record page: one h1, the live state badge, sections and the properties aside', async ({ page }) => {
      await open(page, `/my-tasks/${ID}`)
      await expect(page.getByRole('heading', { level: 1 })).toHaveCount(1)
      await expect(page.locator('[data-template="record"]')).toHaveCount(1)
      await expect(page.getByTestId('my-task-detail')).toBeVisible()
      await expect(page.getByTestId('my-task-state')).toBeVisible()
      await expect(page.getByTestId('my-task-comments')).toBeVisible()
      await expect(page.getByTestId('my-task-attachments')).toBeVisible()
      await expect(page.locator('[data-slot="properties-panel"]')).toBeVisible()
      await expect(page.getByTestId('my-task-deadline')).toBeVisible()
    })
    test('editing swaps the description for the form in the main column and keeps the aside', async ({ page }) => {
      await open(page, `/my-tasks/${ID}`)
      await page.getByRole('button', { name: 'تعديل', exact: true }).click()
      await expect(page.locator('[data-slot="record-main"] form').filter({ has: page.getByLabel('عنوان المهمة', { exact: true }) })).toBeVisible()
      await expect(page.locator('[data-slot="properties-panel"]')).toBeVisible()
    })
    test('cancelling asks inline and never in a dialog', async ({ page }) => {
      await open(page, `/my-tasks/${ID}`)
      await page.locator('[data-my-task-cancel]').click()
      await expect(page.getByTestId('inline-confirm')).toBeVisible()
      await expect(page.getByRole('dialog')).toHaveCount(0)
      await page.getByTestId('inline-confirm-cancel').click()
      await expect(page.getByTestId('inline-confirm')).toHaveCount(0)
    })
    test('an unknown task shows the not-found sentence', async ({ page }) => {
      await open(page, '/my-tasks/987654')
      await expect(page.getByText('هذه المهمة غير موجودة أو لا تملك صلاحية عرضها.')).toBeVisible()
    })
    test('the new-task panel opens over the list', async ({ page }) => {
      await open(page, '/my-tasks/new')
      await expect(page.getByRole('dialog')).toBeVisible()
      await expect(page.getByTestId('my-task-form')).toBeVisible()
    })
  })
  test.describe('phone', () => {
    test.use({ viewport: PHONE })
    test('the aside follows the main column and nothing overflows', async ({ page }) => {
      await open(page, `/my-tasks/${ID}`)
      const main = await page.locator('[data-slot="record-main"]').boundingBox()
      const aside = await page.locator('[data-slot="record-aside"]').boundingBox()
      expect(aside!.y).toBeGreaterThan(main!.y)
      expect(await fitsWidth(page)).toBe(true)
    })
  })
})
