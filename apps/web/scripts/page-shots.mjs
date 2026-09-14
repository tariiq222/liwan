// Review helper: log into the mock stack and screenshot pages at three widths.
// Usage: node scripts/page-shots.mjs <nuxtPort> <outDir> [path ...]
import { mkdirSync } from 'node:fs'
import { chromium } from 'playwright'

const [port = '4097', outDir = 'page-shots', ...only] = process.argv.slice(2)
const paths = only.length ? only : ['/projects', '/tasks', '/tasks?tab=board', '/projects/1', '/tasks/101']
const widths = [1440, 768, 390]
mkdirSync(outDir, { recursive: true })
const browser = await chromium.launch()
const context = await browser.newContext({ viewport: { width: 1440, height: 900 } })
const page = await context.newPage()
await page.goto(`http://localhost:${port}/login`, { waitUntil: 'networkidle' })
await page.getByLabel(/اسم المستخدم|Username|البريد|Login/i).first().fill('admin')
await page.getByLabel(/كلمة المرور|Password/i).first().fill('admin')
await page.getByRole('button', { name: /دخول|Sign in|Log in|تسجيل/i }).first().click()
await page.waitForURL(url => !url.pathname.startsWith('/login'), { timeout: 20_000 })
for (const path of paths) {
  for (const width of widths) {
    await page.setViewportSize({ width, height: 900 })
    await page.goto(`http://localhost:${port}${path}`, { waitUntil: 'networkidle' })
    await page.waitForTimeout(800)
    const name = `${path.replace(/[^a-z0-9]+/gi, '_').replace(/^_|_$/g, '') || 'home'}-${width}.png`
    await page.screenshot({ path: `${outDir}/${name}`, fullPage: true })
    console.log('ok', name)
  }
}
await browser.close()
