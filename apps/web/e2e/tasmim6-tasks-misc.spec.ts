import { test, expect } from '@playwright/test'
import { login, open, DESKTOP, PHONE, rows, mobileRows, fitsWidth, expectFrameOwnsH1, typeThenOpen } from './support/tasmim6'

test.describe('Plan 6a: archived tasks and the task create routes', () => {
  test.beforeEach(async ({ page }) => { await login(page) })
  test.describe('desktop', () => {
    test.use({ viewport: DESKTOP })
    test('the archive is a list page with a back link, a toolbar and a table', async ({ page }) => {
      await open(page, '/tasks?scope=archived')
      await expect(page.getByRole('heading', { level: 1 })).toHaveText('المهام المؤرشفة')
      await expect(page.locator('[data-template="list"]')).toHaveCount(1)
      await expect(page.getByTestId('archived-tasks-toolbar')).toBeVisible()
      await expect(rows(page)).toHaveCount(3)
      await expect(page.locator('[data-slot="page-header"]').getByRole('link', { name: 'عودة', exact: true })).toHaveAttribute('href', '/tasks')
      await expect(page.locator('[data-shortcut-create]')).toHaveCount(0)
    })
    test('the search lives in the URL and J / K move between rows', async ({ page }) => {
      await open(page, '/tasks?scope=archived')
      await page.locator('[data-shortcut-search] input').fill('جارية')
      await expect(page).toHaveURL(/q=/)
      await open(page, '/tasks?scope=archived')
      await page.getByRole('heading', { level: 1 }).click()
      await page.keyboard.press('j')
      await expect(rows(page).nth(0)).toBeFocused()
      await page.keyboard.press('j')
      await expect(rows(page).nth(1)).toBeFocused()
    })
    test('a project archive keeps its project and return path in the back link', async ({ page }) => {
      await open(page, '/tasks?scope=archived&project_id=1&returnTo=%2Fprojects%2F1%2Ftasks')
      await expect(page.locator('[data-slot="page-header"]').getByRole('link', { name: 'عودة', exact: true })).toHaveAttribute('href', '/projects/1/tasks')
    })
    test('the task create routes open their panels over the lists', async ({ page }) => {
      await open(page, '/tasks/new')
      await expect(page.getByRole('dialog')).toBeVisible()
      await open(page, '/projects/2/tasks/new')
      await expect(page.getByRole('dialog')).toBeVisible()
      await expect(page.locator('[data-template="list"]')).toHaveCount(1)
    })
  })
  test.describe('phone', () => {
    test.use({ viewport: PHONE })
    test('the phone rows carry the name, the project and the restore action', async ({ page }) => {
      await open(page, '/tasks?scope=archived')
      await expect(mobileRows(page)).toHaveCount(3)
      await expect(mobileRows(page).first()).toContainText('مشروع ألفا')
      await expect(page.locator('table')).toBeHidden()
      expect(await fitsWidth(page)).toBe(true)
    })
  })
})
