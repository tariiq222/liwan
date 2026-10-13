import { existsSync, readFileSync } from 'node:fs'
import { expect, test } from '@playwright/test'

type Entry = { id: string; type: string; title: string; name: string }

const indexPath = 'storybook-static/index.json'
if (!existsSync(indexPath)) {
  throw new Error('storybook-static/index.json is missing; run `npm -w apps/web run build-storybook` first (npm run test:rtl does)')
}
const stories = Object.values(JSON.parse(readFileSync(indexPath, 'utf8')).entries as Record<string, Entry>)
  .filter(entry => entry.type === 'story')

// Stories that do not render at all today (found by this suite on 2026-10-13). Each is a
// fixme with the reason; the list may only shrink. Fix the story, then delete its line.
const KNOWN_BROKEN: Record<string, string> = {
  'shared-createpanel--form': "story throws \"Cannot read properties of undefined (reading 'value')\" and renders nothing",
}

// Every story renders in Arabic (RTL) without a page error and without making the page scroll sideways.
for (const story of stories) {
  test(`${story.title} / ${story.name}`, async ({ page }) => {
    test.fixme(story.id in KNOWN_BROKEN, KNOWN_BROKEN[story.id])
    const errors: string[] = []
    page.on('pageerror', error => errors.push(error.message))
    await page.goto(`/iframe.html?id=${story.id}&viewMode=story&globals=locale:ar`)
    // Storybook marks the preview body once the story (or its error) is on screen.
    await page.waitForFunction(() => /sb-show-(main|errordisplay)/.test(document.body.className), null, { timeout: 20_000 })
    await page.waitForLoadState('networkidle', { timeout: 3_000 }).catch(() => undefined)

    const shown = await page.evaluate(() => document.body.className)
    expect(shown, 'story failed to render').not.toContain('sb-show-errordisplay')
    expect(errors, 'page errors').toEqual([])
    await expect(page.locator('html')).toHaveAttribute('dir', 'rtl')
    const overflow = await page.evaluate(() => {
      const root = document.documentElement
      return { scroll: root.scrollWidth, client: root.clientWidth }
    })
    expect(overflow.scroll, `page scrolls sideways (${overflow.scroll} > ${overflow.client})`).toBeLessThanOrEqual(overflow.client + 1)
  })
}
