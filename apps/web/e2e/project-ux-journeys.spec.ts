import { expect, test } from '@playwright/test'
import { mkdir } from 'node:fs/promises'
import { login, open, fitsWidth } from './support/tasmim6'

for (const locale of ['ar', 'en']) for (const mode of ['light', 'dark']) {
  test(`project planning remains usable in ${locale} ${mode} at phone, tablet and desktop widths`, async ({ page, context }) => {
    test.setTimeout(90_000)
    await login(page)
    await page.request.patch('/api/v1/me/appearance', { data: { mode, font_size: 'medium' } })
    await context.addCookies([{ name: 'webvue-locale', value: locale, url: new URL('/', test.info().project.use.baseURL as string).href }])
    for (const width of [390, 768, 1440]) {
      await page.setViewportSize({ width, height: 900 })
      for (const path of ['/projects/2', '/projects/2/milestones/12', '/projects/2/schedule?scale=month']) {
        await open(page, path)
        await expect(page.locator('html')).toHaveAttribute('dir', locale === 'ar' ? 'rtl' : 'ltr')
        await expect(page.locator('html')).toHaveClass(mode === 'dark' ? /dark/ : /^(?!.*dark)/)
        await expect(page.getByRole('heading', { level: 1 })).toHaveCount(1)
        expect(await fitsWidth(page), `${locale} ${mode} ${width} ${path}`).toBe(true)
        if (path.includes('/milestones/')) await expect(page.getByTestId('milestone-detail-edit')).toBeVisible()
        if (path.includes('/schedule')) {
          await expect(page.getByTestId('planning-tab-schedule')).toHaveAttribute('aria-current', 'page')
          if (process.env.E2E_PROJECTS_SCREENSHOTS) {
            await mkdir(process.env.E2E_PROJECTS_SCREENSHOTS, { recursive: true })
            await page.screenshot({ path: `${process.env.E2E_PROJECTS_SCREENSHOTS}/planning-${locale}-${mode}-${width}.png`, fullPage: true })
          }
        }
      }
    }
    await page.request.patch('/api/v1/me/appearance', { data: { mode: 'light', font_size: 'small' } })
  })
}

test('an incomplete specific approver is protected when leaving project settings', async ({ page }) => {
  await login(page)
  await open(page, '/projects/2/settings')
  await page.getByTestId('project-approval-mode').click()
  await page.getByRole('option', { name: 'مستخدم محدد', exact: true }).click()
  await page.getByTestId('project-tab-summary').click()
  await expect(page.getByRole('dialog')).toBeVisible()
  await page.getByRole('button', { name: 'البقاء في الصفحة', exact: true }).click()
  await expect(page.getByTestId('project-approver')).toBeVisible()
  await page.getByTestId('project-approval-cancel').click()
  await page.getByTestId('project-tab-summary').click()
  await expect(page).toHaveURL(/\/projects\/2$/)
})

test('project meetings preserve the source through record, edit and creation cancellation', async ({ page }) => {
  await login(page)
  const source = '/projects/1/meetings#linked'
  await open(page, source)
  await page.locator('tbody tr a[href^="/meetings/"]').first().click()
  await expect(page).toHaveURL(/\/meetings\/1\?/)
  expect(new URL(page.url()).searchParams.get('returnTo')).toBe(source)
  await expect(page.locator('[data-template="record"] header a').filter({ hasText: 'رجوع' })).toHaveAttribute('href', source)
  await page.getByRole('link', { name: 'تعديل', exact: true }).click()
  await expect(page).toHaveURL(/\/meetings\/1\/edit\?/)
  expect(new URL(page.url()).searchParams.get('listOrigin')).toBe(source)
  await page.keyboard.press('Escape')
  await expect(page).toHaveURL(/\/meetings\/1\?/)
  await page.locator('[data-template="record"] header a').filter({ hasText: 'رجوع' }).click()
  await expect(page).toHaveURL(source)
  await page.getByTestId('project-meetings-create').click()
  await expect(page.getByRole('dialog')).toBeVisible()
  expect(new URL(page.url()).searchParams.get('project_id')).toBe('1')
  await page.getByRole('button', { name: 'إغلاق', exact: true }).click()
  await expect(page).toHaveURL(source)
})
