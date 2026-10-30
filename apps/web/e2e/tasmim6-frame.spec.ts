import { expect, test } from '@playwright/test'
import { DESKTOP, PHONE, login, open, rows, mobileRows, fitsWidth, expectFrameOwnsH1 } from './support/tasmim6'

const SECTIONS: [string, string][] = [
  ['/projects/2', 'summary'], ['/projects/2/tasks', 'execution'], ['/projects/2/milestones', 'milestones'],
  ['/projects/2/schedule', 'schedule'], ['/projects/2/finance', 'finance'], ['/projects/2/updates', 'updates'],
  ['/projects/2/meetings', 'meetings'], ['/projects/2/stakeholders', 'governance'], ['/projects/2/raci', 'governance'],
  ['/projects/2/register', 'governance'], ['/projects/2/charter', 'governance'], ['/projects/2/settings', ''],
]

test.describe('Plan 6a: the project frame', () => {
  test.beforeEach(async ({ page }) => { await login(page) })

  test('every section page has the frame\'s name as its only h1', async ({ page }) => {
    await page.setViewportSize(DESKTOP)
    for (const [path] of SECTIONS) {
      await open(page, path)
      await expectFrameOwnsH1(page)
      await expect(page.getByTestId('project-workspace-frame')).toBeVisible()
    }
  })

  test('the governance sub-strip shows on the four governance pages and marks the current one', async ({ page }) => {
    for (const [path, id] of [['/projects/2/stakeholders', 'stakeholders'], ['/projects/2/raci', 'raci'], ['/projects/2/register', 'register'], ['/projects/2/charter', 'charter']]) {
      await open(page, path)
      await expect(page.getByTestId('project-governance-tabs')).toBeVisible()
      await expect(page.getByTestId(`governance-tab-${id}`)).toHaveAttribute('aria-current', 'page')
    }
    await open(page, '/projects/2/milestones')
    await expect(page.getByTestId('project-governance-tabs')).toHaveCount(0)
    await expect(page.getByTestId('project-workspace-tabs')).toBeVisible()
  })

  test('the frame does not print', async ({ page }) => {
    await open(page, '/projects/2/milestones')
    await expect(page.getByTestId('project-workspace-frame')).toHaveClass(/liwan-print-hide/)
    await page.emulateMedia({ media: 'print' })
    await expect(page.getByTestId('project-workspace-frame')).toBeHidden()
  })

  test('project settings is a settings page inside the frame and marks the gear current', async ({ page }) => {
    await open(page, '/projects/2/settings')
    await expect(page.getByTestId('settings-layout')).toHaveCount(1)
    await expect(page.getByTestId('project-settings-page')).toBeVisible()
    await expect(page.getByTestId('project-workspace-settings')).toHaveAttribute('aria-current', 'page')
  })

  test('a read-only viewer has no gear and no settings form', async ({ page }) => {
    await open(page, '/projects/3')
    await expect(page.getByTestId('project-workspace-settings')).toHaveCount(0)
    await open(page, '/projects/3/settings')
    await expect(page.getByTestId('project-settings-page')).toHaveCount(0)
  })

  test.describe('phone', () => {
    test.use({ viewport: PHONE })
    test('the frame and its tabs fit a 390px phone', async ({ page }) => {
      await open(page, '/projects/2/register')
      await expect(page.getByTestId('project-workspace-tabs')).toBeVisible()
      expect(await fitsWidth(page)).toBe(true)
    })
  })
})
