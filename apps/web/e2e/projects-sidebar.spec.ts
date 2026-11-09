import { expect, test } from '@playwright/test'
import { login, open } from './support/tasmim6'

test.setTimeout(90_000)

// Runs against the isolated projects mock (alpha on track, beta off track, gamma at risk; every project is the admin's).
test.describe('the flat projects sidebar and the status chips', () => {
  test.use({ viewport: { width: 1440, height: 900 } })
  test.beforeEach(async ({ page }) => { await login(page) })

  test('the sidebar is one flat level: create action, four pages with counts, no expandable group', async ({ page }) => {
    await open(page, '/projects?view=table')
    const menu = page.getByTestId('application-navigation')
    await expect(menu.getByTestId('navigation-app-block')).toHaveText('المشاريع')
    await expect(menu.getByTestId('quick-action-new-project')).toHaveAttribute('href', /\/projects\/new/)
    await expect(menu.locator('a[data-testid^="context-link-"], button[data-testid^="context-link-"]')).toHaveText(['نظرة عامة', 'المشاريع3', 'مهامي2', 'تحتاج انتباه2'])
    await expect(menu.locator('[aria-expanded], .liwan-side-branch')).toHaveCount(0)
    await expect(menu.getByTestId('context-link-projects')).toHaveAttribute('aria-current', 'page')
    await expect(menu.getByTestId('context-link-tasks')).toHaveAttribute('href', '/tasks?assignee=me')
    // The status presets are no longer sidebar rows.
    for (const gone of ['quick-view-mine', 'quick-view-at-risk', 'quick-view-done', 'context-link-projects-all', 'submenu-projects']) await expect(menu.getByTestId(gone)).toHaveCount(0)
  })

  test('choosing a chip writes it to the URL and filters the list; a reload keeps it', async ({ page }) => {
    await open(page, '/projects?view=table')
    await expect(page.getByTestId('project-row')).toHaveCount(3)
    await expect(page.getByTestId('projects-chip-all')).toHaveAttribute('aria-pressed', 'true')
    await expect(page.getByTestId('projects-chip-attention')).toContainText('2')
    await page.getByTestId('projects-chip-off_track').click()
    await expect(page).toHaveURL(/status=off_track/)
    await expect(page).toHaveURL(/view=table/)
    await expect(page.getByTestId('project-row')).toHaveCount(1)
    await expect(page.getByTestId('project-row')).toContainText('مشروع بيتا')
    await expect(page.getByTestId('projects-chip-off_track')).toHaveAttribute('aria-pressed', 'true')
    await expect(page.getByTestId('projects-chip-all')).toHaveAttribute('aria-pressed', 'false')
    await page.reload()
    await expect(page.getByTestId('projects-chip-off_track')).toHaveAttribute('aria-pressed', 'true')
    await expect(page.getByTestId('project-row')).toHaveCount(1)
    await page.getByTestId('projects-chip-all').click()
    await expect(page).not.toHaveURL(/status=/)
    await expect(page.getByTestId('project-row')).toHaveCount(3)
  })

  test('needs attention opens the list pre-filtered to at risk and off track, lit in the sidebar and as a chip', async ({ page }) => {
    await open(page, '/projects?view=table')
    const menu = page.getByTestId('application-navigation')
    await menu.getByTestId('context-link-projects-attention').click()
    await expect(page).toHaveURL(/status=attention/)
    await expect(page.getByTestId('project-row')).toHaveCount(2)
    await expect(page.getByTestId('project-row').filter({ hasText: 'مشروع بيتا' })).toHaveCount(1)
    await expect(page.getByTestId('project-row').filter({ hasText: 'مشروع جاما' })).toHaveCount(1)
    await expect(page.getByTestId('projects-chip-attention')).toHaveAttribute('aria-pressed', 'true')
    await expect(menu.getByTestId('context-link-projects-attention')).toHaveAttribute('aria-current', 'page')
    await expect(menu.getByTestId('context-link-projects')).not.toHaveAttribute('aria-current', 'page')
    // A direct link behaves the same.
    await page.goto('/projects?status=attention&view=table')
    await expect(page.getByTestId('projects-chip-attention')).toHaveAttribute('aria-pressed', 'true')
    await expect(page.getByTestId('project-row')).toHaveCount(2)
  })

  test('my tasks opens the assigned list and keeps the board layout', async ({ page }) => {
    await open(page, '/tasks?view=board')
    const menu = page.getByTestId('application-navigation')
    await expect(menu.getByTestId('context-link-tasks')).toHaveAttribute('aria-current', 'page')
    await expect(menu.getByTestId('context-link-tasks')).toHaveAttribute('href', '/tasks?assignee=me&view=board')
    await menu.getByTestId('context-link-tasks').click()
    await expect(page).toHaveURL(/assignee=me/)
    await expect(page).toHaveURL(/view=board/)
  })

  test('an opened project is listed under the recent ones and lit while its pages are open', async ({ page }) => {
    await open(page, '/projects/1')
    const menu = page.getByTestId('application-navigation')
    await expect(menu.getByTestId('recent-project-1')).toHaveText('مشروع ألفا')
    await expect(menu.getByTestId('recent-project-1')).toHaveAttribute('aria-current', 'page')
    await open(page, '/projects/2')
    await expect(menu.getByTestId('recent-project-2')).toHaveAttribute('aria-current', 'page')
    await expect(menu.locator('[data-testid^="recent-project-"]')).toHaveText(['مشروع بيتا', 'مشروع ألفا'])
    await page.reload()
    await expect(menu.locator('[data-testid^="recent-project-"]')).toHaveCount(2)
  })

  test('the icon-only rail names every row on hover', async ({ page }) => {
    await page.setViewportSize({ width: 900, height: 900 })
    await open(page, '/projects?view=table')
    const menu = page.getByTestId('application-navigation')
    for (const [id, label] of [['tasks', 'مهامي'], ['projects-attention', 'تحتاج انتباه']] as const) {
      await menu.getByTestId(`context-link-${id}`).hover()
      await expect(page.locator('[role="tooltip"]').filter({ hasText: label })).toHaveCount(1)
      await page.mouse.move(700, 600)
    }
  })
})
