import { test } from '@e2e-dev/web';
import { credentials, expect } from 'e2e';

/**
 * PMO user journey against the scratch Odoo stack (`npm run e2e:odoo`): sign in
 * as the seeded admin, create a project, open it, create a task in it and move
 * the task to "waiting". Arabic UI, exact steps only. Needs the accounts from
 * tools/e2e_seed.py; names carry a timestamp so reruns on the reused database
 * do not collide.
 */
test('admin creates a project and a task and changes its state', { tags: ['journey', 'pmo'] }, async ({ app, screen, browser }) => {
  // The mock API is read-only, so this journey only runs on `npm run e2e:odoo`.
  test.skip(process.env.E2E_STACK !== 'odoo', 'needs the scratch Odoo stack (npm run e2e:odoo)');
  const stamp = Date.now().toString(36);
  const projectName = `مشروع اختبار ${stamp}`;
  const taskTitle = `مهمة اختبار ${stamp}`;
  const admin = credentials.user('admin');

  // Sign in through the real login form.
  await app.open('/login');
  await screen.getByLabel('اسم المستخدم').fill(admin.username);
  await screen.getByLabel('كلمة المرور').fill(admin.password);
  await screen.getByRole('button', 'دخول').tap();
  await expect(browser).toHaveURL(/\/projects/);

  // Create the project. The charter requires an end date, so the draft save
  // jumps to the schedule step first; pick a day from the calendar and save.
  await app.open('/projects/new');
  await screen.getByLabel('الاسم').fill(projectName);
  await screen.getByTestId('charter-save-draft').tap();
  await expect(screen.getByTestId('charter-step-notice')).toBeVisible();
  await screen.getByTestId('project-create-end-date').tap();
  await screen.getByRole('button', /،\s15\s/).tap();
  await screen.getByTestId('charter-save-draft').tap();
  await expect(browser).toHaveURL(/\/projects\/\d+\/charter/);

  // Open the project from the list.
  await app.open('/projects');
  await screen.getByRole('link', projectName).tap();
  await expect(screen.getByRole('heading', projectName)).toBeVisible();

  // Create a task in it.
  await screen.getByRole('link', 'المهام').tap();
  await screen.getByRole('button', 'مهمة جديدة').tap();
  await screen.getByLabel('عنوان المهمة').fill(taskTitle);
  await screen.getByRole('button', 'إنشاء').tap();
  await expect(screen.getByRole('button', taskTitle)).toBeVisible();

  // A new task starts in progress; move it to waiting and verify the badge.
  await screen.getByRole('button', taskTitle).tap();
  await expect(screen.getByRole('heading', taskTitle)).toBeVisible();
  await expect(screen.getByRole('button', 'قيد التنفيذ')).toBeVisible();
  await screen.getByRole('button', 'قيد التنفيذ').tap();
  await screen.getByRole('menuitem', 'بانتظار').tap();
  await expect(screen.getByRole('button', 'بانتظار')).toBeVisible();
});
