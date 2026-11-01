import { expect, test } from '@playwright/test'
import { fitsWidth, loginAdmin, mockAdminApi, openClientSide } from './support/tasmim6d'

// Plan 6d: /settings/team/access-log/:id on SharedRecordPage.
test.describe('Plan 6d: an access-log event', () => {
  test.beforeEach(async ({ page }) => { await loginAdmin(page); await mockAdminApi(page) })

  test.describe('desktop', () => {
    test.use({ viewport: { width: 1440, height: 900 } })

    test('is the record template with the facts in the aside and before/after sections', async ({ page }) => {
      await openClientSide(page, '/settings/team/access-log/31?action=user.granted')
      await expect(page.getByRole('heading', { level: 1 })).toHaveCount(1)
      await expect(page.locator('[data-template="record"]')).toHaveCount(1)
      await expect(page.getByTestId('settings-layout')).toBeVisible()
      const facts = page.locator('#event')
      await expect(facts).toContainText('Admin')
      await expect(facts).not.toContainText(/\d{4}-\d{2}-\d{2}T/)
      await expect(facts).toContainText('سارة محمد')
      await expect(page.locator('#before pre')).toContainText('null')
      await expect(page.locator('#after pre')).toContainText('"active": true')
      await expect(page.locator('pre').first()).toHaveAttribute('dir', 'ltr')
    })

    test('the back link returns to the log with its filters', async ({ page }) => {
      await openClientSide(page, '/settings/team/access-log/31?action=user.granted&offset=25')
      await page.getByRole('link', { name: 'رجوع' }).first().click()
      await expect(page).toHaveURL(/\/settings\/team\/access-log\?.*action=user\.granted/)
    })

    test('a missing event shows the not-found state under one heading', async ({ page }) => {
      for (const id of ['999', '0', 'abc', '-1', '1.5', '9007199254740992']) {
        await openClientSide(page, `/settings/team/access-log/${id}`)
        await expect(page.getByRole('heading', { level: 1 })).toHaveCount(1)
        await expect(page.locator('[data-slot="not-found-state"]')).toBeVisible()
        await expect(page.locator('#event')).toHaveCount(0)
      }
    })
  })

  test.describe('phone', () => {
    test.use({ viewport: { width: 390, height: 844 } })
    test('on a 390px phone the JSON scrolls inside its section, not the page', async ({ page }) => {
      await openClientSide(page, '/settings/team/access-log/31')
      await expect(page.locator('#after')).toBeVisible()
      expect(await fitsWidth(page)).toBe(true)
    })
  })
})
