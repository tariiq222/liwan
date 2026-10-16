import { expect, test } from '@playwright/test'
import { enterFoundation, foundationOrigin, foundationTask } from './support/uxFoundations'

test.describe.configure({ timeout: 60_000 })

test('a project task opened from my work returns to that same filtered list after refresh', async ({ page }) => {
  await enterFoundation(page, foundationOrigin)
  const task = page.locator('tbody').getByRole('link', { name: foundationTask.name, exact: true })
  await expect(task).toBeVisible()
  await task.click()
  await expect(page).toHaveURL(/\/projects\/1\/tasks\/101\?/)
  await page.reload()
  await expect(page.getByTestId('task-detail-back')).toBeEnabled()
  await page.getByTestId('task-detail-back').click()
  await expect.poll(() => new URL(page.url()).pathname).toBe('/my-tasks')
  await expect.poll(() => new URL(page.url()).searchParams.get('q')).toBe('مهمة')
  expect(new URL(page.url()).searchParams.get('scope')).toBe('assigned')
  expect(new URL(page.url()).hash).toBe('#tasks')
})

test('closing a calendar-created meeting restores its calendar rather than the default meeting list', async ({ page }) => {
  const origin = '/meetings/calendar?year=2026&month=10#day-15'
  await enterFoundation(page, `/meetings/new?returnTo=${encodeURIComponent(origin)}`)
  await expect(page.getByRole('dialog')).toBeVisible()
  await page.getByRole('dialog').getByRole('button', { name: 'إغلاق', exact: true }).click()
  await expect.poll(() => new URL(page.url()).pathname).toBe('/meetings/calendar')
  expect(new URL(page.url()).searchParams.get('month')).toBe('10')
  expect(new URL(page.url()).hash).toBe('#day-15')
})

test('a record click before search debounce carries the live search instead of the old URL', async ({ page }) => {
  await enterFoundation(page, foundationOrigin)
  await expect(page.locator('tbody a[href*="/projects/1/tasks/101"]')).toBeVisible()
  const before = await page.evaluate(async () => {
    const input = document.querySelector<HTMLInputElement>('[data-shortcut-search] input')!
    input.value = 'مهمة & متابعة'
    input.dispatchEvent(new Event('input', { bubbles: true }))
    await Promise.resolve()
    const oldSearch = new URL(location.href).searchParams.get('q')
    document.querySelector<HTMLAnchorElement>('tbody a[href*="/projects/1/tasks/101"]')!.click()
    return oldSearch
  })
  expect(before).toBe('مهمة')
  await expect(page).toHaveURL(/\/projects\/1\/tasks\/101\?/)
  const origin = new URL(new URL(page.url()).searchParams.get('returnTo')!, page.url())
  expect(origin.searchParams.get('q')).toBe('مهمة & متابعة')
  await page.getByTestId('task-detail-back').click()
  await expect(page.locator('[data-shortcut-search] input')).toHaveValue('مهمة & متابعة')
})

test('copy cancel returns to the source project and a copied record accepts that same bounded parent', async ({ page }) => {
  const source = '/projects/1?returnTo=%2Fprojects%3Fq%3Dreview'
  await enterFoundation(page, source)
  await page.getByTestId('project-copy-link').click()
  await expect(page.getByRole('dialog')).toBeVisible()
  await page.getByRole('dialog').getByRole('button', { name: 'إغلاق', exact: true }).click()
  await expect.poll(() => new URL(page.url()).pathname).toBe('/projects/1')
  expect(new URL(page.url()).searchParams.get('returnTo')).toBe('/projects?q=review')
  await page.goto(`/projects/2?returnTo=${encodeURIComponent(source)}`)
  await page.getByTestId('project-workspace-back').click()
  await expect.poll(() => new URL(page.url()).pathname).toBe('/projects/1')
  expect(new URL(page.url()).searchParams.get('returnTo')).toBe('/projects?q=review')
})

test('RACI task and stakeholder links return to their matrix source', async ({ page }) => {
  const source = '/projects/2/raci?closed=1#matrix'
  await enterFoundation(page, source)
  const matrix = page.getByTestId('raci-matrix')
  await expect(matrix).toBeVisible()
  const task = matrix.locator('a[href*="/tasks/"]').first()
  await task.click()
  await page.getByTestId('task-detail-back').click()
  await expect.poll(() => new URL(page.url()).pathname).toBe('/projects/2/raci')
  expect(new URL(page.url()).searchParams.get('closed')).toBe('1')
  await matrix.locator('a[href*="/stakeholders/"]').first().click()
  await page.locator('[data-template="record"] [data-slot="page-header"] a').first().click()
  await expect.poll(() => new URL(page.url()).pathname).toBe('/projects/2/raci')
  expect(new URL(page.url()).searchParams.get('closed')).toBe('1')
})
