import { spawn, type ChildProcess } from 'node:child_process'
import { appendFileSync } from 'node:fs'
import { createServer } from 'node:http'
import { createServer as createNetServer } from 'node:net'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { expect, test, type Page, type Route } from '@playwright/test'

process.env.NUXT_ODOO_DB = 'webvue_settings_nav_unused_scratch'

const webRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const CAPABILITIES = [
  'access.users.read', 'access.users.grant', 'access.users.assign_roles', 'access.users.disable', 'access.users.reset_password',
  'access.roles.read', 'access.roles.manage', 'access.audit.read',
  'hr.employees.read', 'hr.employees.manage', 'hr.employees.archive', 'hr.employees.access_status.read',
  'hr.shifts.manage', 'hr.departments.read', 'hr.departments.manage', 'documents.items.read', 'documents.items.manage',
  'pmo.projects.read', 'pmo.projects.create', 'pmo.projects.manage', 'pmo.settings.manage',
  'pmo.tasks.read', 'pmo.tasks.create', 'pmo.tasks.write', 'pmo.tasks.approve',
  'settings.branding.manage',
] as const

const ME = {
  id: 2, name: 'مدير النظام', login: 'admin', email: 'admin@example.com', lang: 'ar_001',
  tz: 'Asia/Riyadh', role: 'admin', roles: [], capabilities: [...CAPABILITIES],
  access_policy_version: 1, company: { id: 1, name: 'ويب فيو' },
  modules: ['webvue_chat', 'webvue_hr', 'webvue_pmo'],
  entitlements: {
    'pmo.enabled': true, 'meetings.enabled': true, 'hr.enabled': true, 'hr.shifts': true, 'chat.enabled': true,
    'users.limit': null, 'projects.max_projects': null, 'storage.limit_mb': null,
  },
  platform: {
    schema_version: 1, policy_revision: 1, state: 'active', valid_until: null, read_only: false,
    readable_features: ['chat.enabled', 'hr.enabled', 'hr.shifts', 'meetings.enabled', 'pmo.enabled'],
    writable_features: ['chat.enabled', 'hr.enabled', 'hr.shifts', 'meetings.enabled', 'pmo.enabled'],
  },
  terminology: { ar: {}, en: {} },
}
const BRANDING = { name: 'ويب فيو', logo_url: '/web/binary/company_logo?company=1', primary_color: '#13234a', font: 'IBM_Plex_Sans_Arabic' }
const PROJECT_SETTINGS = {
  project_creators: 'managers',
  default_stages: [{ name: 'جديد', fold: false }, { name: 'جارٍ', fold: false }],
  require_manager_on_create: false,
  require_end_date_on_create: false,
  default_completion_approval: 'none',
  deadline_reminders_enabled: false,
  deadline_reminders_days_before: 1,
  overdue_digest_enabled: false,
  require_charter_approval: false,
  close_with_open_tasks: 'block',
  register_status_transitions: 'sequence',
  extensions: [],
}
const USERS = {
  items: [{
    id: 18, name: 'سارة محمد', login: 'sara@example.com',
    employee: { id: 31, name: 'سارة محمد', department: { id: 3, name: 'الموارد البشرية' } },
    active: true, protected: false,
    assignments: [{ id: 44, role: { id: 4, key: 'hr_manager', name: { ar: 'مسؤول موارد بشرية', en: 'HR manager' }, type: 'built_in', protected: true }, scope: { kind: 'company', id: 1, name: 'ويب فيو' } }],
    version: 'u18-a3-v7',
  }],
  total: 1,
}

const BRANCH_ROLES = [
  { id: 4, key: 'finance_manager', active: true, name: { ar: 'Finance manager', en: 'Finance manager' }, company_id: null },
]
const BRANCH_POLICY = {
  version: 'b1-v1', mode: 'delegated', preset: 'independent_branches',
  branches: [{ id: 2, name: 'Riyadh branch', inherit: false, role_ids: [] as number[] }, { id: 3, name: 'Jeddah branch', inherit: false, role_ids: [] as number[] }],
  roles: BRANCH_ROLES,
}
const BRANCH_DELEGATION = {
  version: 'u18-a3-v7-b1-v1',
  branches: [{ id: 2, name: 'Riyadh branch', role_ids: [] as number[] }, { id: 3, name: 'Jeddah branch', role_ids: [] as number[] }],
  roles: [...BRANCH_ROLES,
    { id: 8, key: 'riyadh_reader', active: true, name: { ar: 'Riyadh finance reader', en: 'Riyadh finance reader' }, company_id: 2 },
    { id: 9, key: 'jeddah_reader', active: true, name: { ar: 'Jeddah finance reader', en: 'Jeddah finance reader' }, company_id: 3 },
  ],
}

function jsonFor(pathname: string): unknown {
  if (pathname === '/api/v1/hr/shifts/settings') return { day_reference: 'company', company_timezone: 'Asia/Riyadh', effective_timezone: 'Asia/Riyadh', today: '2026-10-23', default_schedule: { id: 7, name: 'دوام الأحد إلى الخميس' }, revision: 0 }
  if (pathname === '/api/v1/admin/access/branches') return BRANCH_POLICY
  if (pathname === '/api/v1/admin/users/18/branches') return BRANCH_DELEGATION
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
      NUXT_ODOO_DB: 'webvue_settings_nav_unused_scratch',
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
      const response = await fetch(`${origin}/settings/team/users`)
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
  await page.context().addCookies([{ name: 'session_id', value: 'settings_mock', url: origin, httpOnly: true, sameSite: 'Lax' }])
  await page.route('**/api/v1/**', fulfillApi)
  await page.route('**/api/auth/**', async (route) => {
    await route.fulfill({ status: 200, contentType: 'application/json', body: '{"ok":true}' })
  })
  await page.goto(`${origin}${path}`, { waitUntil: 'domcontentloaded' })
  await page.getByTestId('settings-layout').waitFor({ state: 'visible', timeout: 15_000 })
}

test('project settings open as a real page under Settings > Apps', async ({ page }, testInfo) => {
  await page.setViewportSize({ width: 1440, height: 900 })
  // Project settings are registered by the projects application and listed in the Apps section of the settings sidebar.
  await openApp(page, '/settings/apps/projects')
  await expect(page.getByTestId('settings-layout')).toBeVisible()
  await expect(page.getByTestId('sidebar-settings')).toHaveCount(0)
  const settingsProjects = page.getByTestId('application-navigation').getByRole('button', { name: 'المشاريع', exact: true })
  await expect(settingsProjects).toHaveAttribute('aria-expanded', 'true')
  await expect(page.getByTestId('application-navigation').locator('a[href="/settings/apps/projects"]')).toBeVisible()
  await expect(page.getByRole('region', { name: 'سياسة إنشاء المشاريع', exact: true }).getByRole('radiogroup')).toBeVisible()
  await expect(page.locator('.webvue-settings-content [data-slot="record-section"]')).toHaveCount(5)
  expect(new URL(page.url()).pathname).toBe('/settings/apps/projects')
  await page.screenshot({ path: testInfo.outputPath('submenu-projects-desktop-rtl.png'), fullPage: true })
})

test('in-page anchors scroll, mark location current, and survive hash refresh', async ({ page }, testInfo) => {
  await page.setViewportSize({ width: 1440, height: 900 })
  await openApp(page, '/settings/apps/projects')
  const sectionNav = page.getByTestId('settings-context-sub-list')
  const catalogsLink = sectionNav.getByRole('link', { name: 'القوائم المشتركة', exact: true })
  await expect(sectionNav.getByRole('link', { name: 'سياسة إنشاء المشاريع', exact: true })).toHaveAttribute('aria-current', 'true')
  await expect(catalogsLink).toHaveAttribute('href', '/settings/apps/projects#catalogs')
  await catalogsLink.click()
  await expect(page).toHaveURL(/#catalogs/)
  await expect(catalogsLink).toHaveAttribute('aria-current', 'true')
  await expect(catalogsLink).toHaveCSS('font-weight', '600')
  await expect.poll(async () => page.evaluate(() => {
    const el = document.getElementById('catalogs')
    if (!el) return false
    const rect = el.getBoundingClientRect()
    return rect.top < innerHeight && rect.bottom > 0
  })).toBe(true)
  await openApp(page, '/settings/apps/projects#catalogs')
  await expect(page.getByTestId('settings-context-sub-list').getByRole('link', { name: 'القوائم المشتركة', exact: true })).toHaveAttribute('aria-current', 'true')
  await page.screenshot({ path: testInfo.outputPath('anchors-desktop-rtl.png'), fullPage: true })
})

test('users list has one card without nested chrome and mobile settings navigation remains usable', async ({ page }, testInfo) => {
  await page.setViewportSize({ width: 1440, height: 900 })
  await openApp(page, '/settings/team/users')
  await expect(page.getByTestId('settings-layout')).toBeVisible()
  const card = page.locator('[data-testid="settings-layout"] [data-slot="list-card"]')
  await expect(card).toHaveCount(1)
  await expect(card.locator('[data-slot="list-card"]')).toHaveCount(0)
  await expect(card.getByRole('table')).toBeVisible()

  await page.setViewportSize({ width: 390, height: 844 })
  await openApp(page, '/settings/team/users')
  const menu = page.getByTestId('mobile-navigation-trigger')
  await expect(menu).toBeEnabled()
  await menu.click()
  const drawer = page.getByRole('dialog')
  await expect(drawer).toBeVisible()
  await expect(drawer.getByRole('button', { name: 'المستخدمون', exact: true })).toHaveAttribute('aria-expanded', 'true')
  const users = drawer.locator('a[href="/settings/team#users"]')
  await expect(users).toHaveAttribute('href', '/settings/team#users')
  await expect(drawer.locator('a[href="/settings/team/users"]')).toHaveAttribute('aria-current', 'true')
  await users.click()
  await expect(page).toHaveURL(/\/settings\/team#users$/)
  await expect(drawer).toHaveCount(0)
  await expect(page.getByRole('heading', { name: 'المستخدمون', exact: true })).toBeVisible()
  await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true)
  await expect(page.locator('html')).toHaveAttribute('dir', 'rtl')
  await page.screenshot({ path: testInfo.outputPath('mobile-rtl.png'), fullPage: true })
})

test('users direct result anchor keeps list query on refresh and back', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 })
  await openApp(page, '/settings/team/users?q=sara&status=active&offset=25#results')
  const search = page.getByRole('textbox', { name: 'ابحث بالاسم أو اسم الدخول…', exact: true })
  await expect(search).toHaveValue('sara')
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
  await expect(page.getByRole('textbox', { name: 'ابحث بالاسم أو اسم الدخول…', exact: true })).toHaveValue('sara')
  await page.goto(`${origin}/settings/company#branding`, { waitUntil: 'domcontentloaded' })
  await page.goBack()
  await page.getByTestId('settings-layout').waitFor({ state: 'visible', timeout: 15_000 })
  expect(new URL(page.url()).searchParams.get('q')).toBe('sara')
  expect(new URL(page.url()).searchParams.get('status')).toBe('active')
  expect(new URL(page.url()).searchParams.get('offset')).toBe('25')
  await expect(page.getByRole('textbox', { name: 'ابحث بالاسم أو اسم الدخول…', exact: true })).toHaveValue('sara')
})

test('project settings sections are separate bordered cards with clear headers', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 })
  await openApp(page, '/settings/apps/projects')
  const reminders = page.getByRole('region', { name: 'تذكير المواعيد', exact: true })
  const catalogs = page.getByRole('region', { name: 'القوائم المشتركة', exact: true })
  for (const card of [reminders, catalogs]) {
    await expect(card).toBeVisible()
    await expect(card).toHaveAttribute('data-slot', 'record-section')
    await expect.poll(() => card.evaluate(element => Number.parseFloat(getComputedStyle(element).borderRadius))).toBeCloseTo(18, 2)
    await expect(card.locator(':scope > header')).toHaveCSS('border-bottom-width', '1px')
    await expect.poll(() => card.evaluate(element => getComputedStyle(element).boxShadow)).not.toBe('none')
  }
  const remindersBox = await reminders.boundingBox()
  const catalogsBox = await catalogs.boundingBox()
  expect(catalogsBox!.y).toBeGreaterThan(remindersBox!.y + remindersBox!.height)

})

test('unsaved branding draft is guarded when leaving to project settings', async ({ page }, testInfo) => {
  await page.setViewportSize({ width: 1440, height: 900 })
  await openApp(page, '/settings/company#branding')
  const color = page.getByTestId('branding-color')
  await expect(color).toBeVisible({ timeout: 15_000 })
  await color.fill('#abcdef')
  const navigation = page.getByTestId('application-navigation')
  await navigation.getByRole('button', { name: 'المشاريع', exact: true }).click()
  const projectsOverview = navigation.locator('a[href="/settings/apps/projects"]')
  await projectsOverview.click()
  const dialog = page.getByTestId('unsaved-changes-dialog')
  await expect(dialog).toBeVisible()
  await page.getByRole('button', { name: 'البقاء في الصفحة' }).click()
  await expect(dialog).toHaveCount(0)
  await expect(page).toHaveURL(/\/settings\/company#branding/)
  await expect(color).toHaveValue('#abcdef')
  await projectsOverview.click()
  await page.getByRole('button', { name: 'المغادرة بدون حفظ' }).click()
  await expect.poll(() => new URL(page.url()).pathname).toBe('/settings/apps/projects')
  await page.screenshot({ path: testInfo.outputPath('unsaved-desktop-rtl.png'), fullPage: true })
})

test('branch policy selects controlled inheritance and saves exact per-branch grants', async ({ page }, testInfo) => {
  await openApp(page, '/settings/team/branches')
  let policy = structuredClone(BRANCH_POLICY)
  let submitted: Record<string, unknown> | null = null
  await page.route('**/api/v1/admin/access/branches', async route => {
    if (route.request().method() === 'PATCH') {
      submitted = route.request().postDataJSON()
      const body = submitted as unknown as { mode: string; branches: Array<{ id: number; inherit: boolean; role_ids: number[] }> }
      policy = { ...policy, mode: body.mode, preset: 'custom', version: 'b1-v2', branches: policy.branches.map(branch => ({ ...branch, ...body.branches.find(row => row.id === branch.id) })) }
    }
    await route.fulfill({ json: policy })
  })
  const modes = page.getByRole('combobox')
  await expect(modes).toBeEnabled()
  await modes.click()
  await page.getByRole('option').last().click()
  await expect(page.getByRole('heading', { name: 'Riyadh branch' })).toBeVisible()
  await page.getByRole('checkbox').nth(0).check()
  await page.getByRole('checkbox', { name: 'Finance manager', exact: true }).first().check()
  await expect(page.getByRole('checkbox', { name: 'Finance manager', exact: true }).last()).toBeDisabled()
  await page.getByRole('button', { name: 'حفظ التغييرات', exact: true }).click()
  await expect.poll(() => submitted).toMatchObject({ expected_version: 'b1-v1', mode: 'inherited', branches: [{ id: 2, inherit: true, role_ids: [4] }, { id: 3, inherit: false, role_ids: [] }] })
  await page.setViewportSize({ width: 390, height: 844 })
  await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true)
  await page.screenshot({ path: testInfo.outputPath('branch-policy-mobile-rtl.png'), fullPage: true })
})

test('branch delegation keeps each custom role in its owning branch', async ({ page }, testInfo) => {
  await openApp(page, '/settings/team/users/18/branches')
  let submitted: Record<string, unknown> | null = null
  await page.route('**/api/v1/admin/users/18/branches', async route => {
    if (route.request().method() === 'PATCH') {
      submitted = route.request().postDataJSON()
      const body = submitted as unknown as { branches: Array<{ id: number; role_ids: number[] }> }
      await route.fulfill({ json: { ...BRANCH_DELEGATION, version: 'u18-a4-v8-b1-v1', branches: BRANCH_DELEGATION.branches.map(branch => ({ ...branch, ...body.branches.find(row => row.id === branch.id) })) } })
      return
    }
    await route.fulfill({ json: BRANCH_DELEGATION })
  })
  const reader = page.getByRole('checkbox', { name: 'Riyadh finance reader', exact: true })
  await expect(reader).toHaveCount(1)
  await expect(reader).toBeEnabled()
  await reader.check()
  await page.getByRole('button', { name: 'حفظ التغييرات', exact: true }).click()
  await expect.poll(() => submitted).toMatchObject({ expected_version: BRANCH_DELEGATION.version, branches: [{ id: 2, role_ids: [8] }, { id: 3, role_ids: [] }] })
  await page.screenshot({ path: testInfo.outputPath('branch-delegation-desktop-rtl.png'), fullPage: true })
})


test('shift settings default to company timezone and save the user reference without payroll permission', async ({ page }, testInfo) => {
  await openApp(page, '/settings/apps/hr#shifts')
  let submitted: Record<string, unknown> | null = null
  await page.route('**/api/v1/hr/shifts/settings', async route => {
    if (route.request().method() === 'PATCH') {
      submitted = route.request().postDataJSON()
      await route.fulfill({ json: { day_reference: 'user', company_timezone: 'Asia/Riyadh', effective_timezone: 'Asia/Riyadh', today: '2026-10-23', default_schedule: { id: 7, name: 'دوام الأحد إلى الخميس' }, revision: 1 } })
      return
    }
    if (submitted) { await route.abort('failed'); return }
    await route.fulfill({ json: jsonFor('/api/v1/hr/shifts/settings') })
  })
  const reference = page.locator('#shift-day-reference')
  await expect(reference).toBeEnabled()
  await expect(reference).toContainText('المنطقة الزمنية للشركة (الافتراضي)')
  await reference.click()
  await page.getByRole('option', { name: 'المنطقة الزمنية لكل مستخدم', exact: true }).click()
  const save = page.getByRole('button', { name: 'حفظ التغييرات', exact: true })
  await expect(save).toBeEnabled()
  await save.click()
  await expect.poll(() => submitted).toEqual({ day_reference: 'user', revision: 0 })
  await expect(save).toBeDisabled()
  await expect(reference).toBeVisible()
  await expect(reference).toContainText('المنطقة الزمنية لكل مستخدم')
  await page.setViewportSize({ width: 390, height: 844 })
  await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true)
  await page.screenshot({ path: testInfo.outputPath('shift-day-settings-mobile-rtl.png'), fullPage: true })
})


test('shift conflict keeps the draft through a failed and delayed reload, then saves the fetched revision', async ({ page }) => {
  await openApp(page, '/settings/apps/hr#shifts')
  const reference = page.locator('#shift-day-reference')
  await expect(reference).toBeEnabled()
  let submitted: Record<string, unknown> | null = null
  let patches = 0
  let reads = 0
  let allowReload = false
  let releaseReload!: () => void
  const reloadReady = new Promise<void>(resolveReady => { releaseReload = resolveReady })
  await page.route('**/api/v1/hr/shifts/settings', async route => {
    if (route.request().method() === 'PATCH') {
      patches += 1
      submitted = route.request().postDataJSON()
      await route.fulfill(patches === 1
        ? { status: 409, json: { code: 'conflict', message: 'Settings changed' } }
        : { json: { ...(jsonFor('/api/v1/hr/shifts/settings') as object), day_reference: 'user', revision: 5 } })
      return
    }
    reads += 1
    if (!allowReload) { await route.fulfill({ status: 503, json: { code: 'unavailable', message: 'Offline' } }); return }
    await reloadReady
    await route.fulfill({ json: { ...(jsonFor('/api/v1/hr/shifts/settings') as object), revision: 4 } })
  })
  await reference.click()
  await page.getByRole('option', { name: 'المنطقة الزمنية لكل مستخدم', exact: true }).click()
  const save = page.getByRole('button', { name: 'حفظ التغييرات', exact: true })
  await save.click()
  const reload = page.getByRole('button', { name: 'تجاهل التعديل وأعد التحميل', exact: true })
  await expect(reload).toBeVisible()
  await reload.click()
  await expect.poll(() => reads).toBeGreaterThan(0)
  await expect(reload).toBeEnabled()
  await expect(reference).toContainText('المنطقة الزمنية لكل مستخدم')
  await expect(reference).toBeDisabled()
  await expect(save).toBeDisabled()
  const failedReads = reads
  allowReload = true
  await reload.click()
  await expect.poll(() => reads).toBeGreaterThan(failedReads)
  await expect(reload).toBeDisabled()
  await expect(reference).toContainText('المنطقة الزمنية لكل مستخدم')
  await expect(save).toBeDisabled()
  releaseReload()
  await expect(reload).toHaveCount(0)
  await expect(reference).toBeEnabled()
  await expect(reference).toContainText('المنطقة الزمنية للشركة (الافتراضي)')
  await reference.click()
  await page.getByRole('option', { name: 'المنطقة الزمنية لكل مستخدم', exact: true }).click()
  await save.click()
  await expect.poll(() => submitted).toEqual({ day_reference: 'user', revision: 4 })
  await expect(save).toBeDisabled()
})
