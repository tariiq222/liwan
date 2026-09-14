// Debug helper: print every >=400 response while a story loads.
// Usage: node scripts/find404.mjs <port> <storyId> [storyId...]
import { chromium } from 'playwright'
const [port = '6006', ...ids] = process.argv.slice(2)
const browser = await chromium.launch()
const page = await browser.newPage()
page.on('response', r => { if (r.status() >= 400) console.log(r.status(), r.url()) })
for (const id of ids) {
  console.log('==', id)
  await page.goto(`http://localhost:${port}/iframe.html?id=${id}&viewMode=story`, { waitUntil: 'networkidle' })
  await page.waitForTimeout(1500)
}
await browser.close()
