import { test } from '@e2e-dev/web';
import { expect } from 'e2e';

/**
 * Customer Inbox journey on the isolated mock stack (`npm run e2e`): open the inbox, open a conversation, send a
 * reply and see it in the thread, quote a message, send a location and an interactive message, then open the inbox
 * settings. Arabic UI, exact steps only. The mock answers the
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
  await expect(screen.getByText(/أريد حجز موعد يوم الخميس/).first()).toBeVisible(slow);

  // Send a reply: it joins the thread with a delivery state.
  await screen.getByRole('combobox', 'اكتب ردًا للعميل').fill(reply);
  await screen.getByRole('button', 'إرسال').tap();
  await expect(screen.getByText(reply).first()).toBeVisible(slow);

  // It survives a reload (it is on the server) and the list filters stay in the URL.
  await browser.reload();
  await expect(screen.getByText(reply).first()).toBeVisible(slow);

  // Quote a message: the chip sits above the composer and the sent reply carries the quote.
  const quoted = `رد مقتبس ${Date.now().toString(36)}`;
  await screen.getByTestId('inbox-reply-action').first().tap();
  await expect(screen.getByTestId('inbox-reply-chip')).toBeVisible(slow);
  await screen.getByRole('combobox', 'اكتب ردًا للعميل').fill(quoted);
  await screen.getByRole('button', 'إرسال').tap();
  await expect(screen.getByText(quoted).first()).toBeVisible(slow);
  await expect(screen.getByTestId('inbox-reply-chip')).toBeHidden(slow);

  // Send a location: its card links to the map.
  await screen.getByTestId('inbox-location-toggle').tap();
  await screen.getByLabel('خط العرض').fill('24.7136');
  await screen.getByLabel('خط الطول').fill('46.6753');
  await screen.getByLabel('اسم المكان (اختياري)').fill('مكتب الاختبار');
  await screen.getByRole('button', 'إرسال').tap();
  await expect(screen.getByText('مكتب الاختبار').first()).toBeVisible(slow);

  // Send an interactive message with two reply buttons.
  const question = `هل يناسبك الموعد ${Date.now().toString(36)}`;
  await screen.getByTestId('inbox-interactive-toggle').tap();
  await screen.getByLabel('نص الرسالة', { exact: true }).fill(question);
  await screen.getByLabel('نص الزر 1').fill('يناسبني');
  await screen.getByRole('button', 'إضافة زر').tap();
  await screen.getByLabel('نص الزر 2').fill('لا يناسبني');
  await screen.getByRole('button', 'إرسال').tap();
  await expect(screen.getByText(question).first()).toBeVisible(slow);

  // The settings page opens with its sections.
  await app.open('/settings/apps/inbox');
  await expect(screen.getByRole('heading', 'السياسة العامة')).toBeVisible(slow);
  await expect(screen.getByRole('heading', 'القنوات')).toBeVisible(slow);
});

test('a manager creates a WhatsApp template and sees it waiting for Meta review', { tags: ['journey', 'inbox'] }, async ({ app, screen, browser }) => {
  test.skip(process.env.E2E_STACK === 'odoo', 'the template journey runs on the mock stack');
  const name = `offer_${Date.now().toString(36)}`;

  await app.open('/login');
  await screen.getByLabel('اسم المستخدم').fill('admin');
  await screen.getByLabel('كلمة المرور').fill('admin');
  await screen.getByRole('button', 'دخول').tap();
  await expect(browser).toHaveURL(/^(?!.*\/login)/, slow);

  // The channel's templates: the seeded ones with the status Meta gave each.
  await app.open('/settings/apps/inbox/channels/1/templates');
  await expect(screen.getByText('appointment_reminder')).toBeVisible(slow);
  await expect(screen.getByText('summer_offer')).toBeVisible(slow);

  // Create one: the name is slugged as typed and the preview follows the body and its example.
  await screen.getByTestId('inbox-template-create').tap();
  await expect(browser).toHaveURL(/\/templates\/new/, slow);
  await screen.getByTestId('inbox-template-name').fill(name);
  await screen.getByTestId('inbox-template-body').fill('مرحبًا ');
  await screen.getByTestId('inbox-template-add-variable').tap();
  await screen.getByTestId('inbox-template-example-0').fill('سارة');
  await expect(screen.getByTestId('inbox-template-preview-body')).toContainText('مرحبًا سارة');
  await screen.getByTestId('inbox-template-submit').tap();

  // It opens as a page, in review and read-only, and appears in the list as waiting.
  await expect(browser).toHaveURL(/\/templates\/\d+$/, slow);
  await expect(screen.getByTestId('inbox-template-readonly')).toBeVisible(slow);
  await app.open('/settings/apps/inbox/channels/1/templates?status=pending');
  await expect(screen.getByText(name)).toBeVisible(slow);
});

test('a manager creates a keyword rule and tries it in the dry run', { tags: ['journey', 'inbox'] }, async ({ app, screen, browser }) => {
  test.skip(process.env.E2E_STACK === 'odoo', 'the automation journey runs on the mock stack');
  const name = `قاعدة الأسعار ${Date.now().toString(36)}`;

  await app.open('/login');
  await screen.getByLabel('اسم المستخدم').fill('admin');
  await screen.getByLabel('كلمة المرور').fill('admin');
  await screen.getByRole('button', 'دخول').tap();
  await expect(browser).toHaveURL(/^(?!.*\/login)/, slow);

  // The rules list: the seeded rules in the order they are tried.
  await app.open('/settings/apps/inbox/rules');
  await expect(screen.getByText('حجز موعد')).toBeVisible(slow);

  // Create one: the route-backed panel, a keyword and a text reply.
  await screen.getByTestId('inbox-rule-add').tap();
  await expect(browser).toHaveURL(/\/rules\/new/, slow);
  await screen.getByTestId('inbox-rule-name').fill(name);
  await screen.getByLabel('الكلمات').fill('أسعار');
  await screen.getByLabel('الكلمات').press('Enter');
  await screen.getByTestId('inbox-auto-content-body').fill('الأسعار في القائمة المرفقة.');
  await screen.getByTestId('inbox-rule-submit').tap();
  await expect(browser).toHaveURL(/\/settings\/apps\/inbox\/rules$/, slow);
  await expect(screen.getByText(name)).toBeVisible(slow);

  // Try it: a message with the keyword matches the new rule.
  await screen.getByTestId('inbox-rule-test-text').fill('ما هي الأسعار لديكم؟');
  await screen.getByTestId('inbox-rule-test-run').tap();
  await expect(screen.getByTestId('inbox-rule-test-rules')).toContainText(name, slow);
});
