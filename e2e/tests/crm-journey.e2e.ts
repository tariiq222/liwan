import { test } from '@e2e-dev/web';
import { expect } from 'e2e';

/**
 * CRM user journey against the mock stack (`npm run e2e`): sign in, import a
 * leads file, call the due opportunity and record "no answer" (the next call is
 * scheduled), then record a sale with a package. The mock CRM keeps state and
 * is reset first; the scratch Odoo seed (tools/e2e_seed.py) grants no CRM role,
 * so this journey is mock-only. Arabic UI, exact steps only, no model calls.
 */
const slow = { timeout: 30_000 };

test('an agent imports leads, records no answer, then a sale with a package', { tags: ['journey', 'crm'] }, async ({ app, screen, browser }) => {
  test.skip(process.env.E2E_STACK === 'odoo', 'the CRM journey runs on the mock stack (npm run e2e)');

  // The mock accepts only its own demo account.
  await app.open('/login');
  await expect(screen.getByRole('button', 'دخول')).toBeEnabled(slow);
  await screen.getByLabel('اسم المستخدم').fill('admin');
  await screen.getByLabel('كلمة المرور').fill('admin');
  await screen.getByRole('button', 'دخول').tap();
  await expect(browser).not.toHaveURL(/\/login/, slow);

  // The mock CRM keeps state: start from its seed (needs the session).
  const reset = await browser.evaluate(async () => (await fetch('/api/v1/__mock/reset-crm', { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{}' })).status);
  expect(reset).toBe(200);

  // Import a file: upload, map name/phone/source, preview, confirm.
  await app.open('/crm/imports/new');
  await browser.locator('input[type=file]').setInputFiles('e2e/fixtures/crm-leads.csv');
  await expect(screen.getByTestId('crm-import-file-info')).toContainText('crm-leads.csv', slow);
  for (const [field, option] of [['name', 'الاسم'], ['phone', 'الهاتف'], ['source', 'الموقع']] as const) {
    await browser.locator(`#import-field-${field}`).tap();
    await screen.getByRole('option', option).tap();
  }
  await screen.getByTestId('crm-import-next').tap();
  await expect(screen.getByTestId('crm-import-count-new')).toContainText('3', slow);
  await screen.getByTestId('crm-import-confirm').tap();
  await expect(browser).toHaveURL(/\/crm\/opportunities/, slow);
  await expect(screen.getByRole('link', 'علي المالكي')).toBeVisible(slow);

  // Follow-up due: the seeded due opportunity shows under the due filter.
  await screen.getByTestId('crm-filter-due').tap();
  await expect(browser).toHaveURL(/due=1/, slow);
  await screen.getByRole('link', 'أحمد العتيبي').tap();
  await expect(screen.getByRole('heading', 'أحمد العتيبي')).toBeVisible(slow);

  // Call, "no answer": the call is logged and the next call is scheduled.
  await screen.getByTestId('crm-call-form').getByRole('combobox').first().tap();
  await screen.getByRole('option', 'لا يرد').tap();
  await screen.getByTestId('crm-call-submit').tap();
  await expect(screen.getByTestId('crm-recorded')).toContainText('الاتصال القادم', slow);
  await expect(screen.getByTestId('crm-next-call')).toBeVisible();
  await expect(screen.getByTestId('crm-call-log')).toContainText('لا يرد');

  // Sold with a package: the opportunity closes as won.
  await screen.getByTestId('crm-call-form').getByRole('combobox').first().tap();
  await screen.getByRole('option', 'تم البيع').tap();
  await screen.getByTestId('crm-sale-form').getByRole('combobox').tap();
  await screen.getByRole('option', /باقة متقدمة/).tap();
  await screen.getByTestId('crm-call-submit').tap();
  await expect(screen.getByTestId('crm-call-form')).toHaveCount(0, slow);
  await expect(screen.getByTestId('crm-recorded')).toContainText('تم البيع');
});
