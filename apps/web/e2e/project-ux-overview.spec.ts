import { expect, test } from '@playwright/test'
import { login, open } from './support/tasmim6'

test.beforeEach(async ({ page, context, baseURL }) => {
  // The context menu starts folded; these checks click its dashboard link.
  await context.addCookies([{ name: 'liwan-context-sidebar', value: 'open', url: baseURL! }])
  await login(page)
  await open(page, '/projects')
})

for (const state of ['empty', 'error'] as const) {
  test(`pending charter decisions remain visible with ${state} analytics`, async ({ page }) => {
    await page.route('**/api/v1/reports/projects/analytics**', route => route.fulfill({
      status: state === 'error' ? 503 : 200, contentType: 'application/json',
      body: JSON.stringify(state === 'error' ? { code: 'unavailable', message: 'تعذر التحميل' } : {
        project_count: 0, attention_project_count: 0, overdue_task_count: 0,
        status_counts: [], totals: [], attention: [], projects: [], recent_projects: [],
      }),
    }))
    await page.getByTestId('context-link-project-dashboard').click()
    await expect(page.getByTestId('pending-charters')).toBeVisible()
    await expect(page.getByTestId('pending-charters')).toContainText('ميثاق بانتظار الاعتماد')
    await expect(page.getByTestId('pending-charters').getByRole('link', { name: 'مراجعة الميثاق', exact: true })).toHaveAttribute('href', '/projects/8001/charter')
    await expect(page.getByTestId(state === 'error' ? 'project-dashboard-analytics-error' : 'project-dashboard-empty')).toBeVisible()
  })
}

test('a failed milestone lookup is an error, never an empty milestone claim', async ({ page }) => {
  await page.route('**/api/v1/projects/1/milestones', route => route.fulfill({
    status: 503, contentType: 'application/json', body: JSON.stringify({ code: 'unavailable', message: 'تعذر تحميل المعالم' }),
  }))
  await page.getByRole('link', { name: 'مشروع ألفا', exact: true }).click()
  await expect(page.getByTestId('project-overview-milestone-error')).toBeVisible({ timeout: 10000 })
  await expect(page.getByText('لا توجد معالم في المشروع', { exact: true })).toHaveCount(0)
  await expect(page.getByTestId('project-overview-latest-update')).toBeVisible()
})
