import { expect, test, type Page } from '@playwright/test'
import { collectBrowserErrors, currentRoute, dialog, heading, MOCK_STACK_ONLY, openPage as open, row, trackRefusedRequests } from './support/mock-pages'
import { login } from './support/tasmim6'

test.skip(process.env.E2E_PROJECT_POPUPS !== '1', MOCK_STACK_ONLY)

// The five HR employee-lifecycle areas against the synthetic rows of hr-areas-ui-preview-data.mjs.
let errors: string[]

test.beforeEach(async ({ page }) => {
  await login(page)
  errors = collectBrowserErrors(page)
})

test.afterEach(() => {
  expect(errors, 'no page error and no console error').toEqual([])
})

// The server-rendered HTML of a record page, before any script runs: its edit form must already hold the record's values,
// or the client hydrates a different tree (the production build logs no warning for it, and Vue patches input values).
async function serverRenderedHtml(page: Page, path: string) {
  const response = await page.request.get(path)
  expect(response.status()).toBe(200)
  return response.text()
}

// Opens the create panel from the list's create button, checks it carries the list's query, then closes it.
async function createPanelKeepsFilters(page: Page, { list, create, createTestId, panelTitle, listTitle }: { list: string; create: string; createTestId: string; panelTitle: string; listTitle: string }) {
  await open(page, list, listTitle)
  await page.getByTestId(createTestId).click()
  await expect(page).toHaveURL(new RegExp(`${create.replace('?', '\\?')}$`))
  await expect(dialog(page).getByRole('heading', { name: panelTitle, exact: true })).toBeVisible()
  await dialog(page).getByRole('button', { name: 'إغلاق' }).click()
  await expect(dialog(page)).toHaveCount(0)
  expect(currentRoute(page)).toBe(list)
  await expect(heading(page, listTitle)).toBeVisible()
}

test.describe('shifts', () => {
  test('the assignments list shows the mock rows and filters by employee from the URL', async ({ page }) => {
    await open(page, '/hr/shifts', 'الورديات')
    await expect(row(page, /سارة محمد.*دوام صباحي/)).toBeVisible()
    await expect(row(page, /خالد الشمري.*دوام مسائي/)).toBeVisible()
    await expect(row(page, /منى القحطاني.*بلا نهاية/)).toBeVisible()
    await expect(page.getByTestId('hr-shifts-count')).toHaveText('3 من 3')
    await page.goto('/hr/shifts?employee_id=2')
    await expect(page.getByTestId('hr-shifts-count')).toHaveText('1 من 1')
    await expect(row(page, /خالد الشمري/)).toBeVisible()
    await expect(row(page, /سارة محمد/)).toHaveCount(0)
  })

  test('the create panel opens over the list and closing it returns with the filters', async ({ page }) => {
    await createPanelKeepsFilters(page, { list: '/hr/shifts?employee_id=2', create: '/hr/shifts/new?employee_id=2', createTestId: 'hr-shifts-new', panelTitle: 'إسناد وردية', listTitle: 'الورديات' })
    await expect(page.getByTestId('hr-shifts-count')).toHaveText('1 من 1')
  })

  test('the schedules list opens a schedule record by clicking its row and by direct link', async ({ page }) => {
    await open(page, '/hr/shifts/schedules', 'جداول العمل')
    await expect(row(page, /دوام صباحي.*Asia\/Riyadh/)).toBeVisible()
    await expect(row(page, /دوام مسائي/)).toBeVisible()
    await row(page, /دوام مسائي/).getByText('دوام مسائي').click()
    await expect(page).toHaveURL(/\/hr\/shifts\/schedules\/2/)
    await expect(heading(page, 'دوام مسائي')).toBeVisible()
    await open(page, '/hr/shifts/schedules/1', 'دوام صباحي')
    await expect(page.getByText('الأحد', { exact: true })).toBeVisible()
    await expect(page.getByText('8 – 16').first()).toBeVisible()
  })

  test('a new schedule opens in the create panel', async ({ page }) => {
    await page.goto('/hr/shifts/schedules')
    await page.getByRole('link', { name: 'جدول عمل جديد' }).click()
    await expect(page).toHaveURL(/\/hr\/shifts\/schedules\/new/)
    await expect(dialog(page).getByRole('heading', { name: 'جدول عمل جديد', exact: true })).toBeVisible()
  })
})

test.describe('assets', () => {
  test('the equipment list shows the mock rows and narrows to the unassigned ones', async ({ page }) => {
    await open(page, '/hr/assets', 'الأصول والعهد')
    await expect(row(page, /حاسوب محمول ديل.*سارة محمد/)).toBeVisible()
    await expect(row(page, /شاشة إل جي 27.*غير مُسلَّم/)).toBeVisible()
    await expect(row(page, /هاتف آيفون 15.*خالد الشمري/)).toBeVisible()
    await expect(row(page, /طابعة مكتبية قديمة/)).toHaveCount(0)
    await expect(page.getByTestId('hr-assets-count')).toHaveText('عرض 3 من 3 أصول')
    await page.goto('/hr/assets?assigned=false')
    await expect(page.getByTestId('hr-assets-count')).toHaveText('عرض 1 من أصل واحد')
    await expect(row(page, /شاشة إل جي 27/)).toBeVisible()
  })

  test('a row opens the asset record, which also opens by direct link', async ({ page }) => {
    await open(page, '/hr/assets', 'الأصول والعهد')
    await row(page, /هاتف آيفون 15/).getByText('هاتف آيفون 15').click()
    await expect(page).toHaveURL(/\/hr\/assets\/3/)
    await expect(heading(page, 'هاتف آيفون 15')).toBeVisible()
    await expect(page.getByTestId('hr-asset-state')).toHaveText('نشط')
  })

  test('a direct link to the asset record renders it', async ({ page }) => {
    const html = await serverRenderedHtml(page, '/hr/assets/1')
    expect(html).toContain('id="hr-asset-edit-name"')
    expect(html).toContain('value="حاسوب محمول ديل"')
    expect(html).toContain('value="DL-1001"')
    await open(page, '/hr/assets/1', 'حاسوب محمول ديل')
    await expect(page.getByTestId('hr-asset-edit-name')).toHaveValue('حاسوب محمول ديل')
    await expect(page.getByTestId('hr-asset-state')).toHaveText('نشط')
  })

  test('the create panel opens over the list and closing it returns with the filters', async ({ page }) => {
    await createPanelKeepsFilters(page, { list: '/hr/assets?assigned=true', create: '/hr/assets/new?assigned=true', createTestId: 'hr-asset-new', panelTitle: 'أصل جديد', listTitle: 'الأصول والعهد' })
    await expect(page.getByTestId('hr-assets-count')).toHaveText('عرض 2 من أصلين')
  })

  test('my assets lists only the custody of the caller', async ({ page }) => {
    await open(page, '/hr/assets/mine', 'عهدي')
    await expect(page.getByTestId('hr-my-assets-table')).toBeVisible()
    await expect(row(page, /حاسوب محمول ديل.*حواسيب محمولة/)).toBeVisible()
    await expect(row(page, /هاتف آيفون 15/)).toHaveCount(0)
    await row(page, /حاسوب محمول ديل/).getByText('حاسوب محمول ديل').click()
    await expect(page).toHaveURL(/\/hr\/assets\/1/)
  })
})

test.describe('recruitment', () => {
  test('the applicants list shows the mock rows and filters by status from the URL', async ({ page }) => {
    await open(page, '/hr/recruitment', 'التوظيف')
    await expect(row(page, /عبدالله الغامدي.*مطور واجهات.*مقابلة أولى.*قيد التوظيف/)).toBeVisible()
    await expect(row(page, /فهد المطيري.*تم التعيين.*مرتفع/)).toBeVisible()
    await expect(row(page, /هند الزهراني.*مرفوض/)).toBeVisible()
    await expect(page.getByText('عرض 4 من 4 متقدمين')).toBeVisible()
    await page.goto('/hr/recruitment?status=hired')
    await expect(page.getByText('عرض 1 من متقدم واحد')).toBeVisible()
    await expect(row(page, /فهد المطيري/)).toBeVisible()
    await expect(row(page, /عبدالله الغامدي/)).toHaveCount(0)
  })

  test('a row opens the applicant record', async ({ page }) => {
    await open(page, '/hr/recruitment', 'التوظيف')
    await row(page, /ريم السبيعي/).getByText('ريم السبيعي').click()
    await expect(page).toHaveURL(/\/hr\/recruitment\/2/)
    await expect(heading(page, 'ريم السبيعي')).toBeVisible()
    await expect(page.getByTestId('hr-recruitment-status')).toHaveText('قيد التوظيف')
  })

  test('a direct link to the applicant record renders it', async ({ page }) => {
    await open(page, '/hr/recruitment/1', 'عبدالله الغامدي')
    await expect(page.getByTestId('hr-recruitment-status')).toHaveText('قيد التوظيف')
    await expect(page.getByText('applicant1@example.test')).toBeVisible()
  })

  test('the create panel opens over the list and closing it returns with the filters', async ({ page }) => {
    await createPanelKeepsFilters(page, { list: '/hr/recruitment?status=ongoing', create: '/hr/recruitment/new?status=ongoing', createTestId: 'hr-recruitment-new', panelTitle: 'متقدم جديد', listTitle: 'التوظيف' })
    await expect(page.getByText('عرض 2 من متقدمين')).toBeVisible()
  })

  test('the jobs list opens a position record by row and by direct link', async ({ page }) => {
    await open(page, '/hr/recruitment/jobs', 'الوظائف')
    await expect(row(page, /مطور واجهات.*إدارة العمليات.*نشطة/)).toBeVisible()
    await expect(row(page, /محلل موارد بشرية.*الموارد البشرية/)).toBeVisible()
    await expect(row(page, /مساعد إداري/)).toHaveCount(0)
    await row(page, /محلل موارد بشرية/).getByText('محلل موارد بشرية').click()
    await expect(page).toHaveURL(/\/hr\/recruitment\/jobs\/2/)
    await expect(heading(page, 'محلل موارد بشرية')).toBeVisible()
    const html = await serverRenderedHtml(page, '/hr/recruitment/jobs/1')
    expect(html).toContain('value="مطور واجهات"')
    await open(page, '/hr/recruitment/jobs/1', 'مطور واجهات')
    await expect(page.getByRole('link', { name: 'متقدمو الوظيفة' })).toHaveAttribute('href', '/hr/recruitment?job_id=1')
  })
})

test.describe('onboarding', () => {
  test('the runs list shows the mock rows and filters by state from the URL', async ({ page }) => {
    await open(page, '/hr/onboarding', 'استقبال الموظفين')
    await expect(row(page, /منى القحطاني.*تهيئة الموظفين الجدد.*1 \/ 3.*قيد التنفيذ/)).toBeVisible()
    await expect(row(page, /خالد الشمري.*تهيئة فريق التقنية.*1 \/ 1.*منجزة/)).toBeVisible()
    await expect(page.getByText('عرض 2 من 2')).toBeVisible()
    await page.goto('/hr/onboarding?state=done')
    await expect(page.getByText('عرض 1 من 1')).toBeVisible()
    await expect(row(page, /منى القحطاني/)).toHaveCount(0)
  })

  test('a row opens the run record with its checklist, which also opens by direct link', async ({ page }) => {
    await open(page, '/hr/onboarding', 'استقبال الموظفين')
    await row(page, /منى القحطاني/).getByRole('link', { name: 'منى القحطاني' }).click()
    await expect(page).toHaveURL(/\/hr\/onboarding\/1/)
    await expect(heading(page, 'استقبال الموظفين')).toBeVisible()
    await expect(page.getByText('جولة تعريفية بالفريق')).toBeVisible()
    await expect(page.getByText('متأخرة', { exact: true })).toBeVisible()
    await open(page, '/hr/onboarding/2', 'استقبال الموظفين')
    await expect(page.getByText('منح صلاحيات المستودع')).toBeVisible()
  })

  test('the create panel opens over the list and closing it returns with the filters', async ({ page }) => {
    await createPanelKeepsFilters(page, { list: '/hr/onboarding?state=open', create: '/hr/onboarding/new?state=open', createTestId: 'hr-onboarding-new', panelTitle: 'استقبال موظف', listTitle: 'استقبال الموظفين' })
    await expect(row(page, /منى القحطاني/)).toBeVisible()
    await expect(row(page, /خالد الشمري/)).toHaveCount(0)
  })

  test('the plans list shows the mock plans and opens one by direct link', async ({ page }) => {
    await open(page, '/hr/onboarding/plans', 'خطط الاستقبال')
    await expect(row(page, /تهيئة الموظفين الجدد.*إدارة العمليات/)).toBeVisible()
    await expect(row(page, /تهيئة فريق التقنية.*كل الأقسام/)).toBeVisible()
    await open(page, '/hr/onboarding/plans/1', 'تهيئة الموظفين الجدد')
    await expect(page.getByLabel('وصف الخطوة').first()).toHaveValue('تجهيز الحساب والبريد')
  })
})

test.describe('offboarding', () => {
  test('the departures list shows the mock rows and filters by clearance from the URL', async ({ page }) => {
    await open(page, '/hr/offboarding', 'إنهاء الخدمة')
    await expect(row(page, /خالد الشمري.*2026-11-30.*استقالة.*غير مكتمل/)).toBeVisible()
    await expect(row(page, /ليلى الدوسري.*انتهاء العقد.*مكتمل/)).toBeVisible()
    await expect(row(page, /منى القحطاني.*بلا سبب مسجل/)).toBeVisible()
    await expect(page.getByText('عرض 3 من 3')).toBeVisible()
    await page.goto('/hr/offboarding?cleared=true')
    await expect(page.getByText('عرض 1 من 1')).toBeVisible()
    await expect(row(page, /ليلى الدوسري/)).toBeVisible()
    await expect(row(page, /خالد الشمري/)).toHaveCount(0)
  })

  test('a row opens the departure record with its clearance, which also opens by direct link', async ({ page }) => {
    const withoutEosRefusals = trackRefusedRequests(page, '/api/v1/hr/payroll/eos/')
    await open(page, '/hr/offboarding', 'إنهاء الخدمة')
    await row(page, /خالد الشمري/).getByRole('link', { name: 'خالد الشمري' }).click()
    await expect(page).toHaveURL(/\/hr\/offboarding\/2/)
    await expect(heading(page, 'خالد الشمري')).toBeVisible()
    await expect(page.getByText('استلام العهد')).toBeVisible()
    // One custody action in the page header; the open-custody alert is text and count only.
    const custodyLinks = page.getByRole('link', { name: 'عهد الموظف' })
    await expect(custodyLinks).toHaveCount(1)
    await expect(custodyLinks).toHaveAttribute('href', '/hr/assets?employee_id=2')
    await expect(page.getByTestId('hr-offboarding-held-assets')).toBeVisible()
    await expect(page.getByTestId('hr-offboarding-held-assets').getByRole('link')).toHaveCount(0)
    await open(page, '/hr/offboarding/4', 'ليلى الدوسري')
    await expect(page.getByText('إغلاق الحسابات')).toBeVisible()
    // The record also reads the end-of-service settlement (a 404 before one is saved) and its estimate (a 422 for a
    // reason without a case); the browser logs those refused requests (only those URLs are dropped) and the section handles them.
    errors = withoutEosRefusals(errors)
  })

  test('the create panel opens over the list and closing it returns with the filters', async ({ page }) => {
    await createPanelKeepsFilters(page, { list: '/hr/offboarding?cleared=false', create: '/hr/offboarding/new?cleared=false', createTestId: 'hr-offboarding-new', panelTitle: 'تسجيل إنهاء خدمة', listTitle: 'إنهاء الخدمة' })
    await expect(row(page, /خالد الشمري/)).toBeVisible()
    await expect(row(page, /ليلى الدوسري/)).toHaveCount(0)
  })

  test('the plans list shows the mock plan', async ({ page }) => {
    await open(page, '/hr/offboarding/plans', 'خطط الإخلاء')
    await expect(row(page, /خطة إخلاء الطرف/)).toBeVisible()
  })
})
