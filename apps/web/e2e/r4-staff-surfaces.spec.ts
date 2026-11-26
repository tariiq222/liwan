import { expect, test } from '@playwright/test'

// The design audit's three staff screens. They need capabilities the default mock identity does not carry, so this
// spec opts in with `mock_caps=ops_desk` (see e2e/mock-capabilities.mjs) instead of widening the default set, which
// would move every navigation and permission spec. The lists answer with realistic seeded Arabic rows and matching
// KPI totals so real rendered tables, mobile cards, and RTL/LTR layout fits are verified without horizontal overflow.
interface StaffSurface {
  path: string
  heading: Record<'ar' | 'en', string>
  trail?: Record<'ar' | 'en', string>
  seededText: string
  seededReference: string
  expectedRows: number
  kpiStripTestId: string
  expectedKpis: string[]
}

const SURFACES: StaffSurface[] = [
  {
    path: '/operations',
    heading: { ar: 'طلباتي', en: 'My requests' },
    trail: { ar: 'العمليات', en: 'Operations' },
    seededText: 'تجديد اشتراك خدمات النسخ الاحتياطي السحابي',
    seededReference: '101',
    expectedRows: 5,
    kpiStripTestId: 'operation-kpi-strip-mine',
    expectedKpis: ['5', '2', '1', '1'],
  },
  {
    path: '/helpdesk',
    heading: { ar: 'الدعم الفني', en: 'Support Desk' },
    seededText: 'تحديث صلاحيات الدخول للموظفين الجدد في بوابة الموارد البشرية',
    seededReference: 'HD-0041',
    expectedRows: 4,
    kpiStripTestId: 'helpdesk-counters',
    expectedKpis: ['4', '1', '2', '1'],
  },
  {
    path: '/appointments',
    heading: { ar: 'المواعيد', en: 'Appointments' },
    seededText: 'منيرة عبدالعزيز الغامدي',
    seededReference: 'APT-2026-0141',
    expectedRows: 5,
    kpiStripTestId: 'appointments-kpi-strip',
    expectedKpis: ['5', '2', '1', '1'],
  },
]

const VIEWPORTS = [
  { name: 'desktop', width: 1440, height: 900, mobile: false },
  { name: 'mobile', width: 390, height: 844, mobile: true },
] as const

const LOCALES = [
  { code: 'ar', dir: 'rtl' },
  { code: 'en', dir: 'ltr' },
] as const

test.beforeEach(async ({ context, page, baseURL }) => {
  const login = await page.request.post('/api/auth/login', {
    data: { login: process.env.E2E_ADMIN_LOGIN ?? 'admin', password: process.env.E2E_ADMIN_PASSWORD ?? 'admin' },
  })
  expect(login.status(), 'mock login must succeed').toBe(200)
  await context.addCookies([{ name: 'mock_caps', value: 'ops_desk', url: baseURL ?? 'http://localhost:3000' }])
})

for (const surface of SURFACES) {
  for (const viewport of VIEWPORTS) {
    for (const locale of LOCALES) {
      test(`${surface.path} renders seeded rows with zero overflow (${viewport.name}, ${locale.code})`, async ({ context, page, baseURL }) => {
        const errors: string[] = []
        page.on('pageerror', error => errors.push(`page: ${error.message}`))
        page.on('console', message => {
          if (message.type() === 'error') errors.push(`console: ${message.text()}`)
        })

        await page.setViewportSize({ width: viewport.width, height: viewport.height })
        await context.addCookies([{ name: 'liwan-locale', value: locale.code, url: baseURL ?? 'http://localhost:3000' }])

        const response = await page.goto(surface.path, { waitUntil: 'domcontentloaded' })
        expect(response?.status(), `${surface.path} must not be refused`).toBe(200)
        await expect(page.getByTestId('global-search-trigger')).toBeEnabled({ timeout: 30_000 })

        await expect(page.locator('html')).toHaveAttribute('dir', locale.dir)
        await expect(page.locator('h1')).toContainText(surface.heading[locale.code])
        if (surface.trail) {
          await expect(page.getByTestId('page-header-trail')).toContainText(surface.trail[locale.code])
        }
        await expect(page.getByText(/ليس لديك صلاحية|You do not have permission/)).toHaveCount(0)

        const rows = viewport.mobile
          ? page.locator('[data-slot="data-table-body"] ul > li[data-shortcut-row]')
          : page.locator('[data-slot="data-table-frame"] tbody tr')
        await expect(rows).toHaveCount(surface.expectedRows)
        await expect(page.getByText(surface.seededText)).toBeVisible()
        await expect(page.locator('[data-slot="record-number"]', { hasText: surface.seededReference })).toBeVisible()

        const kpiTiles = page.getByTestId(surface.kpiStripTestId).getByTestId('metric-tile')
        await expect(kpiTiles).toHaveCount(surface.expectedKpis.length)
        await expect(kpiTiles.locator('p[dir="ltr"]')).toHaveText(surface.expectedKpis)

        const overflow = await page.evaluate(() => ({
          scrollWidth: document.documentElement.scrollWidth,
          clientWidth: document.documentElement.clientWidth,
        }))
        expect(overflow.scrollWidth, `${surface.path} must not overflow horizontally`).toBeLessThanOrEqual(overflow.clientWidth)
        expect(errors).toEqual([])
      })
    }
  }
}
