import { expect, test } from '@playwright/test'
import { collectBrowserErrors, MOCK_STACK_ONLY } from './support/mock-pages'
import { login, open } from './support/tasmim6'

test.skip(process.env.E2E_PROJECT_POPUPS !== '1', MOCK_STACK_ONLY)

// The finance screens PR #8 added, each opened in Arabic (RTL) and English (LTR) against the synthetic finance data: the page
// shows its h1, raises no page or console error and keeps the direction of its language. Issue #19 asks for this proof;
// docs/verification/2026-10-31-finance-pr8.md records what was run.
const SCREENS: { screen: string; path: string }[] = [
  { screen: 'ledger settings: accounts', path: '/settings/apps/finance/accounts' },
  { screen: 'ledger settings: asset files', path: '/settings/apps/finance/asset-profiles' },
  { screen: 'payments list', path: '/finance/payments' },
  { screen: 'payment create (standalone)', path: '/finance/payments/new' },
  { screen: 'bank statements', path: '/finance/bank/statements' },
  { screen: 'bank statement import', path: '/finance/bank/statements/new' },
  { screen: 'bank statement lines (auto-match, undo, correct, delete)', path: '/finance/bank/statements/1' },
  { screen: 'asset record (disposal)', path: '/finance/assets/1' },
  { screen: 'cash-flow report', path: '/finance/reports/cash-flow' },
  { screen: 'VAT report', path: '/finance/reports/vat' },
  { screen: 'zakat base', path: '/finance/reports/zakat-base' },
  { screen: 'budget record (cost-center split)', path: '/finance/budgets/1' },
  { screen: 'ZATCA work queue', path: '/settings/apps/finance' },
]

for (const locale of ['ar', 'en'] as const) {
  test.describe(`PR #8 finance screens in ${locale}`, () => {
    let errors: string[]

    test.beforeEach(async ({ page, baseURL }) => {
      await login(page)
      await page.context().addCookies([{ name: 'liwan-locale', value: locale, url: baseURL! }])
      errors = collectBrowserErrors(page)
    })

    test.afterEach(() => {
      expect(errors, 'no page error and no console error').toEqual([])
    })

    for (const { screen, path } of SCREENS) {
      test(`${screen} opens`, async ({ page }) => {
        await open(page, path)
        await expect(page.getByRole('heading', { level: 1 }).first()).toBeVisible()
        await expect(page.locator('html')).toHaveAttribute('dir', locale === 'ar' ? 'rtl' : 'ltr')
      })
    }
  })
}
