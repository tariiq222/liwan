import { test, expect, type Page } from '@playwright/test'
import { login, open, DESKTOP, PHONE, rows, mobileRows, fitsWidth, expectFrameOwnsH1, typeThenOpen } from './support/tasmim6'

// Keep offset 50 valid in these return-chain fixtures; the stock preview only has four entries.
// The list fetch happens in the browser after the panel/record returns, and the test asserts interception.
async function validOffsetFixture(page: Page) {
  let intercepted = false
  await page.route('**/api/v1/projects/2/finance?**', async route => {
    const params = new URL(route.request().url()).searchParams
    if (params.get('offset') !== '50') { await route.continue(); return }
    const response = await route.fetch()
    const data = await response.json()
    intercepted = true
    await route.fulfill({ response, json: { ...data, total: 100 } })
  })
  return () => intercepted
}

test.describe('Plan 6a: finance', () => {
  test.beforeEach(async ({ page }) => { await login(page) })

  test.describe('desktop', () => {
    test.use({ viewport: DESKTOP })

    test('the ledger is a list page inside the frame with the summary above the table', async ({ page }) => {
      await open(page, '/projects/2/finance')
      await expectFrameOwnsH1(page)
      await expect(page.getByTestId('project-finance-page')).toBeVisible()
      await expect(page.locator('[data-template="list"]')).toHaveCount(1)
      await expect(page.getByTestId('project-finance-summary')).toContainText('2500')
      await expect(rows(page)).toHaveCount(4)
      await expect(page.getByTestId('finance-entry-row')).toHaveCount(4)
      const create = page.locator('[data-shortcut-create]')
      await expect(create).toHaveCount(1)
      await expect(create).toContainText('بند ميزانية جديد')
      await expect(page.getByRole('link', { name: 'مصروف جديد' })).toBeVisible()
    })

    test('the kind filter and the search live in the URL', async ({ page }) => {
      await open(page, '/projects/2/finance?kind=expense')
      await expect(rows(page)).toHaveCount(2)
      await page.getByTestId('finance-search').fill('رخص')
      await expect(page).toHaveURL(/q=%D8%B1%D8%AE%D8%B5|q=رخص/)
    })

    test('J, K and Enter open the focused entry with the list state as its return path', async ({ page }) => {
      await open(page, '/projects/2/finance?kind=budget')
      await page.getByTestId('project-workspace-name').click()
      await page.keyboard.press('j')
      await expect(rows(page).nth(0)).toBeFocused()
      await page.keyboard.press('Enter')
      await expect(page).toHaveURL(/\/projects\/2\/finance\/51\?/)
      expect(new URL(page.url()).searchParams.get('returnTo')).toContain('kind=budget')
    })

    test('a row opened right after typing keeps the search in its return path', async ({ page }) => {
      await open(page, '/projects/2/finance#ledger')
      await page.route('**/api/v1/me', async route => {
        await new Promise(resolve => setTimeout(resolve, 400))
        await route.continue()
      })
      await typeThenOpen(page, { search: 'ميزانية', link: '[data-testid="finance-entry-row"] a' })
      await expect(page).toHaveURL(/\/projects\/2\/finance\/\d+/)
      expect(new URL(page.url()).searchParams.get('returnTo') ?? '').toContain('q=')
      expect(new URL(page.url()).searchParams.get('returnTo') ?? '').toContain('#ledger')
    })

    test('the entry is a record page: an h2 title, the back link, the properties aside, inline delete', async ({ page }) => {
      await open(page, '/projects/2/finance/53')
      await expect(page.getByRole('heading', { level: 1 })).toHaveCount(1)
      await expect(page.getByRole('heading', { level: 2, name: 'تجهيز بيئة العمل' })).toBeVisible()
      await expect(page.getByTestId('finance-entry-detail')).toBeVisible()
      await expect(page.locator('[data-slot="properties-panel"]')).toBeVisible()
      await page.getByTestId('row-actions-menu').click()
      await page.getByRole('menuitem', { name: 'حذف', exact: true }).click()
      await expect(page.getByTestId('finance-delete-confirm')).toBeVisible()
      await expect(page.getByRole('dialog')).toHaveCount(0)
    })

    test('the new-entry panel opens over the still-mounted ledger', async ({ page }) => {
      await open(page, '/projects/2/finance')
      await page.getByTestId('project-workspace-name').click()
      await page.keyboard.press('c')
      await expect(page).toHaveURL(/\/projects\/2\/finance\/new\?/)
      await expect(page.getByRole('dialog')).toBeVisible()
      await expect(page.locator('[data-template="list"]')).toHaveCount(1)
    })

    test('record and edit Back/Escape preserve the finance list q, kind and offset', async ({ page }) => {
      const intercepted = await validOffsetFixture(page)
      const origin = '/projects/2/finance?q=بيئة&kind=expense&offset=50'
      await open(page, `/projects/2/finance/53?returnTo=${encodeURIComponent(origin)}`)
      await expect(page.locator('[data-template="record"] header').getByRole('link', { name: 'العودة إلى المالية', exact: true })).toHaveAttribute('href', origin.replace('بيئة', encodeURIComponent('بيئة')))
      await page.getByRole('link', { name: 'تعديل', exact: true }).click()
      await expect(page).toHaveURL(/\/finance\/53\/edit/)
      await page.keyboard.press('Escape')
      await expect(page).toHaveURL(/\/finance\/53\?/)
      await page.keyboard.press('Escape')
      await expect.poll(() => new URL(page.url()).searchParams.get('q')).toBe('بيئة')
      expect(new URL(page.url()).searchParams.get('kind')).toBe('expense')
      await expect.poll(intercepted).toBe(true)
      expect(new URL(page.url()).searchParams.get('offset')).toBe('50')
    })

    test('a budget create panel returns to an expense list with its original search and offset', async ({ page }) => {
      const intercepted = await validOffsetFixture(page)
      const origin = '/projects/2/finance?q=رخص&kind=expense&offset=50'
      // A client-side visit: the first load is rendered on the server, where a browser route cannot answer the list.
      await open(page, '/projects/2/finance')
      await page.evaluate(target => (window as unknown as { useNuxtApp: () => { $router: { push: (to: string) => Promise<unknown> } } }).useNuxtApp().$router.push(target), `/projects/2/finance/new?kind=budget&returnTo=${encodeURIComponent(origin)}`)
      await expect(page.getByRole('dialog')).toBeVisible()
      await expect(page.getByRole('dialog').locator('#finance-kind')).toContainText('ميزانية')
      await page.keyboard.press('Escape')
      await expect.poll(() => new URL(page.url()).searchParams.get('q')).toBe('رخص')
      expect(new URL(page.url()).searchParams.get('kind')).toBe('expense')
      await expect.poll(intercepted).toBe(true)
      expect(new URL(page.url()).searchParams.get('offset')).toBe('50')
    })

    test('a viewer who cannot manage sees no create, no actions and no delete', async ({ page }) => {
      await open(page, '/projects/3/finance')
      await expect(rows(page)).toHaveCount(4)
      await expect(page.locator('[data-shortcut-create]')).toHaveCount(0)
      await expect(page.getByRole('link', { name: 'مصروف جديد' })).toHaveCount(0)
      await open(page, '/projects/3/finance/53')
      await expect(page.getByRole('button', { name: 'حذف', exact: true })).toHaveCount(0)
    })
  })

  test.describe('phone', () => {
    test.use({ viewport: PHONE })
    test('the phone rows carry title, kind, amount, date and budget and nothing overflows', async ({ page }) => {
      await open(page, '/projects/2/finance')
      await expect(mobileRows(page)).toHaveCount(4)
      await expect(page.getByTestId('finance-entry-card')).toHaveCount(4)
      await expect(page.locator('table')).toBeHidden()
      const expense = mobileRows(page).filter({ hasText: 'تجهيز بيئة العمل' })
      await expect(expense).toContainText('400')
      await expect(expense).toContainText('ميزانية التنفيذ')
      expect(await fitsWidth(page)).toBe(true)
    })
  })
})
