import { test } from '@e2e-dev/web';
import { credentials, expect } from 'e2e';

/**
 * HR user journey against the scratch Odoo stack (`npm run e2e:odoo`): sign in
 * as the seeded admin (HR manager, see tools/e2e_seed.py), create a department,
 * create an employee in it, find the employee in the directory, open the
 * detail and archive it through the inline confirmation. HR does not grant
 * logins, so no account step. Arabic UI, exact steps only; names carry a
 * timestamp so reruns on the reused database do not collide.
 */
// Dev-server pages compile on first hit and the lists load asynchronously.
const slow = { timeout: 30_000 };

test('admin creates a department and an employee, then archives the employee', { tags: ['journey', 'hr'] }, async ({ app, screen, browser }) => {
  test.skip(process.env.E2E_STACK !== 'odoo', 'needs the scratch Odoo stack (npm run e2e:odoo)');
  const stamp = Date.now().toString(36);
  const departmentName = `قسم اختبار ${stamp}`;
  const employeeName = `موظف اختبار ${stamp}`;
  const admin = credentials.user('admin');

  await app.open('/login');
  await screen.getByLabel('اسم المستخدم').fill(admin.username);
  await screen.getByLabel('كلمة المرور').fill(admin.password);
  await screen.getByRole('button', 'دخول').tap();
  await expect(browser).toHaveURL(/\/projects/, slow);

  // Create the department; saving lands on its detail page.
  await app.open('/hr/departments/new');
  await screen.getByLabel('الاسم').fill(departmentName);
  await screen.getByRole('button', 'حفظ').tap();
  await expect(browser).toHaveURL(/\/hr\/departments\/\d+$/, slow);
  await expect(screen.getByRole('heading', departmentName)).toBeVisible(slow);

  // Create the employee in that department; saving lands on the employee page.
  await app.open('/hr/employees/new');
  await screen.getByLabel('الاسم').fill(employeeName);
  await screen.getByLabel('المسمى الوظيفي').fill('محلل اختبار');
  await screen.getByRole('combobox', 'القسم').tap();
  await screen.getByRole('option', departmentName).tap();
  await screen.getByRole('button', 'حفظ').tap();
  await expect(browser).toHaveURL(/\/hr\/employees\/\d+$/, slow);
  await expect(screen.getByRole('heading', employeeName)).toBeVisible(slow);

  // Find the employee in the directory by search, then by department filter.
  await app.open('/hr');
  await screen.getByPlaceholder('بحث بالاسم…').fill(employeeName);
  await expect(screen.getByRole('link', employeeName)).toBeVisible(slow);
  await screen.getByRole('link', employeeName).tap();
  await expect(screen.getByRole('heading', employeeName)).toBeVisible(slow);

  // Archive with the inline confirmation (two steps: ask, then confirm).
  await screen.getByRole('button', 'أرشفة الموظف').tap();
  await expect(screen.getByTestId('inline-confirm')).toBeVisible(slow);
  await screen.getByTestId('inline-confirm-action').tap();
  await expect(screen.getByRole('button', 'استعادة الموظف')).toBeVisible(slow);

  // The archived employee leaves the active list and shows up in the archived one.
  await app.open('/hr');
  await screen.getByPlaceholder('بحث بالاسم…').fill(employeeName);
  await expect(screen.getByText('لا موظفون يطابقون الفلاتر')).toBeVisible(slow);
  await expect(screen.getByRole('link', employeeName)).toHaveCount(0, slow);
  await screen.getByRole('tab', 'المؤرشفون').tap();
  await expect(screen.getByRole('link', employeeName)).toBeVisible(slow);
});
