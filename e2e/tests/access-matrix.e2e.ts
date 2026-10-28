import { test } from '@e2e-dev/web';
import { credentials, expect } from 'e2e';

/**
 * Role matrix against the scratch Odoo stack (`npm run e2e:odoo`): every demo-company
 * persona (tools/e2e_seed.py) signs in, the application rail lists exactly the
 * applications its roles open, and each page below either opens or shows the
 * forbidden page. Scenarios ACC-01, ACC-02, ACC-14, FIN-21, HR-41, PMO-03, MTG-02,
 * OPS-11, OPS-20, OPS-22, DOC-14 (e2e/scenarios). Read-only: nothing is created.
 */
const slow = { timeout: 30_000 };
const FORBIDDEN = 'لا تملك صلاحية فتح هذه الصفحة';

// Accessible names of the rail links. Two differ from the visible label (PLT-271):
// «الموظفين» is named «الموارد البشرية» and «المساعد» is named «WebVue AI».
const COMMON_APPS = ['يومي', 'مهامي', 'المشاريع', 'الاجتماعات', 'المحادثات', 'الموارد البشرية', 'العمليات', 'المستندات', 'WebVue AI'];
const FINANCE = 'المالية';
const SETTINGS = 'الإعدادات';

// Page -> personas allowed to open it; everyone else sees the forbidden page.
const PAGES: Record<string, string[]> = {
  '/finance': ['cfo', 'accountant', 'auditor'],
  '/finance/sales/invoices': ['cfo', 'accountant', 'auditor'],
  '/finance/budgets': ['cfo', 'accountant', 'auditor'],
  '/settings/apps/finance': ['cfo', 'accountant', 'auditor'],
  '/hr/payroll': ['payroll'],
  '/hr/leave': ['hr_manager'],
  '/hr/employees/new': ['hr_manager'],
  '/hr/recruitment': ['hr_manager'],
  '/hr/assets': ['hr_manager'],
  '/settings/apps/hr': ['hr_manager', 'payroll'],
  '/settings/team/users': ['it_admin'],
  '/settings/team/roles': ['it_admin'],
  '/settings/apps/projects': ['ceo'],
  '/projects/new': ['ceo'],
  '/meetings/new': ['it_admin'],
  '/settings/apps/operations/processes': ['ops_manager'],
  '/operations/pending': ['pm'],
  '/operations/monitoring': ['ops_manager'],
  '/documents/new': ['hr_manager'],
};

const PERSONAS: Record<string, { finance: boolean; settings: boolean }> = {
  ceo: { finance: false, settings: true },
  it_admin: { finance: false, settings: true },
  hr_manager: { finance: false, settings: true },
  payroll: { finance: false, settings: true },
  cfo: { finance: true, settings: true },
  accountant: { finance: true, settings: true },
  auditor: { finance: true, settings: true },
  pm: { finance: false, settings: false },
  ops_manager: { finance: false, settings: true },
  staff1: { finance: false, settings: false },
  staff2: { finance: false, settings: false },
};

for (const [key, rail] of Object.entries(PERSONAS)) {
  test(`[ACC-01] ${key} sees its applications and only its pages`, { tags: ['access', 'personas'], timeout: 600_000 }, async ({ app, screen, browser }) => {
    test.skip(process.env.E2E_STACK !== 'odoo', 'needs the scratch Odoo stack (npm run e2e:odoo)');
    const user = credentials.user(key);
    await app.open('/login');
    await screen.getByLabel('اسم المستخدم').fill(user.username);
    await screen.getByLabel('كلمة المرور').fill(user.password);
    await screen.getByRole('button', 'دخول').tap();
    await expect(browser).toHaveURL(/localhost:\d+\/$/, slow);

    const railLinks = screen.getByTestId('module-rail');
    for (const name of COMMON_APPS) {
      await expect(railLinks.getByRole('link', name, { exact: true })).toBeVisible(slow);
    }
    await expect(railLinks.getByRole('link', FINANCE, { exact: true })).toHaveCount(rail.finance ? 1 : 0);
    await expect(railLinks.getByRole('link', SETTINGS, { exact: true })).toHaveCount(rail.settings ? 1 : 0);

    for (const [path, allowed] of Object.entries(PAGES)) {
      await app.open(path);
      await expect(screen.getByRole('main')).toBeVisible(slow);
      if (allowed.includes(key)) {
        await expect(screen.getByText(FORBIDDEN)).toHaveCount(0, slow);
      } else {
        await expect(screen.getByText(FORBIDDEN)).toBeVisible(slow);
      }
    }
  });
}
