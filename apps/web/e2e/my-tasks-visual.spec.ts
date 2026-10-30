import { expect, test } from '@playwright/test'
import { mkdir } from 'node:fs/promises'
import { startStorybookServer, requireStorybook } from './support/storybookServer'

// Geometry/state coverage, with inspectable screenshots; does not silently update reference baselines.
const stories = ['mytasks-mytaskform--create', 'mytasks-mytaskform--edit', 'mytasks-mytaskrecord--open', 'mytasks-mytaskrow--personal', 'shared-checklist--controlled-draft', 'mytasks-mytaskrow--cards']
const screenshotDir = process.env.E2E_MY_TASKS_VISUAL_DIR ?? '/tmp/liwan-my-tasks-visual'
let base = ''
let close: () => Promise<void>
requireStorybook()
test.beforeAll(async () => { ({ base, close } = await startStorybookServer()); await mkdir(screenshotDir, { recursive: true }) })
test.afterAll(async () => { await close() })
for (const locale of ['ar', 'en']) for (const appearance of ['light', 'dark']) for (const fontSize of ['small', 'medium', 'large']) for (const width of [390, 768, 1440]) {
  test(`${locale} ${appearance} ${fontSize} ${width}`, async ({ page }) => {
    await page.setViewportSize({ width, height: 1000 })
    await page.emulateMedia({ reducedMotion: 'reduce' })
    for (const id of stories) {
      const errors: string[] = []
      const onError = (error: Error) => errors.push(error.message)
      page.on('pageerror', onError)
      await page.goto(`${base}/iframe.html?id=${id}&viewMode=story&globals=locale:${locale};appearance:${appearance};fontSize:${fontSize}`)
      await expect(page.locator('body')).toHaveClass(/sb-show-main/)
      await page.locator('#storybook-root').waitFor({ state: 'attached' })
      await expect(page.locator('html')).toHaveAttribute('dir', locale === 'ar' ? 'rtl' : 'ltr')
      await expect(page.locator('html')).toHaveAttribute('data-font-size', fontSize)
      await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth), { message: `${id} horizontal overflow` }).toBeLessThanOrEqual(1)
      expect(errors, id).toEqual([])
      if (id === 'mytasks-mytaskrecord--open') await expect(page.locator('[data-slot="record-summary"]')).toBeVisible()
      await page.screenshot({ path: `${screenshotDir}/${id}-${locale}-${appearance}-${fontSize}-${width}.png`, fullPage: true })
      page.off('pageerror', onError)
    }
  })
}
