// Review helper: screenshot the stories that show the theme layer.
// Usage: node scripts/story-shots.mjs <port> <outDir> [storyId ...]
import { mkdirSync } from 'node:fs'
import { chromium } from 'playwright'

const [port = '6006', outDir = 'storybook-shots', ...only] = process.argv.slice(2)
const defaults = [
  'foundations-shape--radius-and-elevation',
  'nuxt-ui-actions--button-ranks',
  'nuxt-ui-fields--text-inputs',
  'nuxt-ui-surfaces--card',
  'nuxt-ui-surfaces--table',
  'shared-filterbar--filters-open',
  'shared-pageheader--with-actions',
  'task-taskcard--project-board',
  'task-statebadge--all-states',
]
const ids = only.length ? only : defaults
mkdirSync(outDir, { recursive: true })
const browser = await chromium.launch()
const page = await browser.newPage({ viewport: { width: 1100, height: 720 } })
for (const id of ids) {
  await page.goto(`http://localhost:${port}/iframe.html?id=${id}&viewMode=story`, { waitUntil: 'networkidle' })
  await page.waitForTimeout(600)
  await page.screenshot({ path: `${outDir}/${id}.png`, fullPage: true })
  console.log('ok', id)
}
await browser.close()
