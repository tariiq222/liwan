import { test } from '@e2e-dev/web';
import { credentials, expect } from 'e2e';

/**
 * Chat user journey against the scratch Odoo stack (`npm run e2e:odoo`): the
 * seeded admin starts a direct conversation with the seeded employee and sends
 * a message, the message survives a reload, then the employee signs in (same
 * browser, after `clearState`) and finds the message in the conversation.
 * Arabic UI, exact steps only; the message carries a timestamp so reruns on the
 * reused database (a direct conversation is reused) do not collide.
 */
// Dev-server pages compile on first hit and the lists load asynchronously.
const slow = { timeout: 30_000 };

test('admin messages the employee and the employee receives it', { tags: ['journey', 'chat'] }, async ({ app, screen, browser }) => {
  test.skip(process.env.E2E_STACK !== 'odoo', 'needs the scratch Odoo stack (npm run e2e:odoo)');
  const stamp = Date.now().toString(36);
  const message = `رسالة اختبار ${stamp}`;
  const admin = credentials.user('admin');
  const employee = credentials.user('employee');

  async function signIn(user: { username: string; password: ReturnType<typeof credentials.user>['password'] }) {
    await app.open('/login');
    await screen.getByLabel('اسم المستخدم').fill(user.username);
    await screen.getByLabel('كلمة المرور').fill(user.password);
    await screen.getByRole('button', 'دخول').tap();
    await expect(browser).toHaveURL(/\/projects/, slow);
  }

  await signIn(admin);

  // Start a direct conversation with the employee.
  await app.open('/chat/new');
  await screen.getByLabel('بحث عن أشخاص').fill('E2E Employee');
  await screen.getByRole('button', /E2E Employee/).tap();
  await screen.getByRole('button', 'بدء المحادثة').tap();
  await expect(browser).toHaveURL(/\/chat\/\d+/, slow);

  // Send a message and see it in the history.
  await screen.getByRole('textbox', 'اكتب رسالة').fill(message);
  await screen.getByRole('button', 'إرسال').tap();
  await expect(screen.getByText(message)).toBeVisible(slow);

  // It is stored on the server: still there after a reload.
  await browser.reload();
  await expect(screen.getByText(message)).toBeVisible(slow);

  // The employee signs in and receives it.
  await app.clearState();
  await signIn(employee);
  await app.open('/chat');
  await screen.getByRole('link', /E2E Admin/).first().tap();
  await expect(screen.getByText(message)).toBeVisible(slow);
});
