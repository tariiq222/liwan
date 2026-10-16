import { expect, test } from '@playwright/test'
import { login, open } from './support/tasmim6'

test.beforeEach(async ({ page }) => { await login(page) })

test('milestones are compact links to readable records with their own checklist', async ({ page }) => {
  await open(page, '/projects/2/milestones')
  await expect(page.getByTestId('milestone-table').getByRole('switch')).toHaveCount(0)
  await page.getByRole('link', { name: 'إطلاق النموذج الأول', exact: true }).click()
  await expect(page).toHaveURL(/\/projects\/2\/milestones\/12\?/)
  await expect(page.getByRole('switch', { name: 'نموذج قابل للتجربة', exact: true })).toBeEnabled()
  await page.getByTestId('milestone-detail-edit').click()
  await expect(page).toHaveURL(/\/milestones\/12\/edit\?/)
  await page.getByRole('button', { name: 'إلغاء', exact: true }).click()
  await expect(page).toHaveURL(/\/milestones\/12\?/)
  await page.getByTestId('milestone-detail-back').click()
  await expect(page).toHaveURL(/\/projects\/2\/milestones$/)
})

test('a milestone viewer reads deliverables without edit controls', async ({ page }) => {
  await open(page, '/projects/3/milestones/12')
  await expect(page.getByRole('switch', { name: 'نموذج قابل للتجربة', exact: true })).toBeDisabled()
  await expect(page.getByTestId('milestone-detail-edit')).toHaveCount(0)
})

test('both timeline links and the former schedule editor lead to one task record', async ({ page }) => {
  await open(page, '/projects/1/schedule?scale=month')
  await page.locator('.schedule-gantt-task').first().click()
  await expect(page).toHaveURL(/\/projects\/1\/tasks\/101\?.*#schedule$/)
  await expect(page.getByTestId('project-task-schedule-section')).toBeVisible()
  await page.getByTestId('task-detail-back').click()
  await expect(page).toHaveURL(/\/projects\/1\/schedule\?scale=month$/)
  await open(page, '/projects/1/schedule/tasks/101?returnTo=%2Fprojects%2F1%2Fschedule%3Fscale%3Dmonth')
  await expect(page).toHaveURL(/\/projects\/1\/tasks\/101\?.*#schedule$/)
})
