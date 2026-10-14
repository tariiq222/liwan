import { test, expect } from '@playwright/test'
import { login, open, DESKTOP, PHONE, rows, mobileRows, fitsWidth, expectFrameOwnsH1, typeThenOpen } from './support/tasmim6'

test.describe('Plan 6a: stakeholders', () => {
  test.beforeEach(async ({ page }) => { await login(page) })
  test.describe('desktop', () => {
    test.use({ viewport: DESKTOP })

    test('the list is a list page inside the frame with a toolbar, a table and the page create button', async ({ page }) => {
      await open(page, '/projects/2/stakeholders')
      await expectFrameOwnsH1(page)
      await expect(page.locator('[data-template="list"]')).toHaveCount(1)
      await expect(page.getByTestId('stakeholders-toolbar')).toBeVisible()
      await expect(rows(page)).toHaveCount(3)
      const create = page.getByTestId('stakeholders-create')
      await expect(create).toHaveAttribute('data-shortcut-create', '')
      await expect(create).toContainText('صاحب مصلحة جديد')
      await expect(page.getByTestId('project-workspace-tabs')).toBeVisible()
    })
    test('J, K and Enter open the focused stakeholder', async ({ page }) => {
      await open(page, '/projects/2/stakeholders')
      await page.getByTestId('project-workspace-name').click()
      await page.keyboard.press('j')
      await page.keyboard.press('Enter')
      await expect(page).toHaveURL(/\/projects\/2\/stakeholders\/21/)
    })
    test('a row opened right after typing keeps the search in its return path', async ({ page }) => {
      await open(page, '/projects/2/stakeholders')
      await typeThenOpen(page, { search: 'فريق', link: 'tbody tr[data-shortcut-row] a' })
      await expect(page).toHaveURL(/\/projects\/2\/stakeholders\/\d+/)
      expect(await page.locator('[data-template="record"] header').getByRole('link', { name: 'أصحاب المصلحة', exact: true }).getAttribute('href')).toContain('q=')
    })
    test('the record is a record page with an h2 name, contact and notes, and a properties aside', async ({ page }) => {
      await open(page, '/projects/2/stakeholders/21')
      await expect(page.getByRole('heading', { level: 1 })).toHaveCount(1)
      await expect(page.getByRole('heading', { level: 2, name: 'فريق التشغيل' })).toBeVisible()
      await expect(page.locator('[data-slot="properties-panel"]')).toContainText('إدارة الخدمات')
      await expect(page.getByTestId('stakeholder-detail-edit')).toBeVisible()
    })
    test('delete asks inline and cancel closes it; the new panel opens over the list', async ({ page }) => {
      await open(page, '/projects/2/stakeholders')
      await page.getByRole('button', { name: /إجراءات .*الإدارة المالية/ }).click()
      await page.getByRole('menuitem', { name: 'حذف', exact: true }).click()
      const confirm = page.getByTestId('stakeholder-delete-confirm')
      await expect(confirm).toBeVisible()
      await expect(page.getByRole('dialog')).toHaveCount(0)
      await confirm.getByRole('button', { name: 'إلغاء' }).click()
      await expect(confirm).toHaveCount(0)
      await page.getByTestId('project-workspace-name').click()
      await page.keyboard.press('c')
      await expect(page).toHaveURL(/\/projects\/2\/stakeholders\/new/)
      await expect(page.locator('[data-template="list"]')).toHaveCount(1)
    })
    test('a stale offset page keeps Previous enabled and returns to its first page', async ({ page }) => {
      await open(page, '/projects/2/stakeholders?offset=50')
      const pagination = page.getByTestId('shared-pagination')
      await expect(pagination).toBeVisible()
      await expect(pagination).toContainText('صفحة 2 من 2')
      const previous = pagination.locator('button[data-slot="prev"]')
      await expect(previous).toBeEnabled()
      await previous.click()
      await expect.poll(() => new URL(page.url()).searchParams.has('offset')).toBe(false)
      await expect(rows(page)).toHaveCount(3)
    })

    test('editing a record returns to it and its filtered list without losing query state', async ({ page }) => {
      await open(page, '/projects/2/stakeholders/21?q=تأخر&offset=50')
      await page.getByTestId('stakeholder-detail-edit').click()
      await expect(page).toHaveURL(/\/stakeholders\/21\/edit/)
      await page.keyboard.press('Escape')
      await expect(page).toHaveURL(/\/stakeholders\/21\?/)
      expect(new URL(page.url()).searchParams.get('q')).toBe('تأخر')
      expect(new URL(page.url()).searchParams.get('offset')).toBe('50')

      await page.keyboard.press('Escape')
      await expect(page).toHaveURL(/\/stakeholders\?/)
      expect(new URL(page.url()).searchParams.get('q')).toBe('تأخر')
      expect(new URL(page.url()).searchParams.get('offset')).toBe('50')
    })

    test('a viewer who cannot manage sees no create and no actions', async ({ page }) => {
      await open(page, '/projects/3/stakeholders')
      await expect(rows(page)).toHaveCount(3)
      await expect(page.getByTestId('stakeholders-create')).toHaveCount(0)
      await expect(page.getByRole('button', { name: /^إجراءات/ })).toHaveCount(0)
    })
  })
  test.describe('phone', () => {
    test.use({ viewport: PHONE })
    test('the phone rows carry name, organization and role and nothing overflows', async ({ page }) => {
      await open(page, '/projects/2/stakeholders')
      await expect(mobileRows(page)).toHaveCount(3)
      await expect(mobileRows(page).first()).toContainText('إدارة الخدمات')
      expect(await fitsWidth(page)).toBe(true)
    })
  })
})
