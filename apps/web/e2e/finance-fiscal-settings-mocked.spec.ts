import { spawn, type ChildProcess } from 'node:child_process'
import { createServer } from 'node:http'
import { createServer as createNetServer } from 'node:net'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { expect, test, type Page, type Route } from '@playwright/test'

// The fiscal editor of the finance settings card, against an upstream this spec owns.
//
// It needs a built server (`npm -w apps/web run build`) because it runs `.output/server/index.mjs`, and it
// picks free ports for both the upstream stub and the app, so it never touches :3000/:8069 or a live database.
// The stub grants `finance.setup.read`/`finance.setup.manage`; the shared UI preview mock does not carry the
// finance capabilities, which is why this spec brings its own upstream instead of depending on that mock.
//
process.env.NUXT_ODOO_DB = 'liwan_fiscal_settings_unused_scratch'

// This spec serves its own build on its own port: the suite's Origin header (playwright.config.ts) would name
// another origin and break the page, while the browser marks this page's own writes same-origin by itself.
test.use({ extraHTTPHeaders: {} })
const webRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..')

type Mode = 'manager' | 'reader'
let mode: Mode = 'manager'
let fiscalPatches: Array<{ headers: Record<string, string>; body: unknown }> = []
let rejectNextPatch: { status: number; code: string; message: string } | null = null
let hardLockRequests: Array<{ headers: Record<string, string>; body: unknown }> = []
let rejectNextLock: { status: number; code: string; message: string } | null = null
// The hard lock the stub holds; a successful POST /fiscal/lock sets it, so a reload shows what was saved.
let hardLockDate: string | null = null

const COMPANY = { id: 1, name: 'ليوان' }
const SETUP = {
  chart: { loaded: true, template: 'sa', accounts_count: 182 },
  company: {
    name: 'ليوان', vat: '300000000000003', company_registry: '', street: 'طريق الملك عبدالله', city: 'الرياض',
    state: { id: 1, name: 'منطقة الرياض' }, country: { id: 1, name: 'المملكة العربية السعودية' }, currency: 'SAR',
    missing_fields: ['company_registry'],
  },
  fiscal: {
    fiscalyear_last_day: 31, fiscalyear_last_month: 12, fiscalyear_lock_date: '2025-12-31',
    tax_lock_date: null, sale_lock_date: null, purchase_lock_date: null, hard_lock_date: null,
    transfer_account: { id: 7, name: '100001 Liquidity Transfer' },
  },
  journals: { sale: 1, purchase: 1, bank: 1, cash: 1 },
  taxes: { sale_count: 4, purchase_count: 4, vat_15_present: true },
  zatca: { api_mode: 'sandbox', private_key_present: false, journals: [], onboarded: false },
  ready: false,
  blockers: ['company_registry_missing', 'zatca_not_onboarded'],
}

const capabilities = () => (mode === 'manager'
  ? ['finance.setup.read', 'finance.setup.manage', 'settings.company.read']
  : ['finance.setup.read', 'settings.company.read'])

function me() {
  return {
    id: 2, name: 'مدير النظام', login: 'admin', email: 'admin@example.com', lang: 'ar_001', tz: 'Asia/Riyadh',
    role: 'admin', roles: [], capabilities: capabilities(), access_policy_version: 1, company: COMPANY,
    modules: ['liwan_finance'],
    entitlements: { 'finance.enabled': true, 'users.limit': null, 'storage.limit_mb': null },
    platform: {
      schema_version: 1, policy_revision: 1, state: 'active', valid_until: null, read_only: false,
      readable_features: ['finance.enabled'], writable_features: ['finance.enabled'],
    },
    terminology: { ar: {}, en: {} },
  }
}

function jsonFor(pathname: string): unknown {
  if (pathname === '/api/v1/me') return me()
  if (pathname === '/api/v1/finance/setup') return { ...SETUP, fiscal: { ...SETUP.fiscal, hard_lock_date: hardLockDate } }
  if (pathname === '/api/v1/branding') return { name: 'ليوان', logo_url: null, primary_color: '#14102a', font: 'IBM_Plex_Sans_Arabic' }
  // The other cards of the page are not this spec's subject; they answer an empty list.
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
      res.end('{"error":"not_odoo"}')
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
      NUXT_ODOO_DB: 'liwan_fiscal_settings_unused_scratch',
      NUXT_PUBLIC_WS_URL: '',
      NUXT_CUSTOMER_COMMERCIAL_ENABLED: 'false',
    },
    stdio: ['ignore', 'ignore', 'ignore'],
  })
  origin = `http://127.0.0.1:${appPort}`
  const started = Date.now()
  while (Date.now() - started < 30_000) {
    try {
      if ((await fetch(`${origin}/settings/apps/finance`)).status === 200) return
    } catch { /* still booting */ }
    await new Promise((resolveWait) => setTimeout(resolveWait, 250))
  }
  throw new Error(`nuxt server did not become ready on ${origin}`)
})

test.afterAll(async () => {
  nitro?.kill('SIGTERM')
  await new Promise<void>((resolveClose) => stub ? stub.close(() => resolveClose()) : resolveClose())
})

test.beforeEach(() => {
  mode = 'manager'; fiscalPatches = []; rejectNextPatch = null
  hardLockRequests = []; rejectNextLock = null; hardLockDate = null
})

/** Serves the settings page over the synthetic upstream and captures every fiscal write it makes. */
async function routeFiscal(page: Page, cookies: Array<{ name: string; value: string }> = []) {
  await page.context().addCookies([
    { name: 'session_id', value: 'fiscal_mock', url: origin, httpOnly: true, sameSite: 'Lax' },
    ...cookies.map(cookie => ({ ...cookie, url: origin })),
  ])
  await page.route('**/api/v1/**', fulfillApi)
  await page.route('**/api/v1/finance/setup/fiscal/lock', fulfillLock)
  await page.route('**/api/v1/finance/setup/fiscal', async (route) => {
    if (route.request().method() !== 'PATCH') { await fulfillApi(route); return }
    fiscalPatches.push({ headers: route.request().headers(), body: route.request().postDataJSON() })
    if (rejectNextPatch) {
      await route.fulfill({ status: rejectNextPatch.status, contentType: 'application/json', body: JSON.stringify({ code: rejectNextPatch.code, message: rejectNextPatch.message }) })
      return
    }
    const body = route.request().postDataJSON() as { fiscalyear_last_day?: number; fiscalyear_last_month?: number }
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ ...SETUP, fiscal: { ...SETUP.fiscal, ...body, fiscalyear_last_month: body.fiscalyear_last_month ?? SETUP.fiscal.fiscalyear_last_month } }),
    })
  })
}

/** The hard lock write: answers a queued refusal once, otherwise sets the lock and returns the setup. */
async function fulfillLock(route: Route) {
  if (route.request().method() !== 'POST') { await fulfillApi(route); return }
  const body = route.request().postDataJSON() as { hard_lock_date: string }
  hardLockRequests.push({ headers: route.request().headers(), body })
  if (rejectNextLock) {
    const { status, code, message } = rejectNextLock
    rejectNextLock = null
    await route.fulfill({ status, contentType: 'application/json', body: JSON.stringify({ code, message, field: 'hard_lock_date' }) })
    return
  }
  hardLockDate = body.hard_lock_date
  await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(jsonFor('/api/v1/finance/setup')) })
}

/** Opens the settings page once the card is shown. */
async function openFiscal(page: Page, cookies: Array<{ name: string; value: string }> = []) {
  await routeFiscal(page, cookies)
  await page.goto(`${origin}/settings/apps/finance#setup`, { waitUntil: 'domcontentloaded' })
  await expect(page.getByTestId('finance-setup-fiscal')).toBeVisible({ timeout: 15_000 })
}

const fiscalCard = (page: Page) => page.getByTestId('finance-setup-fiscal')
const saveBar = (page: Page) => page.getByTestId('settings-save-bar')
const saveButton = (page: Page) => page.getByTestId('settings-save-bar-save')

test('a manager edits inline and the write states the identity the screen was read for', async ({ page }) => {
  await openFiscal(page)
  const day = page.locator('#finance-fiscal-fiscalyear_last_day')
  await expect(day).toBeEnabled()
  await day.fill('30')
  await page.locator('#finance-fiscal-fiscalyear_last_month').click()
  await page.getByRole('option', { name: 'يونيو', exact: true }).click()
  await expect(saveButton(page)).toBeEnabled()
  await saveButton(page).click()
  await expect(page.getByText('تم حفظ إعدادات السنة والأقفال.', { exact: true })).toBeVisible()
  expect(fiscalPatches).toHaveLength(1)
  const [patch] = fiscalPatches
  expect(patch?.body).toEqual({ fiscalyear_last_day: 30, fiscalyear_last_month: 6 })
  expect(patch?.body).not.toHaveProperty('company_id')
  expect(patch?.headers['x-liwan-expected-user-id']).toBe('2')
  expect(patch?.headers['x-liwan-expected-company-id']).toBe('1')
  await expect(saveBar(page)).toBeHidden()
  await expect(day).toHaveValue('30')
})

test('the server-rendered card hydrates in place without waiting for a browser read of the setup', async ({ page }) => {
  const hydrationMessages: string[] = []
  page.on('console', message => { if (/hydration/i.test(message.text())) hydrationMessages.push(message.text()) })
  await routeFiscal(page)
  // The browser's own setup read is held for the whole test: the card must come from the server render.
  let browserReads = 0
  let release!: () => void
  const held = new Promise<void>(resolveHeld => { release = resolveHeld })
  await page.route('**/api/v1/finance/setup', async (route) => {
    browserReads += 1
    await held
    await fulfillApi(route).catch(() => undefined)
  })
  try {
    await page.goto(`${origin}/settings/apps/finance#setup`, { waitUntil: 'load' })
    const day = page.locator('#finance-fiscal-fiscalyear_last_day')
    // Enabled only once hydrated, so every check below runs on the hydrated card.
    await expect(day).toBeEnabled({ timeout: 15_000 })
    await expect(fiscalCard(page)).toBeVisible()
    await expect(day).toHaveValue('31')
    await expect(page.locator('#finance-fiscal-fiscalyear_lock_date')).toContainText('2025')
    expect(browserReads).toBe(0)
    expect(hydrationMessages).toEqual([])
  } finally {
    release()
  }
})

test('a reader sees the same fields disabled, a view-only badge and no save bar', async ({ page }) => {
  mode = 'reader'
  await openFiscal(page)
  await expect(fiscalCard(page).getByText('عرض فقط', { exact: true })).toBeVisible()
  await expect(page.locator('#finance-fiscal-fiscalyear_last_day')).toHaveValue('31')
  await expect(page.locator('#finance-fiscal-fiscalyear_last_day')).toBeDisabled()
  await expect(page.locator('#finance-fiscal-fiscalyear_lock_date')).toBeDisabled()
  await expect(saveBar(page)).toBeHidden()
  expect(fiscalPatches).toHaveLength(0)
})

test('an impossible year end blocks the save and sends nothing', async ({ page }) => {
  await openFiscal(page)
  await page.locator('#finance-fiscal-fiscalyear_last_day').fill('31')
  await page.locator('#finance-fiscal-fiscalyear_last_month').click()
  await page.getByRole('option', { name: 'فبراير', exact: true }).click()
  await expect(saveButton(page)).toBeEnabled()
  await saveButton(page).click()
  await expect(fiscalCard(page).getByText('لا يوجد هذا التاريخ في التقويم. أدخل تاريخًا صالحًا.', { exact: true })).toBeVisible()
  expect(fiscalPatches).toHaveLength(0)
})

// A saved lock can be cleared or moved earlier now (owner decision 2026-11-09), so the old second broken rule of this test
// (clearing a lock) is a valid edit. The year end is the one rule the picker can still break, and one broken rule is
// shown under its field without the multi-rule summary; the summary's own rule (more than one issue) stays in the
// composable unit test.
test('a broken year end is shown under its field, focuses it and sends nothing', async ({ page }) => {
  await openFiscal(page)
  const day = page.locator('#finance-fiscal-fiscalyear_last_day')
  await day.fill('40')
  await expect(saveButton(page)).toBeEnabled()
  await saveButton(page).click()
  await expect(fiscalCard(page).getByText('أدخل يومًا صحيحًا من 1 إلى 31.', { exact: true })).toBeVisible()
  await expect(day).toBeFocused()
  await expect(page.getByTestId('finance-fiscal-error-summary')).toHaveCount(0)
  expect(fiscalPatches).toHaveLength(0)
})

test('a saved lock is cleared in one save, and any soft lock can be moved earlier', async ({ page }) => {
  await openFiscal(page)
  const lock = page.locator('#finance-fiscal-fiscalyear_lock_date')
  await lock.click()
  await page.getByRole('button', { name: 'مسح التاريخ' }).click()
  await page.keyboard.press('Escape')
  await saveButton(page).click()
  await expect(page.getByText('تم حفظ إعدادات السنة والأقفال.', { exact: true })).toBeVisible()
  expect(fiscalPatches.map(patch => patch.body)).toEqual([{ fiscalyear_lock_date: null }])
  await expect(fiscalCard(page).getByText(/لا يمكن إزالة هذا القفل|لا يمكن إرجاع هذا القفل/)).toHaveCount(0)
})

test('a saved lock moves to an earlier day', async ({ page }) => {
  await openFiscal(page)
  await page.locator('#finance-fiscal-fiscalyear_lock_date').click()
  // The calendar opens on December 2025 (the saved lock); the first day of that month is earlier than the lock.
  await page.locator('[data-reka-calendar-cell-trigger]:not([data-outside-view])').first().click()
  await page.keyboard.press('Escape')
  await saveButton(page).click()
  await expect(page.getByText('تم حفظ إعدادات السنة والأقفال.', { exact: true })).toBeVisible()
  expect(fiscalPatches.map(patch => patch.body)).toEqual([{ fiscalyear_lock_date: '2025-12-01' }])
})

test('a posted-entries refusal keeps the draft and reports it without claiming success', async ({ page }) => {
  await openFiscal(page)
  rejectNextPatch = { status: 422, code: 'fiscal_year_has_posted_entries', message: 'server text' }
  await page.locator('#finance-fiscal-fiscalyear_last_day').fill('30')
  await saveButton(page).click()
  await expect(fiscalCard(page).getByText(/لا يمكن تغيير نهاية السنة المالية لوجود قيود مُرحّلة/)).toBeVisible()
  await expect(page.getByText('تم حفظ إعدادات السنة والأقفال.', { exact: true })).toHaveCount(0)
  await expect(page.locator('#finance-fiscal-fiscalyear_last_day')).toHaveValue('30')
})

test('a changed company refuses the write, drops the draft and says why', async ({ page }) => {
  await openFiscal(page)
  await page.locator('#finance-fiscal-fiscalyear_last_day').fill('30')
  rejectNextPatch = { status: 409, code: 'request_context_changed', message: 'server text' }
  await saveButton(page).click()
  await expect(fiscalCard(page).getByText(/تغيّرت الشركة أو هوية الدخول/)).toBeVisible()
  await expect(page.getByText('تم حفظ إعدادات السنة والأقفال.', { exact: true })).toHaveCount(0)
  expect(fiscalPatches).toHaveLength(1)
  // The draft is dropped, not saved: the field shows the values read again and nothing can be saved.
  await expect(page.locator('#finance-fiscal-fiscalyear_last_day')).toHaveValue('31')
  await expect(saveBar(page)).toBeHidden()
})

test('reverting sends nothing and drops the draft', async ({ page }) => {
  await openFiscal(page)
  const day = page.locator('#finance-fiscal-fiscalyear_last_day')
  await day.fill('30')
  await page.getByTestId('settings-save-bar-revert').click()
  await expect(day).toHaveValue('31')
  await expect(saveBar(page)).toBeHidden()
  // This reader may open the setup part only, so the page shows no tab strip.
  await expect(page.locator('[data-testid^="settings-tab-"]')).toHaveCount(0)
  expect(fiscalPatches).toHaveLength(0)
})

// The matrix the design review asked for: the reader, editor and rejection states at the three widths.
// Light/dark come from the appearance cookie and RTL/LTR from the locale cookie; both cookie names are read
// from the app's own composables (liwan-appearance, liwan-locale) and are re-checked when this runs.
for (const { locale, dir, i18n } of [{ locale: 'ar', dir: 'rtl', i18n: 'ar' }, { locale: 'en', dir: 'ltr', i18n: 'en' }]) {
  for (const appearance of ['light', 'dark']) {
    test(`fiscal.<state>.${locale}.${appearance} across widths`, async ({ page }, testInfo) => {
      for (const width of [390, 768, 1440]) {
        await page.setViewportSize({ width, height: 900 })
        await openFiscal(page, [
          { name: 'liwan-appearance', value: JSON.stringify({ mode: appearance, fontSize: 'medium' }) },
          ...(i18n ? [{ name: 'liwan-locale', value: i18n }] : []),
        ])
        await expect(page.locator('html')).toHaveAttribute('dir', dir)
        await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true)
        await page.screenshot({ path: testInfo.outputPath(`fiscal.reader.${locale}.${appearance}.${width}.png`), fullPage: true })
        const day = page.locator('#finance-fiscal-fiscalyear_last_day')
        if (await day.isDisabled()) continue
        await day.fill('30')
        await page.screenshot({ path: testInfo.outputPath(`fiscal.editing.${locale}.${appearance}.${width}.png`), fullPage: true })
        rejectNextPatch = { status: 422, code: 'fiscal_year_has_posted_entries', message: 'server text' }
        // The page's one save bar is locale-independent, unlike the label of the card's button it replaced.
        await page.getByTestId('settings-save-bar-save').click()
        await expect(fiscalCard(page).getByRole('alert')).toBeVisible()
        await page.screenshot({ path: testInfo.outputPath(`fiscal.rejected.${locale}.${appearance}.${width}.png`), fullPage: true })
      }
    })
  }
}

// The hard lock card: its own action behind an inline confirmation and an acknowledgement.
const hardLockCard = (page: Page) => page.getByTestId('finance-setup-hard-lock')
const ACKNOWLEDGE = 'أفهم أن الإقفال النهائي لا رجعة فيه'

/** Picks the first day of the month the calendar opens on; it is never later than today. */
async function chooseHardLockDay(page: Page) {
  await page.locator('#finance-fiscal-hard_lock_date').click()
  await page.locator('[data-reka-calendar-cell-trigger]:not([data-outside-view])').first().click()
  await page.keyboard.press('Escape')
}

async function openHardLock(page: Page, cookies: Array<{ name: string; value: string }> = []) {
  await routeFiscal(page, cookies)
  await page.goto(`${origin}/settings/apps/finance#setup`, { waitUntil: 'domcontentloaded' })
  await expect(hardLockCard(page)).toBeVisible({ timeout: 15_000 })
}

test('the hard lock is sent only after the acknowledgement, with the identity the screen was read for', async ({ page }) => {
  await openHardLock(page)
  const start = page.getByTestId('finance-hard-lock-start')
  await expect(page.getByTestId('finance-hard-lock-current')).toHaveText('لا يوجد إقفال نهائي')
  await expect(start).toBeDisabled()
  await chooseHardLockDay(page)
  await expect(start).toBeEnabled()
  await start.click()
  const confirm = page.getByTestId('inline-confirm')
  await expect(confirm).toBeVisible()
  await expect(confirm).toContainText('لن يستطيع أحد تعديل قيود هذه الفترة')
  // Without the acknowledgement the action stays disabled and nothing is sent.
  const action = page.getByTestId('inline-confirm-action')
  await expect(action).toBeDisabled()
  expect(hardLockRequests).toHaveLength(0)
  await confirm.getByText(ACKNOWLEDGE, { exact: true }).click()
  await expect(action).toBeEnabled()
  await action.click()
  await expect(page.getByText('تم الإقفال النهائي.', { exact: true })).toBeVisible()
  expect(hardLockRequests).toHaveLength(1)
  const [request] = hardLockRequests
  expect(request?.body).toEqual({ hard_lock_date: expect.stringMatching(/^\d{4}-\d{2}-01$/), confirm: true })
  expect(request?.headers['x-liwan-expected-user-id']).toBe('2')
  expect(request?.headers['x-liwan-expected-company-id']).toBe('1')
  expect(fiscalPatches).toHaveLength(0)
  await expect(page.getByTestId('finance-hard-lock-current')).toHaveText((request?.body as { hard_lock_date: string }).hard_lock_date)
  await expect(page.getByTestId('inline-confirm')).toHaveCount(0)
})

test('cancelling the confirmation sends nothing and keeps the chosen day', async ({ page }) => {
  await openHardLock(page)
  await chooseHardLockDay(page)
  await page.getByTestId('finance-hard-lock-start').click()
  await page.getByTestId('inline-confirm-cancel').click()
  await expect(page.getByTestId('inline-confirm')).toHaveCount(0)
  await expect(page.getByTestId('finance-hard-lock-start')).toBeEnabled()
  expect(hardLockRequests).toHaveLength(0)
})

for (const refusal of [
  { code: 'draft_entries_in_period', message: 'توجد قيود مسودة حتى هذا التاريخ. رحِّلها أو احذفها قبل الإقفال النهائي.' },
  { code: 'unreconciled_bank_lines', message: 'توجد أسطر كشف بنكي غير مسوّاة حتى هذا التاريخ. سوِّها أو احذفها قبل القفل.' },
  { code: 'lock_date_loosening', message: 'الإقفال النهائي لا يُزال ولا يُرجع إلى تاريخ أسبق.' },
]) {
  test(`a ${refusal.code} refusal is shown in Arabic and the lock stays unset`, async ({ page }) => {
    await openHardLock(page)
    rejectNextLock = { status: 422, code: refusal.code, message: 'server text' }
    await chooseHardLockDay(page)
    await page.getByTestId('finance-hard-lock-start').click()
    await page.getByTestId('inline-confirm').getByText(ACKNOWLEDGE, { exact: true }).click()
    await page.getByTestId('inline-confirm-action').click()
    const alert = page.getByTestId('finance-hard-lock-error')
    await expect(alert).toHaveText(refusal.message)
    await expect(page.getByText('تم الإقفال النهائي.', { exact: true })).toHaveCount(0)
    await expect(page.getByTestId('finance-hard-lock-current')).toHaveText('لا يوجد إقفال نهائي')
    await expect(page.getByTestId('inline-confirm')).toHaveCount(0)
    expect(hardLockRequests).toHaveLength(1)
  })
}

test('a saved hard lock is shown, and a reader gets no controls for it', async ({ page }) => {
  mode = 'reader'
  hardLockDate = '2026-03-31'
  await openHardLock(page)
  await expect(page.getByTestId('finance-hard-lock-current')).toHaveText('2026-03-31')
  await expect(page.getByTestId('finance-hard-lock-start')).toHaveCount(0)
  await expect(page.locator('#finance-fiscal-hard_lock_date')).toHaveCount(0)
})

for (const width of [1440, 390]) {
  test(`the hard lock card in Arabic RTL at ${width}px stays inside the page, also while confirming`, async ({ page }, testInfo) => {
    await page.setViewportSize({ width, height: 900 })
    await openHardLock(page, [{ name: 'liwan-locale', value: 'ar' }])
    await expect(page.locator('html')).toHaveAttribute('dir', 'rtl')
    const fits = () => page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)
    await expect.poll(fits).toBe(true)
    await page.screenshot({ path: testInfo.outputPath(`hard-lock.rtl.${width}.png`), fullPage: true })
    await chooseHardLockDay(page)
    await page.getByTestId('finance-hard-lock-start').click()
    await expect(page.getByTestId('inline-confirm')).toBeVisible()
    await expect.poll(fits).toBe(true)
    await page.screenshot({ path: testInfo.outputPath(`hard-lock.rtl.confirm.${width}.png`), fullPage: true })
  })
}
