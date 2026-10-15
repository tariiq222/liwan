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

test('long creation keeps Next visible and submits its own form from the footer', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 })
  await enterFoundation(page, '/projects/new')
  const next = page.getByRole('button', { name: 'التالي', exact: true })
  await expect(next).toBeEnabled()
  await expect.poll(async () => {
    const rect = await next.boundingBox()
    return rect ? rect.y + rect.height <= 844 : false
  }).toBe(true)
  await page.getByTestId('project-create-name').fill('مشروع رحلة القالب')
  await next.click()
  await expect(page.getByTestId('charter-step-position')).toContainText('الخطوة 2')
  await page.getByTestId('charter-step-previous').click()
  await expect(page.getByTestId('project-create-name')).toHaveValue('مشروع رحلة القالب')
  await next.click()
  await expect(page.getByTestId('charter-step-position')).toContainText('الخطوة 2')
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true)
})

test('the operational record summary precedes the task description on a phone', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 })
  await enterFoundation(page, '/tasks/101')
  const summary = page.locator('[data-slot="record-summary"]')
  await expect(summary).toBeVisible()
  const content = page.locator('[data-slot="record-main"]')
  expect((await summary.boundingBox())!.y).toBeLessThan((await content.boundingBox())!.y)
  await expect(summary).toContainText('نورة الحربي')
})

test.describe('touch controls', () => {
  test.use({ hasTouch: true, isMobile: true, viewport: { width: 390, height: 844 } })
  test('creation actions have 44px touch targets after moving outside the shell', async ({ page }) => {
    await enterFoundation(page, '/projects/new')
    const next = page.getByRole('button', { name: 'التالي', exact: true })
    await expect(next).toBeVisible()
    const box = (await next.boundingBox())!
    const minimum = await next.evaluate(element => ({ width: getComputedStyle(element).minWidth, height: getComputedStyle(element).minHeight }))
    expect(minimum).toEqual({ width: '44px', height: '44px' })
    // Chromium can report a CSS 44px edge as 43.999999046px; tolerate only that rounding.
    expect(box.height + 0.001).toBeGreaterThanOrEqual(44)
    expect(box.width + 0.001).toBeGreaterThanOrEqual(44)
  })
})
