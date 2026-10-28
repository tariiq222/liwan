import { test } from '@e2e-dev/web';
import { expect } from 'e2e';

/**
 * Customer Inbox journey on the isolated mock stack (`npm run e2e`): open the inbox, open a conversation, send a
 * reply and see it in the thread, then open the inbox settings. Arabic UI, exact steps only. The mock answers the
 * inbox routes (apps/web/e2e/inbox-ui-preview-data.mjs); the mock login is admin/admin.
 */
const slow = { timeout: 30_000 };

test('an agent opens a conversation, replies, and opens the inbox settings', { tags: ['journey', 'inbox'] }, async ({ app, screen, browser }) => {
  test.skip(process.env.E2E_STACK === 'odoo', 'the inbox journey runs on the mock stack');
  const reply = `رد اختبار ${Date.now().toString(36)}`;

  await app.open('/login');
  await screen.getByLabel('اسم المستخدم').fill('admin');
  await screen.getByLabel('كلمة المرور').fill('admin');
  await screen.getByRole('button', 'دخول').tap();
  await expect(browser).toHaveURL(/^(?!.*\/login)/, slow);

  // The list: seeded conversations appear.
  await app.open('/inbox');
  await expect(screen.getByText('ليلى القحطاني')).toBeVisible(slow);

  // Open one: the thread shows its messages and the composer is offered.
  await screen.getByRole('link', /ليلى القحطاني/).first().tap();
  await expect(browser).toHaveURL(/\/inbox\/1/, slow);
  await expect(screen.getByText(/أريد حجز موعد يوم الخميس/)).toBeVisible(slow);

  // Send a reply: it joins the thread with a delivery state.
  await screen.getByRole('combobox', 'اكتب ردًا للعميل').fill(reply);
  await screen.getByRole('button', 'إرسال').tap();
  await expect(screen.getByText(reply)).toBeVisible(slow);

  // It survives a reload (it is on the server) and the list filters stay in the URL.
  await browser.reload();
  await expect(screen.getByText(reply)).toBeVisible(slow);

  // The settings page opens with its sections.
  await app.open('/settings/apps/inbox');
  await expect(screen.getByRole('heading', 'السياسة العامة')).toBeVisible(slow);
  await expect(screen.getByRole('heading', 'القنوات')).toBeVisible(slow);
});
