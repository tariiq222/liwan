import AxeBuilder from '@axe-core/playwright'
import { expect, test } from '@playwright/test'
import { requireStorybook, startStorybookServer, storybookEntries } from './support/storybookServer'
import { VISUAL_AXE_STORIES, VISUAL_DIALOG_STORIES, VISUAL_MATRIX, VISUAL_MOBILE_STORIES, VISUAL_STORIES } from './support/visualStories'

const stories = storybookEntries()
  .filter(entry => entry.type === 'story' && VISUAL_STORIES.some(prefix => entry.id.startsWith(prefix)))

let base = ''
let close: () => Promise<void> = async () => {}

test.describe('Storybook visual snapshots', () => {
  requireStorybook()
  test.use({ viewport: { width: 1280, height: 800 }, deviceScaleFactor: 1 })

  test.beforeAll(async () => { ({ base, close } = await startStorybookServer()) })
  test.afterAll(async () => { await close() })

  for (const story of stories) {
    for (const { locale, appearance } of VISUAL_MATRIX) {
      test(`${story.id} ${locale}-${appearance}`, async ({ page }) => {
        await page.emulateMedia({ reducedMotion: 'reduce' })
        await page.goto(`${base}/iframe.html?id=${story.id}&viewMode=story&globals=locale:${locale};appearance:${appearance}`)
        await page.locator('#storybook-root').waitFor()
        await page.waitForLoadState('networkidle')
        await page.evaluate(() => document.fonts.ready)
        await expect(page.locator('#storybook-root')).toHaveScreenshot(`${story.id}-${locale}-${appearance}.png`, {
          animations: 'disabled',
          maxDiffPixelRatio: 0.002,
          threshold: 0.05,
        })
      })
    }
  }

  for (const story of storybookEntries().filter(entry => entry.type === 'story' && VISUAL_MOBILE_STORIES.some(prefix => entry.id.startsWith(prefix)))) {
    for (const { locale, appearance } of VISUAL_MATRIX) {
      test(`${story.id} ${locale}-${appearance} mobile`, async ({ page }) => {
        await page.setViewportSize({ width: 390, height: 844 })
        await page.emulateMedia({ reducedMotion: 'reduce' })
        await page.goto(`${base}/iframe.html?id=${story.id}&viewMode=story&globals=locale:${locale};appearance:${appearance}`)
        await page.locator('#storybook-root').waitFor()
        await page.waitForLoadState('networkidle')
        await page.evaluate(() => document.fonts.ready)
        await expect(page).toHaveScreenshot(`${story.id}-${locale}-${appearance}-mobile.png`, { animations: 'disabled', maxDiffPixelRatio: 0.002, threshold: 0.05 })
      })
    }
  }

  for (const story of storybookEntries().filter(entry => entry.type === 'story' && VISUAL_DIALOG_STORIES.some(prefix => entry.id.startsWith(prefix)))) {
    const visit = async (page: import('@playwright/test').Page, locale: string, appearance: string, manualA11y = false) => {
      await page.emulateMedia({ reducedMotion: 'reduce' })
      await page.goto(`${base}/iframe.html?id=${story.id}&viewMode=story&globals=locale:${locale};appearance:${appearance}${manualA11y ? ';a11y.manual:!true' : ''}`)
      await page.getByRole('dialog').waitFor()
      await page.waitForLoadState('networkidle')
      await expect(page.locator('[role="dialog"] .animate-spin')).toHaveCount(0)
      await page.evaluate(() => document.fonts.ready)
    }
    for (const { locale, appearance } of VISUAL_MATRIX) {
      test(`${story.id} ${locale}-${appearance} dialog`, async ({ page }) => {
        await visit(page, locale, appearance)
        await expect(page).toHaveScreenshot(`${story.id}-${locale}-${appearance}-dialog.png`, { animations: 'disabled', maxDiffPixelRatio: 0.002, threshold: 0.05 })
      })
    }
    test(`${story.id} dialog has no serious axe violations`, async ({ page }) => {
      for (const { locale, appearance } of VISUAL_MATRIX) {
        // This test owns the audit. Keep Storybook's addon in its supported manual
        // mode so its afterEach audit cannot race AxeBuilder on the same document.
        await visit(page, locale, appearance, true)
        const result = await new AxeBuilder({ page }).include('[role="dialog"]').analyze()
        const serious = result.violations.filter(v => v.impact === 'serious' || v.impact === 'critical')
        expect(serious.map(v => ({ mode: `${locale}-${appearance}`, rule: v.id, nodes: v.nodes.map(node => ({ target: node.target, summary: node.failureSummary })) }))).toEqual([])
      }
    })
  }

  for (const story of stories.filter(entry => VISUAL_AXE_STORIES.some(prefix => entry.id.startsWith(prefix)))) {
    test(`${story.id} has no serious axe violations`, async ({ page }) => {
      for (const { locale, appearance } of VISUAL_MATRIX) {
        // globals.a11y.manual affects the addon only; AxeBuilder still audits every combination.
        await page.goto(`${base}/iframe.html?id=${story.id}&viewMode=story&globals=locale:${locale};appearance:${appearance};a11y.manual:!true`)
        await page.locator('#storybook-root').waitFor()
        const result = await new AxeBuilder({ page }).include('#storybook-root').analyze()
        const serious = result.violations.filter(v => v.impact === 'serious' || v.impact === 'critical')
        expect(serious.map(v => ({ mode: `${locale}-${appearance}`, rule: v.id, nodes: v.nodes.map(node => ({ target: node.target, summary: node.failureSummary })) }))).toEqual([])
      }
    })
  }
})
