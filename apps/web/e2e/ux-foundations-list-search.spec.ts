import { expect, test } from '@playwright/test'
import { enterFoundation, foundationTask } from './support/uxFoundations'

test('dialog and page search expose the same task provider and record return keeps q and provider', async ({ page }) => {
  await enterFoundation(page, '/my-tasks')
  await page.getByTestId('global-search-trigger').click()
  await page.locator('#global-search-input').fill('مهمة')
  await expect(page.getByTestId('command-palette').getByRole('option').filter({ hasText: foundationTask.name })).toBeVisible()
  await page.keyboard.press('Escape')
  await page.goto('/search?q=مهمة&provider=pmo-tasks')
  const search = page.getByTestId('search-page')
  await expect(search.getByRole('heading', { name: 'مهام المشاريع', exact: true })).toBeVisible()
  await search.getByRole('link', { name: foundationTask.name, exact: true }).click()
  await expect(page).toHaveURL(/\/tasks\/101\?returnTo=/)
  await page.getByTestId('task-detail-back').click()
  await expect(page).toHaveURL(/\/search\?q=.*&provider=pmo-tasks$/)
  await expect(page.locator('#navigation-search')).toHaveValue('مهمة')
})

test('clearing filters keeps the selected view and uses a neutral reset', async ({ page }) => {
  await enterFoundation(page, '/my-tasks?q=مهمة&view=board')
  const clear = page.getByRole('button', { name: 'مسح الفلاتر', exact: true })
  await expect(clear).toBeVisible()
  await clear.click()
  await expect(page).toHaveURL(/\/my-tasks\?view=board$/)
  await expect(page.locator('[data-shortcut-search] input')).toHaveValue('')
})

test('before typing search shows destinations and actions without fetching provider data', async ({ page }) => {
  const providerRequests: string[] = []
  page.on('request', request => { if (/\/api\/v1\/(projects|tasks)(\?|$)/.test(request.url())) providerRequests.push(request.url()) })
  await enterFoundation(page, '/search')
  await expect(page.getByTestId('search-page').getByRole('heading', { name: 'الإجراءات', exact: true })).toBeVisible()
  expect(providerRequests).toEqual([])
})

test('more opens the same provider on the page and loads its next server page', async ({ page }) => {
  const offsets: number[] = []
  await page.route('**/api/v1/tasks?**', async route => {
    const requested = new URL(route.request().url())
    const offset = Number(requested.searchParams.get('offset') ?? 0)
    const seed = new URL(requested)
    seed.searchParams.delete('q')
    seed.searchParams.set('offset', '0')
    const response = await route.fetch({ url: seed.href })
    const data = await response.json()
    offsets.push(offset)
    const first = data.items[0]
    await route.fulfill({ response, json: { items: Array.from({ length: offset === 0 ? 20 : 3 }, (_, i) => ({ ...first, id: 500 + offset + i, name: `نتيجة رحلة ${offset + i}` })), total: 23 } })
  })
  await enterFoundation(page, '/my-tasks')
  await page.getByTestId('global-search-trigger').click()
  await page.locator('#global-search-input').fill('نتيجة رحلة')
  const palette = page.getByTestId('command-palette')
  await expect(palette.getByRole('option').filter({ hasText: /^نتيجة رحلة/ })).toHaveCount(5)
  await palette.getByRole('option', { name: 'تحميل المزيد', exact: true }).click()
  await expect(page).toHaveURL(/\/search\?q=.*provider=pmo-tasks/)
  const search = page.getByTestId('search-page')
  await expect(search.getByRole('link').filter({ hasText: /^نتيجة رحلة/ })).toHaveCount(20)
  await search.getByRole('button', { name: 'تحميل المزيد', exact: true }).click()
  await expect(search.getByRole('link').filter({ hasText: /^نتيجة رحلة/ })).toHaveCount(23)
  expect(offsets).toContain(20)
})

test('a background record refresh error keeps loaded content with retry', async ({ page }) => {
  await enterFoundation(page, '/tasks/101')
  await expect(page.locator('[data-slot="record-summary"]')).toContainText('نورة الحربي')
  await page.route('**/api/v1/tasks/101', route => route.fulfill({ status: 500, json: { code: 'internal', message: 'تعذر التحديث' } }))
  await page.clock.install()
  await page.clock.fastForward(6000)
  await page.evaluate(() => window.dispatchEvent(new Event('visibilitychange')))
  await expect(page.locator('[data-slot="error-state"]')).toBeVisible()
  await expect(page.locator('[data-slot="record-summary"]')).toContainText('نورة الحربي')
  await expect(page.locator('[data-slot="record-main"]')).toBeVisible()
  await expect(page.getByRole('button', { name: 'إعادة المحاولة', exact: true })).toBeVisible()
})
