import { test } from '@e2e-dev/web';
import { credentials, expect } from 'e2e';

/**
 * Operations approval journey (J-05) against the scratch Odoo stack (`npm run e2e:odoo`):
 * the operations manager builds and publishes a three-stage process (pm, then the HR
 * manager, then the CEO), an employee submits a request, the first reviewer returns it for
 * change, the employee edits and resubmits, and the three reviewers approve in order.
 * A later reviewer cannot act early. Personas come from tools/e2e_seed.py; names carry a
 * timestamp so reruns on the reused database do not collide.
 * Scenarios J-05, OPS-01, OPS-05, OPS-06, OPS-07, OPS-12 (e2e/scenarios).
 */
const slow = { timeout: 30_000 };
const REVIEWERS = ['ماجد الغامدي', 'نورة القحطاني', 'خالد العتيبي'];
const STAGES = ['مراجعة مدير المشروع', 'اعتماد الموارد البشرية', 'اعتماد المدير العام'];

test('[J-05] a three-stage request is returned, resubmitted and approved in order', { tags: ['journey', 'operations'], timeout: 900_000 }, async ({ app, screen, browser }) => {
  test.skip(process.env.E2E_STACK !== 'odoo', 'needs the scratch Odoo stack (npm run e2e:odoo)');
  const stamp = Date.now().toString(36);
  const processName = `إجراء شراء ${stamp}`;
  const requestTitle = `شراء شاشات ${stamp}`;

  async function signIn(key: string) {
    await app.clearState();
    const user = credentials.user(key);
    await app.open('/login');
    await screen.getByLabel('اسم المستخدم').fill(user.username);
    await screen.getByLabel('كلمة المرور').fill(user.password);
    await screen.getByRole('button', 'دخول').tap();
    await expect(browser).toHaveURL(/localhost:\d+\/$/, slow);
  }

  async function openRequest(listPath: string) {
    await app.open(listPath);
    await screen.getByRole('link', requestTitle).tap();
    await expect(screen.getByRole('heading', { level: 1, name: requestTitle })).toBeVisible(slow);
  }

  async function decide(button: 'اعتماد' | 'إعادة للتعديل', comment?: string) {
    await screen.getByRole('region', 'قرارك مطلوب على هذا الطلب').getByRole('button', button).tap();
    const confirm = screen.getByRole('main').getByRole('alert');
    if (comment) await confirm.getByRole('textbox').fill(comment);
    await confirm.getByRole('button', button).tap();
  }

  // OPS-01: the operations manager builds and publishes the process.
  await signIn('ops_manager');
  await app.open('/settings/apps/operations/processes/new');
  const panel = screen.getByRole('dialog', 'إجراء جديد');
  await panel.getByRole('textbox', 'العنوان*').fill(processName);
  for (const [index, stage] of STAGES.entries()) {
    if (index > 0) await panel.getByRole('button', 'إضافة مرحلة').tap();
    await panel.getByRole('textbox', 'اسم المرحلة*').nth(index).fill(stage);
    await panel.getByRole('button', 'المراجعون').nth(index).tap();
    const picker = screen.getByRole('listbox').last();
    await picker.getByRole('option', REVIEWERS[index]).tap();
    await picker.getByRole('combobox', 'بحث').press('Escape');
    await expect(screen.getByRole('listbox')).toHaveCount(0, slow);
  }
  await panel.getByRole('button', 'إنشاء').tap();
  await expect(browser).toHaveURL(/\/settings\/apps\/operations\/processes\/\d+/, slow);
  await screen.getByRole('button', 'نشر').tap();
  await screen.getByRole('alert').getByRole('button', 'نشر').tap();
  await expect(screen.getByText('منشور').first()).toBeVisible(slow);

  // OPS-05: an employee submits a request on it.
  await signIn('staff2');
  await app.open('/operations/new');
  const form = screen.getByRole('dialog', 'طلب جديد');
  await form.getByRole('textbox', 'العنوان*').fill(requestTitle);
  await form.getByRole('combobox', 'الإجراء*').tap();
  await screen.getByRole('option', processName).tap();
  await form.getByRole('textbox', 'الوصف').fill('ثلاث شاشات');
  await form.getByRole('button', 'إنشاء').tap();
  await expect(screen.getByRole('dialog', 'طلب جديد')).toHaveCount(0, slow);
  await openRequest('/operations');
  await screen.getByRole('button', 'إرسال للموافقة').tap();
  await screen.getByRole('alert').getByRole('button', 'إرسال للموافقة').tap();
  await expect(screen.getByText('بانتظار الموافقة').first()).toBeVisible(slow);

  // OPS-07: the first reviewer returns it with a comment.
  await signIn('pm');
  await openRequest('/operations/pending');
  await decide('إعادة للتعديل', 'أضيفي عرض السعر');
  await expect(screen.getByText('معاد للتعديل').first()).toBeVisible(slow);

  // The employee edits and resubmits.
  await signIn('staff2');
  await openRequest('/operations');
  await screen.getByRole('link', 'تعديل').tap();
  await screen.getByRole('textbox', 'الوصف').fill('ثلاث شاشات، عرض السعر 4500 ريال');
  await screen.getByRole('button', 'حفظ').tap();
  await expect(screen.getByRole('heading', { level: 1, name: requestTitle })).toBeVisible(slow);
  await screen.getByRole('button', 'إرسال للموافقة').tap();
  await screen.getByRole('alert').getByRole('button', 'إرسال للموافقة').tap();
  await expect(screen.getByText('بانتظار الموافقة').first()).toBeVisible(slow);

  // OPS-12: the last reviewer does not see it while stage 1 is open.
  await signIn('ceo');
  await app.open('/operations/pending');
  await expect(screen.getByRole('link', requestTitle)).toHaveCount(0, slow);

  // OPS-06: the three reviewers approve in order.
  for (const [index, reviewer] of ['pm', 'hr_manager', 'ceo'].entries()) {
    await signIn(reviewer);
    await openRequest('/operations/pending');
    await decide('اعتماد');
    const next = index < 2 ? 'بانتظار الموافقة' : 'مكتمل';
    await expect(screen.getByRole('main').getByText(next).first()).toBeVisible(slow);
  }

  // The employee sees the completed request.
  await signIn('staff2');
  await openRequest('/operations');
  await expect(screen.getByText('مكتمل').first()).toBeVisible(slow);
});
