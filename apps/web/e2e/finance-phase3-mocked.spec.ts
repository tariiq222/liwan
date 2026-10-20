import { expect, test, type Page } from '@playwright/test'
import { collectBrowserErrors, currentRoute, dialog, heading, MOCK_STACK_ONLY, openPage as open, row } from './support/mock-pages'
import { login } from './support/tasmim6'

test.skip(process.env.E2E_PROJECT_POPUPS !== '1', MOCK_STACK_ONLY)

// Finance phase 3 (budgets, fixed assets, MIS reports) against the synthetic data of the finance preview modules.
let errors: string[]

test.beforeEach(async ({ page }) => {
  await login(page)
  errors = collectBrowserErrors(page)
})

test.afterEach(() => {
  expect(errors, 'no page error and no console error').toEqual([])
})

// The amounts are formatted for the Arabic locale with the currency code after them; only the digits are asserted.
const amount = (digits: string) => new RegExp(digits.replace(/[.,]/g, '\\$&'))

// Opens the create panel from the list's create button; it carries the list location as returnTo, which closing restores.
async function createPanelReturnsToList(page: Page, { list, createTestId, panelTitle, listTitle }: { list: string; createTestId: string; panelTitle: string; listTitle: string }) {
  await open(page, list, listTitle)
  await page.getByTestId(createTestId).click()
  await expect(page).toHaveURL(/\/new\?returnTo=/)
  await expect(dialog(page).getByRole('heading', { name: panelTitle, exact: true })).toBeVisible()
  await dialog(page).getByRole('button', { name: 'إغلاق' }).click()
  await expect(dialog(page)).toHaveCount(0)
  expect(currentRoute(page)).toBe(list)
  await expect(heading(page, listTitle)).toBeVisible()
}

test.describe('budgets', () => {
  test('the list shows every mock budget and its state', async ({ page }) => {
    await open(page, '/finance/budgets', 'الميزانيات')
    await expect(row(page, /ميزانية 2026 التشغيلية.*6 بنود.*معتمدة/)).toBeVisible()
    await expect(row(page, /ميزانية فرع جدة 2027.*مسودة/)).toBeVisible()
    await expect(row(page, /ميزانية مشروع التوسع.*ملغاة/)).toBeVisible()
    await expect(page.getByText('عرض 6 من 6 ميزانيات')).toBeVisible()
  })

  test('the state filter in the URL narrows the list', async ({ page }) => {
    await open(page, '/finance/budgets?state=draft', 'الميزانيات')
    await expect(page.getByText('عرض 2 من ميزانيتين')).toBeVisible()
    await expect(row(page, /ميزانية التسويق 2027/)).toBeVisible()
    await expect(row(page, /ميزانية 2026 التشغيلية/)).toHaveCount(0)
  })

  test('a row opens the budget record, which also opens by direct link, with its variance and report link', async ({ page }) => {
    await open(page, '/finance/budgets', 'الميزانيات')
    await row(page, /ميزانية الربع الرابع 2026/).getByText('ميزانية الربع الرابع 2026').click()
    await expect(page).toHaveURL(/\/finance\/budgets\/2/)
    await expect(heading(page, 'ميزانية الربع الرابع 2026')).toBeVisible()
    await open(page, '/finance/budgets/1', 'ميزانية 2026 التشغيلية')
    await expect(row(page, /رواتب الموظفين.*مدين.*540,000\.00/)).toBeVisible()
    await expect(row(page, /الكهرباء والاتصالات.*36,000\.00.*41,200\.00.*-5,200\.00.*غير مناسب/)).toBeVisible()
    await expect(page.getByRole('link', { name: 'فتح التقرير' })).toHaveAttribute('href', '/finance/reports/budget-vs-actual?budget_id=1')
  })

  test('the create panel opens over the list and closing it returns to the filtered list', async ({ page }) => {
    await createPanelReturnsToList(page, { list: '/finance/budgets?state=draft', createTestId: 'finance-budget-new', panelTitle: 'ميزانية جديدة', listTitle: 'الميزانيات' })
    await expect(page.getByText('عرض 2 من ميزانيتين')).toBeVisible()
  })
})

test.describe('fixed assets', () => {
  test('the list shows every mock asset with its state and residual value', async ({ page }) => {
    await open(page, '/finance/assets', 'الأصول الثابتة')
    await expect(row(page, /AST-001.*لابتوبات الإدارة.*12,000\.00.*8,333\.37.*قيد التشغيل/)).toBeVisible()
    await expect(row(page, /AST-004.*كراسي مكتبية.*مسودة/)).toBeVisible()
    await expect(row(page, /AST-007.*طابعات الطابق الأول.*مستبعد/)).toBeVisible()
    await expect(page.getByText('عرض 8 من 8 أصول')).toBeVisible()
  })

  test('the state filter in the URL narrows the list', async ({ page }) => {
    await open(page, '/finance/assets?state=draft', 'الأصول الثابتة')
    await expect(row(page, /AST-004/)).toBeVisible()
    await expect(row(page, /AST-006/)).toBeVisible()
    await expect(row(page, /AST-001/)).toHaveCount(0)
  })

  test('a row opens the asset record, which also opens by direct link, with its depreciation board', async ({ page }) => {
    await open(page, '/finance/assets', 'الأصول الثابتة')
    await row(page, /AST-003/).getByText('طاولات الاجتماعات').click()
    await expect(page).toHaveURL(/\/finance\/assets\/3/)
    await expect(heading(page, 'طاولات الاجتماعات')).toBeVisible()
    await open(page, '/finance/assets/1', 'لابتوبات الإدارة')
    await expect(page.getByText('عشرة أجهزة لفريق الإدارة.')).toBeVisible()
    await expect(page.getByRole('table', { name: 'جدول الإهلاك' })).toBeVisible()
    await expect(row(page, /2025-11-01.*اقتناء.*12,000\.00/)).toBeVisible()
    await expect(row(page, /2025-12-01.*إهلاك.*333\.33.*MISC\/2025\/1002/)).toBeVisible()
  })

  test('the create panel opens over the list and closing it returns to the filtered list', async ({ page }) => {
    await createPanelReturnsToList(page, { list: '/finance/assets?state=draft', createTestId: 'finance-asset-new', panelTitle: 'أصل جديد', listTitle: 'الأصول الثابتة' })
    await expect(row(page, /AST-004/)).toBeVisible()
  })
})

test.describe('reports', () => {
  test('the income statement renders its server totals and lines', async ({ page }) => {
    await open(page, '/finance/reports/profit-loss', 'قائمة الدخل')
    const kpis = page.getByTestId('finance-report-kpis')
    await expect(kpis).toContainText('الإيرادات')
    await expect(kpis).toContainText(amount('480,000.00'))
    await expect(kpis).toContainText(amount('270,000.00'))
    await expect(kpis).toContainText(amount('140,000.00'))
    await expect(row(page, /^الإيرادات.*480,000\.00/)).toBeVisible()
    await expect(row(page, /^تكلفة الإيرادات.*210,000\.00/)).toBeVisible()
    await expect(row(page, /^مجمل الربح.*270,000\.00/)).toBeVisible()
    await expect(row(page, /^الربح التشغيلي.*135,000\.00/)).toBeVisible()
    await expect(row(page, /^صافي الربح.*140,000\.00/)).toBeVisible()
  })

  test('the balance sheet renders its totals and balances to zero', async ({ page }) => {
    await open(page, '/finance/reports/balance-sheet?date_to=2026-06-30', 'الميزانية العمومية')
    await expect(page.getByText(/2026-06-30/).first()).toBeVisible()
    const kpis = page.getByTestId('finance-report-kpis')
    await expect(kpis).toContainText(amount('455,000.00'))
    await expect(kpis).toContainText(amount('142,000.00'))
    await expect(kpis).toContainText(amount('313,000.00'))
    await expect(row(page, /^إجمالي الأصول.*455,000\.00/)).toBeVisible()
    await expect(row(page, /^إجمالي الالتزامات.*142,000\.00/)).toBeVisible()
    await expect(row(page, /^إجمالي حقوق الملكية.*313,000\.00/)).toBeVisible()
    await expect(row(page, /^الفرق.*0\.00/)).toBeVisible()
  })

  test('the zakat base renders its base, rate, amount due and the review notice', async ({ page }) => {
    await open(page, '/finance/reports/zakat-base', 'وعاء الزكاة')
    const kpis = page.getByTestId('finance-report-kpis')
    await expect(kpis).toContainText(amount('327,000.00'))
    await expect(kpis).toContainText(amount('8,429.01'))
    await expect(kpis).toContainText(amount('2.58'))
    await expect(row(page, /^إجمالي الإضافات.*497,000\.00/)).toBeVisible()
    await expect(row(page, /^إجمالي الحسومات.*170,000\.00/)).toBeVisible()
    await expect(page.getByText('الحساب مبسّط ولا يغني عن مراجعة محاسب قانوني سعودي قبل الاعتماد عليه.')).toBeVisible()
  })

  test('the budget report asks for a budget, then renders its totals and variance lines', async ({ page }) => {
    await open(page, '/finance/reports/budget-vs-actual', 'الميزانية مقابل الفعلي')
    await expect(page.getByText('تُعرض المقارنة بعد اختيار الميزانية.')).toBeVisible()
    await open(page, '/finance/reports/budget-vs-actual?budget_id=1', 'الميزانية مقابل الفعلي')
    const kpis = page.getByTestId('finance-report-kpis')
    await expect(kpis).toContainText(amount('747,700.00'))
    await expect(kpis).toContainText(amount('2,352,000.00'))
    await expect(kpis).toContainText(amount('1,604,300.00'))
    await expect(row(page, /رواتب الموظفين.*540,000\.00.*495,000\.00.*45,000\.00.*مناسب/)).toBeVisible()
    await expect(row(page, /مبيعات المنتجات.*1,800,000\.00.*1,650,000\.00.*غير مناسب/)).toBeVisible()
  })
})
