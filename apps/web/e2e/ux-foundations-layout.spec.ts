import { expect, test } from '@playwright/test'
import { enterFoundation } from './support/uxFoundations'

test.describe.configure({ timeout: 60_000 })

test('creation uses its actual pixel width at the small font size', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 })
  await enterFoundation(page, '/projects/new')
  const dialog = page.getByRole('dialog')
  await expect(dialog).toBeVisible()
  await expect.poll(async () => Math.round((await dialog.boundingBox())!.width)).toBe(640)
})

test('long simple creation keeps Create visible and submits its own form from the footer', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 })
  await enterFoundation(page, '/projects/new')
  const create = page.getByTestId('project-create-submit')
  await expect(create).toBeEnabled()
  const name=`مشروع رحلة القالب ${Date.now()}`
  await page.getByTestId('project-create-name').fill(name)
  await page.getByTestId('project-add-objective').click()
  await page.getByTestId('project-add-objective').click()
  await page.getByTestId('project-objective-2').fill('هدف في نهاية النموذج الطويل')
  await expect(page.locator('.liwan-create-panel-footer').getByTestId('project-create-submit')).toBeVisible()
  await expect.poll(async () => {
    const rect = await create.boundingBox()
    return rect ? rect.y + rect.height <= 844 : false
  }).toBe(true)
  expect(await create.evaluate(element=>(element as HTMLButtonElement).form?.getAttribute('data-testid'))).toBe('project-create-form')
  await expect(page.getByTestId('charter-step-next')).toHaveCount(0)
  const response=page.waitForResponse(response=>new URL(response.url()).pathname==='/api/v1/projects' && response.request().method()==='POST')
  await create.click()
  expect((await response).status()).toBe(201)
  await expect(page.getByTestId('project-workspace-name')).toHaveText(name)
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true)
})

test('the operational record summary precedes the task description on a phone', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 })
  await enterFoundation(page, '/tasks/101')
  // The task record's operational summary is its aside (the properties), which `asideFirst` places before the main column.
  const summary = page.locator('[data-slot="record-aside"]')
  await expect(summary).toBeVisible()
  const content = page.locator('[data-slot="record-main"]')
  expect((await summary.boundingBox())!.y).toBeLessThan((await content.boundingBox())!.y)
  await expect(summary).toContainText('نورة الحربي')
})

test.describe('touch controls', () => {
  test.use({ hasTouch: true, isMobile: true, viewport: { width: 390, height: 844 } })
  test('creation actions have 44px touch targets after moving outside the shell', async ({ page }) => {
    await enterFoundation(page, '/projects/new')
    const actions=[page.getByTestId('project-create-submit'),page.getByRole('button',{name:'إلغاء',exact:true})]
    for(const action of actions){
      await expect(action).toBeVisible()
      const box=(await action.boundingBox())!
      const minimum=await action.evaluate(element=>({width:getComputedStyle(element).minWidth,height:getComputedStyle(element).minHeight}))
      expect(minimum).toEqual({width:'44px',height:'44px'})
      // Tolerate only Chromium's fractional-pixel rounding.
      expect(box.height+0.001).toBeGreaterThanOrEqual(44)
      expect(box.width+0.001).toBeGreaterThanOrEqual(44)
    }
  })
})
