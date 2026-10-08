import { test } from '@e2e-dev/web';
import { credentials, expect } from 'e2e';

/**
 * Meetings user journey against the scratch Odoo stack (`npm run e2e:odoo`):
 * sign in as the seeded admin (meetings manager via the access-admin group, see
 * tools/e2e_seed.py), schedule a meeting on a clock-derived day of the current month with
 * the seeded employee as attendee, open it, add a recommendation, and find the
 * meeting in the list and in the calendar. Arabic UI, exact steps only; names
 * carry a timestamp so reruns on the reused database do not collide.
 */
// Dev-server pages compile on first hit and the lists load asynchronously.
const slow = { timeout: 30_000 };

test('admin schedules a meeting with an attendee and adds a recommendation', { tags: ['journey', 'meetings'] }, async ({ app, screen, browser }) => {
  test.skip(process.env.E2E_STACK !== 'odoo', 'needs the scratch Odoo stack (npm run e2e:odoo)');
  const stamp = Date.now().toString(36);
  const meetingName = `اجتماع اختبار ${stamp}`;
  const resolutionName = `توصية اختبار ${stamp}`;
  const admin = credentials.user('admin');
  // The server rejects overlapping meetings of one organizer and the database
  // persists between runs, so every run takes its own day (11 to 20) and a
  // 10 minute slot derived from the clock.
  const tick = Math.floor(Date.now() / 60_000);
  const day = 11 + (tick % 10);
  const slot = Math.floor(tick / 10) % 92;
  const hh = String(Math.floor(slot / 4)).padStart(2, '0');
  const mm = String((slot % 4) * 15).padStart(2, '0');
  const endMm = String((slot % 4) * 15 + 10).padStart(2, '0');

  await app.open('/login');
  await screen.getByLabel('اسم المستخدم').fill(admin.username);
  await screen.getByLabel('كلمة المرور').fill(admin.password);
  await screen.getByRole('button', 'دخول').tap();
  await expect(browser).toHaveURL(/\/projects/, slow);

  // Schedule the meeting: title, the day from the calendar, a time range and
  // the employee picked from the attendee picker.
  await app.open('/meetings/new');
  await screen.getByLabel('عنوان الاجتماع').fill(meetingName);
  await screen.getByLabel('التاريخ').tap();
  await screen.getByRole('button', new RegExp(`،\\s${day}\\s`)).tap();
  await screen.getByLabel('البداية').fill(`${hh}:${mm}`);
  await screen.getByLabel('النهاية').fill(`${hh}:${endMm}`);
  await screen.getByTestId('person-picker').first().tap();
  await screen.getByRole('option', 'E2E Employee').tap();
  await expect(screen.getByRole('button', 'إزالة E2E Employee')).toBeVisible(slow);
  // The multi-select menu stays open after a pick; close it before saving.
  await screen.getByTestId('person-picker').first().press('Escape');
  await screen.getByRole('button', 'إنشاء').tap();
  await expect(browser).toHaveURL(/\/meetings\/\d+$/, slow);
  await expect(screen.getByText(meetingName).first()).toBeVisible(slow);
  await expect(screen.getByText('E2E Employee')).toBeVisible(slow);

  // Add a recommendation owned by the employee from the recommendations tab.
  await screen.getByRole('tab', 'التوصيات (0)').tap();
  await screen.getByRole('link', 'توصية جديدة').tap();
  await expect(browser).toHaveURL(/\/meetings\/\d+\/resolutions\/new/, slow);
  await screen.getByLabel('عنوان التوصية').fill(resolutionName);
  await screen.getByLabel('مدة التنفيذ').fill('أسبوعان');
  await screen.getByTestId('person-picker').tap();
  await screen.getByRole('option', 'E2E Employee').tap();
  await expect(screen.getByRole('listbox')).toBeHidden(slow);
  await screen.getByRole('button', 'إنشاء').tap();
  await expect(browser).toHaveURL(/\/meetings\/\d+/, slow);
  await expect(screen.getByText(resolutionName).first()).toBeVisible(slow);

  // The meeting is listed in /meetings and placed in the calendar month.
  await app.open('/meetings');
  await screen.getByRole('textbox', 'ابحث في العنوان أو المرجع أو المكان').fill(meetingName);
  await expect(screen.getByRole('link', meetingName)).toBeVisible(slow);
  await app.open('/meetings/calendar');
  await expect(screen.getByRole('link', new RegExp(meetingName)).first()).toBeVisible(slow);
});
