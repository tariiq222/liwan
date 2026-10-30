#!/usr/bin/env node
// Screenshot baseline for the shared UI layer move: proves apps/web did not change visually.
//
//   node tools/ui_layer_baseline.mjs --base-url http://localhost:3101 --out <dir>
//     (mock stack: MOCK_PORT=4601 node apps/web/e2e/my-tasks-mock.mjs, which adds the tasks app to /me)
//   node tools/ui_layer_baseline.mjs --compare <dirA> <dirB>
//
// Capture runs against the isolated mock stack only (see docs/agents/web-rules.md); it logs in
// with the mock fixture user admin/admin. Files are <route-slug>__<lang>__<theme>__<width>.png.
// Compare passes a pair when the PNG bytes match, or when at most 50 pixels AND 0.1% of pixels differ
// (sub-pixel anti-aliasing noise; reported per file). pngjs is already in the lockfile (via the e2e
// runner), no image-diff package is added. It exits 1 when any file differs more, a size differs, or
// either directory lacks any of the expected names (routes x langs x themes x widths).
import { createRequire } from 'node:module'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

// /operations and /subscription are not here on purpose: the mock has no operations entitlement and
// /subscription is customer-commercial (off in non_saas runtime config); both render an error page.
const ROUTES = [
  { path: '/projects/dashboard', auth: true },
  { path: '/projects', auth: true },
  { path: '/tasks', auth: true },
  { path: '/my-tasks', auth: true },
  { path: '/meetings', auth: true },
  { path: '/hr', auth: true },
  { path: '/account', auth: true },
  { path: '/settings', auth: true },
  { path: '/notifications', auth: true },
  { path: '/login', auth: false },
]
const LANGS = ['ar', 'en']
const THEMES = ['light', 'dark']
const WIDTHS = [390, 768, 1440]
// Elements whose text depends on the clock; painted over so runs stay comparable.
const MASK_SELECTORS = ['time', '[data-relative-time]']
// The Nuxt dev server paints a devtools badge (with a live timing) over the page; it is not app UI.
const HIDE_CSS = '#nuxt-devtools-container, [data-nuxt-devtools] { display: none !important; }'

// Every capture and every compare expects exactly this set of file names.
const slug = routePath => routePath.replace(/^\//, '').replace(/\//g, '-') || 'root'
const fileName = (route, lang, theme, width) => `${slug(route.path)}__${lang}__${theme}__${width}.png`
const expectedNames = () => ROUTES.flatMap(route => LANGS.flatMap(lang => THEMES.flatMap(theme => WIDTHS.map(width => fileName(route, lang, theme, width)))))
const arg = name => {
  const i = process.argv.indexOf(name)
  return i === -1 ? undefined : process.argv[i + 1]
}

const MAX_DIFF_RATIO = 0.001
const MAX_DIFF_PIXELS = 50

function loadPngjs() {
  const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..')
  try {
    return createRequire(path.join(root, 'package.json'))('pngjs').PNG
  }
  catch (error) {
    console.error(`cannot load pngjs (run npm ci --ignore-scripts at the repo root): ${error.message}`)
    process.exit(2)
  }
}

// Returns { differing, total } pixel counts, or { sizeDiffers: 'WxH vs WxH' } when the sizes differ.
function diffPixels(fileA, fileB) {
  const PNG = loadPngjs()
  const a = PNG.sync.read(fs.readFileSync(fileA))
  const b = PNG.sync.read(fs.readFileSync(fileB))
  if (a.width !== b.width || a.height !== b.height) return { sizeDiffers: `${a.width}x${a.height} vs ${b.width}x${b.height}` }
  let differing = 0
  for (let i = 0; i < a.data.length; i += 4) {
    if (a.data[i] !== b.data[i] || a.data[i + 1] !== b.data[i + 1] || a.data[i + 2] !== b.data[i + 2] || a.data[i + 3] !== b.data[i + 3]) differing++
  }
  return { differing, total: a.width * a.height }
}

function compare(dirA, dirB) {
  const list = dir => (fs.existsSync(dir) ? fs.readdirSync(dir) : []).filter(f => f.endsWith('.png')).sort()
  const a = list(dirA)
  const b = list(dirB)
  const expected = expectedNames()
  let bad = 0
  for (const [dir, names] of [[dirA, a], [dirB, b]]) {
    const missing = expected.filter(name => !names.includes(name))
    if (missing.length) console.log(`INCOMPLETE ${dir}: ${missing.length} of ${expected.length} expected files missing (first: ${missing[0]})`)
    bad += missing.length
  }
  for (const name of expected.filter(n => a.includes(n) && b.includes(n))) {
    if (!fs.readFileSync(path.join(dirA, name)).equals(fs.readFileSync(path.join(dirB, name)))) {
      const result = diffPixels(path.join(dirA, name), path.join(dirB, name))
      if (result.sizeDiffers) {
        console.log(`DIFFERS  ${name} size differs (${result.sizeDiffers})`)
        bad++
        continue
      }
      const within = result.differing <= MAX_DIFF_PIXELS && result.differing / result.total <= MAX_DIFF_RATIO
      console.log(`${within ? 'NOISE   ' : 'DIFFERS '} ${name} ${result.differing} px (${(result.differing / result.total * 100).toFixed(4)}%)`)
      if (!within) bad++
    }
  }
  console.log(`${expected.length} expected files per directory, ${bad} problem(s)`)
  return bad === 0 ? 0 : 1
}

async function capture(baseUrl, out) {
  const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..')
  const { chromium } = createRequire(path.join(root, 'apps/web/package.json'))('playwright')
  fs.mkdirSync(out, { recursive: true })
  const browser = await chromium.launch()
  const base = { baseURL: baseUrl, reducedMotion: 'reduce', locale: 'ar-SA', timezoneId: 'Asia/Riyadh', deviceScaleFactor: 1 }
  const cookies = (lang, theme) => [
    { name: 'liwan-locale', value: lang, url: baseUrl },
    { name: 'liwan-appearance', value: encodeURIComponent(JSON.stringify({ mode: theme, fontSize: 'small' })), url: baseUrl },
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
  await loginPage.waitForURL(url => !url.pathname.startsWith('/login'), { timeout: 30_000 })
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
          const saved = await page.evaluate(async mode => {
            const response = await fetch('/api/v1/me/appearance', { method: 'PATCH', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ mode, font_size: 'small' }) })
            return response.ok
          }, theme)
          if (!saved) throw new Error(`saving the ${theme} appearance failed`)
        }
        for (const route of ROUTES.filter(r => r.auth === auth)) {
          for (const width of WIDTHS) {
            await page.setViewportSize({ width, height: 900 })
            await page.goto(route.path, { waitUntil: 'networkidle' })
            // A 403/404 page or a blank page is not baseline evidence.
            const where = `${route.path} (${lang}/${theme}/${width})`
            if (await page.locator('[data-testid=app-error]').count()) throw new Error(`${where} rendered the error page`)
            if (!(await page.locator('h1').first().innerText().catch(() => '')).trim()) throw new Error(`${where} has no heading`)
            await page.evaluate(() => document.fonts.ready)
            await page.waitForTimeout(300)
            await page.screenshot({
              path: path.join(out, fileName(route, lang, theme, width)),
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
