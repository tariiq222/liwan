import { test, expect } from '@playwright/test'
import { login, open, DESKTOP, PHONE, rows, mobileRows, fitsWidth, expectFrameOwnsH1, typeThenOpen } from './support/tasmim6'

test.describe('Plan 6a: register', () => {
  test.beforeEach(async ({ page }) => { await login(page) })

  test.describe('desktop', () => {
    test.use({ viewport: DESKTOP })

    test('the register is a list page inside the frame with filters, a table and the page create button', async ({ page }) => {
      await open(page, '/projects/2/register')
      await expectFrameOwnsH1(page)
      await expect(page.locator('[data-template="list"]')).toHaveCount(1)
      await expect(rows(page)).toHaveCount(3)
      const create = page.getByTestId('register-create')
      await expect(create).toHaveAttribute('data-shortcut-create', '')
      await expect(create).toContainText('إضافة خطر أو مشكلة')
      await expect(page.getByRole('columnheader', { name: 'درجة الخطر' })).toBeVisible()
      await expect(rows(page).first().getByRole('link', { name: 'تأخر اعتماد المتطلبات' })).toHaveAttribute('href', /\/projects\/2\/register\/31/)
      await expect(page.getByRole('button', { name: 'التالي', exact: true })).toHaveCount(0)
    })

    test('kind and search live in the URL and reload with the list', async ({ page }) => {
      await open(page, '/projects/2/register?kind=issue')
      await expect(rows(page)).toHaveCount(1)
      await open(page, '/projects/2/register')
      await page.locator('[data-shortcut-search] input').fill('اعتماد')
      await expect(page).toHaveURL(/q=/)
      await expect(rows(page)).toHaveCount(1)
    })

    test('J, K and Enter open the focused item', async ({ page }) => {
      await open(page, '/projects/2/register')
      await page.getByTestId('project-workspace-name').click()
      await page.keyboard.press('j')
      await expect(rows(page).nth(0)).toBeFocused()
      await page.keyboard.press('j')
      await expect(rows(page).nth(1)).toBeFocused()
      await page.keyboard.press('k')
      await page.keyboard.press('Enter')
      await expect(page).toHaveURL(/\/projects\/2\/register\/31/)
    })

    test('a row opened right after typing keeps the search in its return path', async ({ page }) => {
      await open(page, '/projects/2/register')
      await typeThenOpen(page, { search: 'تأخر', link: 'tbody tr[data-shortcut-row] a' })
      await expect(page).toHaveURL(/\/projects\/2\/register\/\d+/)
      const back = page.locator('[data-template="record"] header').getByRole('link', { name: 'المخاطر والمشكلات', exact: true })
      expect(await back.getAttribute('href')).toContain('q=')
    })

    test('the record is a record page with an h2 title and a properties aside', async ({ page }) => {
      await open(page, '/projects/2/register/31')
      await expect(page.getByRole('heading', { level: 1 })).toHaveCount(1)
      await expect(page.getByRole('heading', { level: 2, name: 'تأخر اعتماد المتطلبات' })).toBeVisible()
      await expect(page.getByTestId('register-detail-edit')).toBeVisible()
      await expect(page.locator('[data-slot="properties-panel"]')).toContainText('12')
    })

    test('delete asks inline, never in a dialog, and cancel closes it', async ({ page }) => {
      await open(page, '/projects/2/register')
      await page.getByRole('button', { name: /إجراءات .*تعطل بيئة الاختبار/ }).click()
      await page.getByRole('menuitem', { name: 'حذف', exact: true }).click()
      const confirm = page.getByTestId('register-delete-confirm')
      await expect(confirm).toBeVisible()
      await expect(page.getByRole('dialog')).toHaveCount(0)
      await confirm.getByRole('button', { name: 'إلغاء' }).click()
      await expect(confirm).toHaveCount(0)
    })

    test('the new-item panel opens over the still-mounted list', async ({ page }) => {
      await open(page, '/projects/2/register?kind=risk')
      await page.getByTestId('project-workspace-name').click()
      await page.keyboard.press('c')
      await expect(page).toHaveURL(/\/projects\/2\/register\/new/)
      await expect(page.getByRole('dialog')).toBeVisible()
      await expect(page.locator('[data-template="list"]')).toHaveCount(1)
      await page.keyboard.press('Escape')
      await expect(page).toHaveURL(/\/projects\/2\/register\?kind=risk/)
    })

    test('a stale offset clamps back to the last page', async ({ page }) => {
      await open(page, '/projects/2/register?offset=50')
      await expect.poll(() => new URL(page.url()).searchParams.has('offset')).toBe(false)
      await expect(rows(page)).toHaveCount(3)
    })

    test('editing a record returns to it and its filtered list without losing query state', async ({ page }) => {
      await open(page, '/projects/2/register/31?q=تأخر&offset=50&kind=risk')
      await page.getByTestId('register-detail-edit').click()
      await expect(page).toHaveURL(/\/register\/31\/edit/)
      await page.keyboard.press('Escape')
      await expect(page).toHaveURL(/\/register\/31\?/)
      expect(new URL(page.url()).searchParams.get('q')).toBe('تأخر')
      expect(new URL(page.url()).searchParams.get('offset')).toBe('50')
      expect(new URL(page.url()).searchParams.get('kind')).toBe('risk')
      await page.keyboard.press('Escape')
      await expect(page).toHaveURL(/\/register\?/)
      expect(new URL(page.url()).searchParams.get('q')).toBe('تأخر')
      expect(new URL(page.url()).searchParams.get('offset')).toBe('50')
    })

    test('a viewer who cannot manage sees no create, no actions and no edit', async ({ page }) => {
      await open(page, '/projects/3/register')
      await expect(rows(page)).toHaveCount(3)
      await expect(page.getByTestId('register-create')).toHaveCount(0)
      await expect(page.getByRole('button', { name: /^إجراءات/ })).toHaveCount(0)
      await open(page, '/projects/3/register/31')
      await expect(page.getByTestId('register-detail-edit')).toHaveCount(0)
    })
  })

  test.describe('phone', () => {
    test.use({ viewport: PHONE })
    test('the phone rows carry kind, priority, status and score and nothing overflows', async ({ page }) => {
      await open(page, '/projects/2/register')
      await expect(mobileRows(page)).toHaveCount(3)
      await expect(page.locator('table')).toBeHidden()
      await expect(mobileRows(page).first()).toContainText('تأخر اعتماد المتطلبات')
      await expect(mobileRows(page).first()).toContainText('12')
      expect(await fitsWidth(page)).toBe(true)
    })
  })
})
