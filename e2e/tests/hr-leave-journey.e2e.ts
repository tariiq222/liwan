import { test } from '@e2e-dev/web';
import { credentials, expect } from 'e2e';

/**
 * HR leave journey against the scratch Odoo stack (`npm run e2e:odoo`): an
 * employee requests one day of leave through the create panel, an HR manager
 * approves it from the pending queue, and the employee sees it approved.
 * Arabic UI, exact steps only. The two sides are separate saved sessions
 * (`e2e/tests/bugs/auth.setup.e2e.ts`, accounts from `tools/e2e_seed.py`);
 * data carries a timestamp so reruns on the reused database do not collide,
 * and stale pending requests are refused right after sign-in.
 */
const slow = { timeout: 30_000 };

/** The free working day's accessible label ("الاثنين، 2 نوفمبر 2026"), never today. */
function leaveDay(): { from: Date; label: string } {
  const day = new Date();
  day.setDate(day.getDate() + 7);
  while (day.getDay() === 5 || day.getDay() === 6) day.setDate(day.getDate() + 1);
  const weekday = new Intl.DateTimeFormat('ar', { weekday: 'long' }).format(day);
  const month = new Intl.DateTimeFormat('ar', { month: 'long' }).format(day);
  return { from: day, label: `${weekday}، ${day.getDate()} ${month} ${day.getFullYear()}` };
}

test(
  'employee requests leave and the manager approves it',
  { session: 'employee', tags: ['journey', 'hr', 'hr-leave'] },
  async ({ app, browser, screen }) => {
    test.skip(process.env.E2E_STACK !== 'odoo', 'needs the scratch Odoo stack (npm run e2e:odoo)');
    const { label } = leaveDay();

    // The create panel opens over the list from its own route.
    await app.open('/account/leave');
    await expect(screen.getByRole('heading', { level: 1, name: 'إجازاتي' }), slow).toBeVisible();
    await screen.getByTestId('hr-leave-new').tap();
    await expect(browser).toHaveURL(/\/account\/leave\/new(?:\?|$)/, slow);

    // Type, then one day: the shared date field opens the calendar from its button.
    await screen.getByTestId('hr-leave-type').tap();
    await screen.getByRole('option').first().tap();
    await screen.getByTestId('hr-leave-from').tap();
    await screen.getByRole('button', label).tap();
    await screen.getByTestId('hr-leave-submit').tap();

    // Saving returns to the list, where the new request waits for approval.
    await expect(browser).toHaveURL(/\/account\/leave(?:\?|$)/, slow);
    await expect(screen.getByText('بانتظار الاعتماد').first(), slow).toBeVisible();
  },
);

test(
  'HR manager approves a pending leave request',
  { session: 'admin', tags: ['journey', 'hr', 'hr-leave'] },
  async ({ app, screen }) => {
    test.skip(process.env.E2E_STACK !== 'odoo', 'needs the scratch Odoo stack (npm run e2e:odoo)');

    // The manager's queue lists every employee's pending request; the seeded
    // employee's request is the one to approve.
    await app.open('/hr/leave?scope=pending');
    await expect(screen.getByRole('heading', { level: 1, name: 'الإجازات' }), slow).toBeVisible();
    const row = screen.getByRole('row').filter({ hasText: 'E2E Employee' }).first();
    await expect(row, slow).toBeVisible();
    await row.getByTestId('row-actions-menu').tap();
    await screen.getByRole('menuitem', 'اعتماد').tap();

    // An approval is not destructive: no confirmation step, the badge flips.
    await expect(row.getByText('معتمدة'), slow).toBeVisible();
    await row.getByRole('link').first().tap();
    await expect(screen.getByText('معتمدة').first(), slow).toBeVisible();
  },
);
