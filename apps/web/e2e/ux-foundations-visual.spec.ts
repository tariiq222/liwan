import { expect, test } from '@playwright/test'
import { mkdir } from 'node:fs/promises'
import { startStorybookServer, requireStorybook } from './support/storybookServer'

// Geometry/state coverage, with inspectable screenshots; does not silently update reference baselines.
const stories = ['shared-listpage--default', 'shared-recordpage--operational-summary', 'shared-createpanel--form-template', 'shared-formactions--explicit-save', 'shell-contextsidebar--automatic-tablet', 'shared-pagestate--refresh-failed']
let base = ''
let close: () => Promise<void>
requireStorybook()
test.beforeAll(async () => { ({ base, close } = await startStorybookServer()); await mkdir('/tmp/webvue-ux-visual', { recursive: true }) })
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
      if (id.includes('createpanel')) {
        await expect(page.getByRole('dialog')).toBeVisible()
        await expect.poll(async () => Math.round((await page.getByRole('dialog').boundingBox())!.width)).toBe(Math.min(640, width))
      }
      if (id.includes('operational-summary')) await expect(page.locator('[data-slot="record-summary"]')).toBeVisible()
      await page.screenshot({ path: `/tmp/webvue-ux-visual/${id}-${locale}-${appearance}-${fontSize}-${width}.png`, fullPage: true })
      page.off('pageerror', onError)
    }
  })
}
