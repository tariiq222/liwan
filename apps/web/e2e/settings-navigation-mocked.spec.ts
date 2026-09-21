import { spawn, type ChildProcess } from 'node:child_process'
import { appendFileSync } from 'node:fs'
import { createServer } from 'node:http'
import { createServer as createNetServer } from 'node:net'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { expect, test, type Page, type Route } from '@playwright/test'

process.env.NUXT_ODOO_DB = 'nasq_settings_nav_unused_scratch'

const webRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const CAPABILITIES = [
  'access.users.read', 'access.users.grant', 'access.users.assign_roles', 'access.users.disable', 'access.users.reset_password',
  'access.roles.read', 'access.roles.manage', 'access.audit.read',
  'hr.employees.read', 'hr.employees.manage', 'hr.employees.archive', 'hr.employees.access_status.read',
  'hr.departments.read', 'hr.departments.manage', 'hr.documents.read', 'hr.documents.manage',
  'pmo.projects.read', 'pmo.projects.create', 'pmo.projects.manage', 'pmo.settings.manage',
  'pmo.tasks.read', 'pmo.tasks.create', 'pmo.tasks.write', 'pmo.tasks.approve',
  'settings.branding.manage',
] as const

const ME = {
  id: 2, name: 'مدير النظام', login: 'admin', email: 'admin@example.com', lang: 'ar_001',
  tz: 'Asia/Riyadh', role: 'admin', roles: [], capabilities: [...CAPABILITIES],
  access_policy_version: 1, company: { id: 1, name: 'نَسَق' },
  modules: ['nasq_chat', 'nasq_hr', 'nasq_pmo'],
  entitlements: {
    'pmo.enabled': true, 'meetings.enabled': true, 'hr.enabled': true, 'chat.enabled': true,
    'users.limit': null, 'projects.max_projects': null, 'storage.limit_mb': null,
  },
  platform: {
    schema_version: 1, policy_revision: 1, state: 'active', valid_until: null, read_only: false,
    readable_features: ['chat.enabled', 'hr.enabled', 'meetings.enabled', 'pmo.enabled'],
    writable_features: ['chat.enabled', 'hr.enabled', 'meetings.enabled', 'pmo.enabled'],
  },
  terminology: { ar: {}, en: {} },
}
const BRANDING = { name: 'نَسَق', logo_url: '/web/binary/company_logo?company=1', primary_color: '#18181b', font: 'IBM_Plex_Sans_Arabic' }
const PROJECT_SETTINGS = {
  project_creators: 'managers',
  default_stages: [{ name: 'جديد', fold: false }, { name: 'جارٍ', fold: false }],
  require_manager_on_create: false,
  require_end_date_on_create: false,
  default_completion_approval: 'none',
  deadline_reminders_enabled: false,
  deadline_reminders_days_before: 1,
  overdue_digest_enabled: false,
}
const USERS = {
  items: [{
    id: 18, name: 'سارة محمد', login: 'sara@example.com',
    employee: { id: 31, name: 'سارة محمد', department: { id: 3, name: 'الموارد البشرية' } },
    active: true, protected: false,
    assignments: [{ id: 44, role: { id: 4, key: 'hr_manager', name: { ar: 'مسؤول موارد بشرية', en: 'HR manager' }, type: 'built_in', protected: true }, scope: { kind: 'company', id: 1, name: 'نَسَق' } }],
    version: 'u18-a3-v7',
  }],
  total: 1,
}

function jsonFor(pathname: string): unknown {
  if (pathname === '/api/v1/me') return ME
  if (pathname === '/api/v1/branding' || pathname === '/api/v1/admin/branding') return BRANDING
  if (pathname === '/api/v1/settings/projects') return PROJECT_SETTINGS
  if (pathname === '/api/v1/admin/users') return USERS
  if (pathname === '/api/v1/admin/roles') return { items: [], total: 0 }
  if (pathname === '/api/v1/hr/departments') return { items: [], total: 0 }
  if (pathname.startsWith('/api/v1/')) return { items: [], total: 0 }
  return null
}

async function freePort(): Promise<number> {
  return await new Promise((resolvePort, reject) => {
    const server = createNetServer()
    server.listen(0, '127.0.0.1', () => {
      const address = server.address()
      const port = typeof address === 'object' && address ? address.port : 0
      server.close((error) => error ? reject(error) : resolvePort(port))
    })
    server.on('error', reject)
  })
}

function startStub(port: number) {
  const stub = createServer((req, res) => {
    const pathname = (req.url ?? '/').split('?')[0]
    const body = jsonFor(pathname)
    if (body === null) {
      res.writeHead(404, { 'content-type': 'application/json' })
      res.end(JSON.stringify({ error: 'not_odoo' }))
      return
    }
    res.writeHead(200, { 'content-type': 'application/json' })
    res.end(JSON.stringify(body))
  })
  return new Promise<typeof stub>((resolveReady, reject) => {
    stub.listen(port, '127.0.0.1', () => resolveReady(stub))
    stub.on('error', reject)
  })
}

async function fulfillApi(route: Route) {
  const url = new URL(route.request().url())
  const body = jsonFor(url.pathname)
  if (body === null) {
    await route.fulfill({ status: 404, contentType: 'application/json', body: '{"error":"not_odoo"}' })
    return
  }
  await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(body) })
}

let origin = ''
let nitro: ChildProcess | undefined
let stub: ReturnType<typeof createServer> | undefined

test.beforeAll(async () => {
  const upstreamPort = await freePort()
  const appPort = await freePort()
  process.env.NUXT_ODOO_URL = `http://127.0.0.1:${upstreamPort}`
  stub = await startStub(upstreamPort)
  nitro = spawn(process.execPath, [resolve(webRoot, '.output/server/index.mjs')], {
    cwd: webRoot,
    env: {
      ...process.env,
      HOST: '127.0.0.1',
      PORT: String(appPort),
      NITRO_PORT: String(appPort),
      NITRO_HOST: '127.0.0.1',
      NUXT_ODOO_URL: `http://127.0.0.1:${upstreamPort}`,
      NUXT_ODOO_DB: 'nasq_settings_nav_unused_scratch',
      NUXT_PUBLIC_WS_URL: '',
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  })
  const nitroLog = resolve(webRoot, '../../settings-navigation-redesign-logs/loop2-nitro.log')
  nitro.stdout?.on('data', (chunk) => { try { appendFileSync(nitroLog, chunk) } catch { /* ignore */ } })
  nitro.stderr?.on('data', (chunk) => { try { appendFileSync(nitroLog, chunk) } catch { /* ignore */ } })
  origin = `http://127.0.0.1:${appPort}`
  const started = Date.now()
  while (Date.now() - started < 20_000) {
    try {
      const response = await fetch(`${origin}/settings/users`)
      if (response.status === 200) return
    } catch { /* still booting */ }
    await new Promise((resolveWait) => setTimeout(resolveWait, 200))
  }
  throw new Error(`nuxt preview did not become ready on ${origin}`)
})

test.afterAll(async () => {
  nitro?.kill('SIGTERM')
  await new Promise<void>((resolveClose) => stub ? stub.close(() => resolveClose()) : resolveClose())
})

async function openApp(page: Page, path: string) {
  await page.route('**/api/v1/**', fulfillApi)
  await page.route('**/api/auth/**', async (route) => {
    await route.fulfill({ status: 200, contentType: 'application/json', body: '{"ok":true}' })
  })
  await page.goto(`${origin}${path}`, { waitUntil: 'domcontentloaded' })
  await page.getByTestId('settings-layout').waitFor({ state: 'visible', timeout: 15_000 })
}

test('settings submenu opens project settings only as a real category page', async ({ page }, testInfo) => {
  await page.setViewportSize({ width: 1440, height: 900 })
  // Project settings live at the bottom of the projects sidebar, not under settings.
  await openApp(page, '/projects/settings')
  await expect(page.getByTestId('settings-layout')).toBeVisible()
  await expect(page.getByTestId('sidebar-settings')).toHaveCount(0)
  const projectsNav = page.getByRole('navigation', { name: 'الانتقال إلى' }).getByRole('link', { name: 'المشاريع', exact: true })
  await expect(projectsNav).toHaveAttribute('href', '/projects')
  const settingsProjects = page.getByTestId('settings-projects-tab')
  await expect(settingsProjects).toHaveAttribute('href', '/projects/settings')
  await expect(settingsProjects).toHaveAttribute('aria-current', 'page')
  await expect(page.locator('#project-creators')).toBeVisible()
  await expect(page.locator('.nasq-settings-content .nasq-panel')).toHaveCount(1)
  expect(new URL(page.url()).pathname).toBe('/projects/settings')
  await page.screenshot({ path: testInfo.outputPath('submenu-projects-desktop-rtl.png'), fullPage: true })
})

test('in-page anchors scroll, mark location current, and survive hash refresh', async ({ page }, testInfo) => {
  await page.setViewportSize({ width: 1440, height: 900 })
  await openApp(page, '/projects/settings')
  const remindersLink = page.locator('.nasq-settings-nav a[href="#project-reminders"]')
  const catalogsLink = page.locator('.nasq-settings-nav a[href="#catalogs"]')
  await expect(remindersLink).toHaveCSS('font-weight', '600')
  await catalogsLink.click()
  await expect(page).toHaveURL(/#catalogs/)
  await expect(catalogsLink).toHaveAttribute('aria-current', 'location')
  await expect(catalogsLink).toHaveCSS('font-weight', '600')
  await expect.poll(async () => page.evaluate(() => {
    const el = document.getElementById('catalogs')
    if (!el) return false
    const rect = el.getBoundingClientRect()
    return rect.top < innerHeight && rect.bottom > 0
  })).toBe(true)
  await openApp(page, '/projects/settings#catalogs')
  await expect(page.locator('.nasq-settings-nav a[href="#catalogs"]')).toHaveAttribute('aria-current', 'location')
  await page.screenshot({ path: testInfo.outputPath('anchors-desktop-rtl.png'), fullPage: true })
})

test('users category is one card without nested chrome; mobile toc is static below the header', async ({ page }, testInfo) => {
  await page.setViewportSize({ width: 1440, height: 900 })
  await openApp(page, '/settings/users')
  await expect(page.getByTestId('settings-layout')).toBeVisible()
  const nested = page.locator('.nasq-settings-content .nasq-panel .nasq-panel')
  await expect(nested).toHaveCount(1)
  await expect(nested).toHaveCSS('border-top-width', '0px')
  await expect(nested).toHaveCSS('background-color', 'rgba(0, 0, 0, 0)')

  await page.setViewportSize({ width: 390, height: 844 })
  await openApp(page, '/settings/users')
  const header = page.locator('.nasq-app-header')
  const nav = page.locator('.nasq-settings-nav')
  await expect(nav).toHaveCSS('position', 'static')
  const headerBox = await header.boundingBox()
  const navBox = await nav.boundingBox()
  expect(navBox).toBeTruthy()
  expect(headerBox).toBeTruthy()
  expect(navBox!.y).toBeGreaterThanOrEqual(headerBox!.y + headerBox!.height - 1)
  await expect(page.locator('html')).toHaveAttribute('dir', 'rtl')
  await page.screenshot({ path: testInfo.outputPath('mobile-rtl.png'), fullPage: true })
})

test('users hash navigation keeps list query on click, refresh and back', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 })
  await openApp(page, '/settings/users?q=sara&status=active&offset=25')
  const search = page.locator('#filters .nasq-settings-search input')
  await expect(search).toHaveValue('sara')
  await page.locator('.nasq-settings-nav a[href="#results"]').click()
  await expect(page).toHaveURL(/q=sara/)
  expect(new URL(page.url()).searchParams.get('status')).toBe('active')
  expect(new URL(page.url()).searchParams.get('offset')).toBe('25')
  await expect.poll(() => new URL(page.url()).hash).toBe('#results')
  await expect(search).toHaveValue('sara')
  await page.reload({ waitUntil: 'domcontentloaded' })
  await page.getByTestId('settings-layout').waitFor({ state: 'visible', timeout: 15_000 })
  await expect(page).toHaveURL(/q=sara/)
  expect(new URL(page.url()).searchParams.get('status')).toBe('active')
  expect(new URL(page.url()).searchParams.get('offset')).toBe('25')
  expect(new URL(page.url()).hash).toBe('#results')
  await expect(page.locator('#filters .nasq-settings-search input')).toHaveValue('sara')
  await page.goto(`${origin}/settings/branding`, { waitUntil: 'domcontentloaded' })
  await page.goBack()
  await page.getByTestId('settings-layout').waitFor({ state: 'visible', timeout: 15_000 })
  expect(new URL(page.url()).searchParams.get('q')).toBe('sara')
  expect(new URL(page.url()).searchParams.get('status')).toBe('active')
  expect(new URL(page.url()).searchParams.get('offset')).toBe('25')
  await expect(page.locator('#filters .nasq-settings-search input')).toHaveValue('sara')
})

test('section dividers use last-child not last-of-type', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 })
  const width = (selector: string) => page.locator(selector).evaluate((el) => getComputedStyle(el).borderBlockEndWidth)
  await openApp(page, '/projects/settings')
  await page.locator('#project-reminders').waitFor({ state: 'visible', timeout: 15_000 })
  await expect.poll(() => width('#project-reminders')).toBe('1px')
  await expect.poll(() => width('#catalogs')).toBe('0px')
})

test('unsaved branding draft is guarded when leaving to project settings', async ({ page }, testInfo) => {
  await page.setViewportSize({ width: 1440, height: 900 })
  await openApp(page, '/settings/branding')
  const color = page.getByTestId('branding-color')
  await expect(color).toBeVisible({ timeout: 15_000 })
  await color.fill('#abcdef')
  await page.getByTestId('settings-projects-tab').click()
  const dialog = page.getByTestId('unsaved-changes-dialog')
  await expect(dialog).toBeVisible()
  await page.getByRole('button', { name: 'البقاء في الصفحة' }).click()
  await expect(dialog).toHaveCount(0)
  await expect(page).toHaveURL(/\/settings\/branding/)
  await expect(color).toHaveValue('#abcdef')
  await page.getByTestId('settings-projects-tab').click()
  await page.getByRole('button', { name: 'المغادرة بدون حفظ' }).click()
  await expect(page).toHaveURL(/\/projects\/settings$/)
  await page.screenshot({ path: testInfo.outputPath('unsaved-desktop-rtl.png'), fullPage: true })
})
