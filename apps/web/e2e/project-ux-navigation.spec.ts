import { expect, test } from '@playwright/test'
import { login, open } from './support/tasmim6'

test.beforeEach(async ({ page }) => { await login(page) })

test('the milestones stay under the tasks tab, keep their URL on refresh and lead back to the timeline view', async ({ page }) => {
  await open(page, '/projects/1/milestones?projectListReturnTo=%2Fprojects%3Fq%3Dalpha')
  await expect(page.getByTestId('project-tab-tasks')).toHaveAttribute('aria-current', 'page')
  await expect(page.getByTestId('planning-tab-milestones')).toHaveAttribute('aria-current', 'page')
  await page.reload()
  await expect(page.getByTestId('planning-tab-milestones')).toHaveAttribute('aria-current', 'page')
  await page.getByTestId('planning-tab-timeline').click()
  await expect(page).toHaveURL(/\/projects\/1\/tasks\?(.*&)?view=timeline/)
  await expect(page.getByTestId('project-tab-tasks')).toHaveAttribute('aria-current', 'page')
  await expect(page.getByTestId('project-workspace-name')).toHaveText('مشروع ألفا')
})

for (const destination of ['create', 'record'] as const) {
  test(`task search survives immediate ${destination} and return`, async ({ page }) => {
    await open(page, destination === 'record' ? '/projects/1/tasks?view=table&closed=1' : '/projects/1/tasks?view=board&closed=1')
    await expect(page.getByRole('textbox')).toBeEnabled()
    const selector = destination === 'create' ? '[data-testid="project-header-create"]' : 'a[href*="/projects/1/tasks/103"]'
    await expect(page.locator(selector).first()).toBeVisible()
    // Navigation can take longer than the search debounce while access is refreshed.
    await page.route('**/api/v1/me', async route => {
      await new Promise(resolve => setTimeout(resolve, 600))
      await route.continue()
    })
    await page.evaluate(({ selector }) => {
      const input = document.querySelector<HTMLInputElement>('input[placeholder="بحث في العناوين…"]')!
      input.value = 'مهمة'
      input.dispatchEvent(new Event('input', { bubbles: true }))
      document.querySelector<HTMLElement>(selector)!.click()
    }, { selector })
    await expect(page).toHaveURL(destination === 'create' ? /\/tasks\/new\?/ : /\/tasks\/103\?/)
    expect(new URL(page.url()).searchParams.get('q')).toBe('مهمة')
    if (destination === 'create') await page.getByRole('button', { name: 'إغلاق', exact: true }).click()
    else await page.getByTestId('task-detail-back').click()
    await expect(page).toHaveURL(/\/projects\/1\/tasks\?/)
    expect(new URL(page.url()).searchParams.get('q')).toBe('مهمة')
    expect(new URL(page.url()).searchParams.get('view')).toBe(destination === 'record' ? 'table' : 'board')
    expect(new URL(page.url()).searchParams.get('closed')).toBe('1')
  })
}
