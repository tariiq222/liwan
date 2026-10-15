#!/usr/bin/env node
// Screenshot baseline for the shared UI layer move: proves apps/web did not change visually.
//
//   node tools/ui_layer_baseline.mjs --base-url http://localhost:3101 --out <dir>
//   node tools/ui_layer_baseline.mjs --compare <dirA> <dirB>
//
// Capture runs against the isolated mock stack only (see docs/agents/web-rules.md); it logs in
// with the mock fixture user admin/admin. Files are <route-slug>__<lang>__<theme>__<width>.png.
// Compare passes a pair when the PNG bytes match, or when at most 0.1% of pixels differ (sub-pixel
// anti-aliasing noise; reported per file). pngjs is already in the lockfile (via the e2e runner), no
// image-diff package is added. It exits 1 when any file differs more or is missing on one side.
import { createRequire } from 'node:module'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const ROUTES = [
  { path: '/projects/dashboard', auth: true },
  { path: '/projects', auth: true },
  { path: '/tasks', auth: true },
  { path: '/my-tasks', auth: true },
  { path: '/meetings', auth: true },
  { path: '/hr', auth: true },
  { path: '/operations', auth: true },
  { path: '/settings', auth: true },
  { path: '/subscription', auth: true },
  { path: '/login', auth: false },
]
const LANGS = ['ar', 'en']
const THEMES = ['light', 'dark']
const WIDTHS = [390, 768, 1440]
// Elements whose text depends on the clock; painted over so runs stay comparable.
const MASK_SELECTORS = ['time', '[data-relative-time]']
// The Nuxt dev server paints a devtools badge (with a live timing) over the page; it is not app UI.
const HIDE_CSS = '#nuxt-devtools-container, [data-nuxt-devtools] { display: none !important; }'

const slug = routePath => routePath.replace(/^\//, '').replace(/\//g, '-') || 'root'
const arg = name => {
  const i = process.argv.indexOf(name)
  return i === -1 ? undefined : process.argv[i + 1]
}

const MAX_DIFF_RATIO = 0.001

// Returns the share of differing pixels, or 1 when the sizes differ.
function diffRatio(fileA, fileB) {
  const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..')
  const { PNG } = createRequire(path.join(root, 'package.json'))('pngjs')
  const a = PNG.sync.read(fs.readFileSync(fileA))
  const b = PNG.sync.read(fs.readFileSync(fileB))
  if (a.width !== b.width || a.height !== b.height) return 1
  let differing = 0
  for (let i = 0; i < a.data.length; i += 4) {
    if (a.data[i] !== b.data[i] || a.data[i + 1] !== b.data[i + 1] || a.data[i + 2] !== b.data[i + 2] || a.data[i + 3] !== b.data[i + 3]) differing++
  }
  return differing / (a.width * a.height)
}

function compare(dirA, dirB) {
  const list = dir => fs.readdirSync(dir).filter(f => f.endsWith('.png')).sort()
  const a = list(dirA)
  const b = list(dirB)
  let bad = 0
  for (const name of new Set([...a, ...b])) {
    if (!a.includes(name) || !b.includes(name)) {
      console.log(`MISSING  ${name} (only in ${a.includes(name) ? dirA : dirB})`)
      bad++
    }
    else if (!fs.readFileSync(path.join(dirA, name)).equals(fs.readFileSync(path.join(dirB, name)))) {
      const ratio = diffRatio(path.join(dirA, name), path.join(dirB, name))
      const within = ratio <= MAX_DIFF_RATIO
      console.log(`${within ? 'NOISE   ' : 'DIFFERS '} ${name} ${(ratio * 100).toFixed(4)}% of pixels`)
      if (!within) bad++
    }
  }
  console.log(`${new Set([...a, ...b]).size - bad} identical or within 0.1%, ${bad} different or missing`)
  return bad === 0 ? 0 : 1
}

async function capture(baseUrl, out) {
  const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..')
  const { chromium } = createRequire(path.join(root, 'apps/web/package.json'))('playwright')
  fs.mkdirSync(out, { recursive: true })
  const browser = await chromium.launch()
  const base = { baseURL: baseUrl, reducedMotion: 'reduce', locale: 'ar-SA', timezoneId: 'Asia/Riyadh', deviceScaleFactor: 1 }
  const cookies = (lang, theme) => [
    { name: 'nasq-locale', value: lang, url: baseUrl },
    { name: 'nasq-appearance', value: encodeURIComponent(JSON.stringify({ mode: theme, fontSize: 'small' })), url: baseUrl },
  ]

  // Sign in once; the session cookie is reused by every authenticated context.
  const loginContext = await browser.newContext(base)
  const loginPage = await loginContext.newPage()
  await loginPage.goto('/login')
  const submit = loginPage.getByRole('button', { name: 'دخول', exact: true })
  await submit.waitFor()
  await loginPage.waitForFunction(() => !document.querySelector('button[type=submit]')?.disabled, null, { timeout: 60_000 })
  await loginPage.getByLabel('اسم المستخدم').fill('admin')
  await loginPage.getByLabel('كلمة المرور').fill('admin')
  await submit.click()
  await loginPage.waitForURL(url => !url.pathname.startsWith('/login'),{ timeout: 30_000 })
  const session = await loginContext.storageState()
  await loginContext.close()

  let count = 0
  for (const lang of LANGS) {
    for (const theme of THEMES) {
      for (const auth of [true, false]) {
        const context = await browser.newContext({ ...base, ...(auth ? { storageState: session } : {}) })
        await context.addCookies(cookies(lang, theme))
        const page = await context.newPage()
        if (auth) {
          // The saved appearance on /api/v1/me wins over the cookie, so store the theme there too.
          await page.goto('/tasks')
          await page.evaluate(async mode => {
            await fetch('/api/v1/me/appearance', { method: 'PATCH', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ mode, font_size: 'small' }) })
          }, theme)
        }
        for (const route of ROUTES.filter(r => r.auth === auth)) {
          for (const width of WIDTHS) {
            await page.setViewportSize({ width, height: 900 })
            await page.goto(route.path, { waitUntil: 'networkidle' })
            await page.evaluate(() => document.fonts.ready)
            await page.waitForTimeout(300)
            await page.screenshot({
              path: path.join(out, `${slug(route.path)}__${lang}__${theme}__${width}.png`),
              fullPage: true,
              animations: 'disabled',
              caret: 'hide',
              style: HIDE_CSS,
              mask: MASK_SELECTORS.map(selector => page.locator(selector)),
            })
            count++
          }
        }
        await context.close()
      }
    }
  }
  await browser.close()
  console.log(`${count} screenshots written to ${out}`)
}

if (process.argv.includes('--compare')) {
  const i = process.argv.indexOf('--compare')
  process.exit(compare(process.argv[i + 1], process.argv[i + 2]))
}
else {
  const baseUrl = arg('--base-url')
  const out = arg('--out')
  if (!baseUrl || !out) {
    console.error('usage: ui_layer_baseline.mjs --base-url <url> --out <dir> | --compare <dirA> <dirB>')
    process.exit(2)
  }
  await capture(baseUrl, path.resolve(out))
}
