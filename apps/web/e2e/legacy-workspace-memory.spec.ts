import { expect, test } from '@playwright/test'
import { DESKTOP, login } from './support/tasmim6'

test.use({ viewport: DESKTOP })
test.setTimeout(60_000)
const expectReady = expect.configure({ timeout: 15_000 })
async function ready(page: import('@playwright/test').Page, path: string) {
  await page.goto(path, { waitUntil: 'domcontentloaded' })
  await expectReady(page.getByTestId('global-search-trigger')).toBeEnabled()
}
test.beforeEach(async ({ page }) => { await login(page) })

test('task board search survives section navigation with the project list origin', async ({ page }) => {
  await ready(page, '/projects/1/tasks?view=board&q=مهمة&returnTo=%2Fprojects%3Fmine%3D1&projectListReturnTo=%2Fprojects%3Fmine%3D1')
  await page.getByTestId('project-tab-summary').click()
  await expect(page.getByTestId('project-tab-summary')).toHaveAttribute('aria-current', 'page')
  expect(new URL(page.url()).searchParams.get('projectListReturnTo')).toBe('/projects?mine=1')
  await page.getByTestId('project-tab-tasks').click()
  await expect(page).toHaveURL(/\/projects\/1\/tasks\?/)
  const query = new URL(page.url()).searchParams
  expect(query.get('view')).toBe('board')
  expect(query.get('q')).toBe('مهمة')
  expect(query.get('projectListReturnTo')).toBe('/projects?mine=1')
  await expect(page.getByRole('textbox', { name: 'بحث في العناوين…' })).toHaveValue('مهمة')
})

test('opening a project card restores its task board after reload and replaces list origin', async ({ page }) => {
  await ready(page, '/projects/1/tasks?view=board&q=مهمة')
  await expect(page.getByTestId('project-workspace-name')).toBeVisible()
  await ready(page, '/projects?mine=1')
  await page.reload({ waitUntil: 'domcontentloaded' })
  await expect(page.getByTestId('global-search-trigger')).toBeEnabled()
  await page.getByTestId('project-card').filter({ hasText: 'مشروع ألفا' }).getByRole('link', { name: 'مشروع ألفا', exact: true }).click()
  await expect(page).toHaveURL(/\/projects\/1\/tasks\?/)
  const query = new URL(page.url()).searchParams
  expect(query.get('q')).toBe('مهمة')
  expect(query.get('view')).toBe('board')
  expect(query.get('projectListReturnTo')).toBe('/projects?mine=1')
})

test('opening and cancelling task creation keeps the last readable project section', async ({ page }) => {
  await ready(page, '/projects/1/register?q=اعتماد&kind=risk')
  await expect(page.getByTestId('project-workspace-name')).toBeVisible()
  await page.getByRole('link', { name: 'إضافة خطر أو مشكلة' }).click()
  await expect(page.getByRole('dialog')).toBeVisible()
  await page.keyboard.press('Escape')
  await expect(page).toHaveURL(/\/projects\/1\/register\?/)
  await ready(page, '/projects')
  await page.getByTestId('project-card').filter({ hasText: 'مشروع ألفا' }).getByRole('link', { name: 'مشروع ألفا', exact: true }).click()
  await expect(page).toHaveURL(/\/projects\/1\/register\?/)
  expect(new URL(page.url()).searchParams.get('q')).toBe('اعتماد')
  expect(new URL(page.url()).searchParams.get('kind')).toBe('risk')
})

test('dirty project task creation keeps its draft through Escape and browser back until discard', async ({ page }) => {
  await ready(page, '/projects/1/tasks?q=مهمة&view=board')
  await page.getByRole('link', { name: 'مهمة جديدة', exact: true }).click()
  const input = page.getByRole('textbox', { name: /^عنوان المهمة/ })
  await input.fill('مسودة لا تحفظ')
  await page.keyboard.press('Escape')
  const guard = page.getByTestId('unsaved-changes-dialog')
  await expect(guard).toBeVisible()
  await guard.getByRole('button', { name: 'البقاء في الصفحة', exact: true }).click()
  await expect(input).toHaveValue('مسودة لا تحفظ')
  await page.goBack()
  await expect(guard).toBeVisible()
  await guard.getByRole('button', { name: 'البقاء في الصفحة', exact: true }).click()
  await expect(input).toHaveValue('مسودة لا تحفظ')
  await page.keyboard.press('Escape')
  await guard.getByRole('button', { name: 'المغادرة بدون حفظ', exact: true }).click()
  await expect(page).toHaveURL(/\/projects\/1\/tasks\?/)
  expect(new URL(page.url()).searchParams.get('q')).toBe('مهمة')
  expect(new URL(page.url()).searchParams.get('view')).toBe('board')
  await expect(page.getByRole('dialog')).toHaveCount(0)
})
