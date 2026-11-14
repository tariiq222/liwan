import { test } from '@e2e-dev/web';
import { expect } from 'e2e';

/**
 * Role matrix against the scratch Odoo stack (`npm run e2e:odoo`): every demo-company
 * persona (tools/e2e_seed.py) signs in, the sidebar and the all-applications page offer
 * only destinations its roles open, and each page below either opens or shows the
 * forbidden page. Scenarios ACC-01, ACC-02, ACC-14, FIN-21, HR-41, PMO-03, MTG-02,
 * OPS-11, OPS-20, OPS-22, DOC-14 (e2e/scenarios). Read-only: nothing is created.
 */
const slow = { timeout: 30_000 };
const FORBIDDEN = 'لا تملك صلاحية فتح هذه الصفحة';

// The sidebar's core row (owner decision 2026-11-08): «يومي» and the base applications every
// internal user reaches, by rail id. A link's name grows a count while it has a badge, so the
// row is read by its test ids.
const CORE_APPS = ['home', 'tasks', 'meetings', 'chat'];
// An application outside the core row is pinned or not per person, so the sidebar cannot
// vouch for it; «كل التطبيقات» (/apps) lists every application the identity may open.
const COMMON_APPLICATION = 'المشاريع';

type Links = { all(): Promise<{ getAttribute(name: string): Promise<string | null> }[]> };
/** The destinations a set of links points at; read before navigating, while the links are still on screen. */
async function hrefsOf(links: Links): Promise<string[]> {
  const hrefs = await Promise.all((await links.all()).map(link => link.getAttribute('href')));
  return hrefs.filter((href): href is string => !!href);
}

// Page -> the rule that opens it, copied from each manifest's `routeCapabilities` and
// `settings.parts`. A rule is a capability, an "any of" set, a "all of" set, or a feature.
// The test asks the identity for those keys instead of holding a list of personas, so a role
// change updates the answer without editing this table.
type PageRule = { path: string; capability?: string; any?: string[]; required?: string[]; feature?: string };

const PAGES: PageRule[] = [
  { path: '/finance', capability: 'finance.invoices.read' },
  { path: '/finance/sales/invoices', capability: 'finance.invoices.read' },
  { path: '/finance/budgets', capability: 'finance.budgets.read' },
  // A settings page opens for anyone who may see ONE of its cards (accessPolicy
  // settingsCardsOpeningPage), never for one named capability.
  { path: '/settings/apps/finance', any: ['finance.accounts.read', 'finance.journals.read', 'finance.taxes.read', 'finance.setup.read', 'finance.payment_terms.read'] },
  { path: '/hr/payroll', capability: 'hr.payroll.read' },
  // A leave reader opens the HR leave list and the API scopes its rows (route gate since 2026-11-14).
  { path: '/hr/leave', capability: 'hr.leave.read' },
  { path: '/hr/employees/new', capability: 'hr.employees.manage' },
  { path: '/hr/recruitment', capability: 'hr.recruitment.read' },
  { path: '/hr/assets', capability: 'hr.assets.read' },
  { path: '/settings/apps/hr', any: ['hr.departments.manage', 'hr.leave.config', 'hr.recruitment.manage', 'hr.shifts.manage', 'hr.onboarding.manage', 'hr.offboarding.manage', 'hr.assets.manage', 'hr.warnings.manage', 'hr.insurance.manage', 'hr.payroll.manage'] },
  { path: '/settings/team/users', capability: 'access.users.read' },
  { path: '/settings/team/roles', capability: 'access.roles.read' },
  { path: '/settings/apps/projects', capability: 'pmo.settings.manage' },
  { path: '/projects/new', capability: 'pmo.projects.create' },
  { path: '/meetings/new', capability: 'meetings.create' },
  { path: '/settings/apps/operations/processes', capability: 'operations.processes.manage' },
  // The pending list needs the read capability only; the review ACTION is gated separately
  // by operations.requests.review (OPS-11), never the list itself.
  { path: '/operations/pending', capability: 'operations.requests.read' },
  { path: '/operations/monitoring', capability: 'operations.monitoring.read' },
  // A document is HR's: the page also needs the employee read and the HR application open.
  { path: '/documents/new', capability: 'documents.items.manage', required: ['hr.employees.read'], feature: 'hr.enabled' },
];

const PERSONAS = ['ceo', 'it_admin', 'hr_manager', 'payroll', 'cfo', 'accountant',
  'auditor', 'pm', 'ops_manager', 'staff1', 'staff2'];

for (const key of PERSONAS) {
  // The session comes from e2e/tests/personas.setup.e2e.ts: one sign-in per persona per run.
  // The stack restriction is a declaration option, not a body call: a body-level test.skip runs
  // after the session's setup runs, so on the mock stack the setup would fail against the mock's
  // admin/admin login instead of reporting these Odoo-only tests as skipped.
  test(`[ACC-01] ${key} sees its applications and only its pages`, {
    tags: ['access', 'personas'],
    timeout: 600_000,
    session: key,
    skip: process.env.E2E_STACK !== 'odoo' ? 'needs the scratch Odoo stack (npm run e2e:odoo)' : false,
  }, async ({ app, screen, browser }) => {
    // A restored session leaves no page open, so the first navigation happens here.
    await app.open('/');
    await expect(browser).toHaveURL(/localhost:\d+\/$/, slow);

    // The identity the page renders with; the page table below is judged against it.
    const me = await (await fetch(new URL('/api/v1/me', app.baseUrl), {
      headers: { cookie: (await browser.cookies()).map(c => `${c.name}=${c.value}`).join('; ') },
    })).json() as { capabilities?: string[]; platform?: { readable_features?: string[] } };
    const capabilities = new Set(me.capabilities ?? []);
    const features = new Set(me.platform?.readable_features ?? []);

    const sidebar = screen.getByTestId('application-navigation');
    for (const id of CORE_APPS) {
      await expect(sidebar.getByTestId(`core-app-${id}`)).toBeVisible(slow);
    }
    const offered = new Set(await hrefsOf(sidebar.getByRole('link')));

    await browser.goto('/apps', { waitUntil: 'domcontentloaded' });
    const applications = screen.getByTestId('apps-page');
    await expect(applications.getByRole('heading', COMMON_APPLICATION)).toBeVisible(slow);
    for (const href of await hrefsOf(applications.getByTestId('launcher-open'))) offered.add(href);

    // Neither surface offers a destination the identity cannot open: every link they draw must
    // load without the forbidden state. This is the property that matters (no over-exposure)
    // and it needs no hand-kept table, so a role, pin or order change cannot falsify it.
    for (const href of offered) {
      await browser.goto(href, { waitUntil: 'domcontentloaded' });
      await expect(screen.getByRole('main')).toBeVisible(slow);
      await expect(screen.getByText(FORBIDDEN)).toHaveCount(0, slow);
    }

    for (const rule of PAGES) {
      // A guarded page answers by redirecting while the document loads, which the engine
      // reports as ERR_ABORTED even though the app settled. Open it and wait for the document.
      await browser.goto(rule.path, { waitUntil: 'domcontentloaded' });
      await expect(screen.getByRole('main')).toBeVisible(slow);
      const allowed = (!rule.capability || capabilities.has(rule.capability))
        && (!rule.any || rule.any.some(capability => capabilities.has(capability)))
        && (!rule.required || rule.required.every(capability => capabilities.has(capability)))
        && (!rule.feature || features.has(rule.feature));
      if (allowed) {
        await expect(screen.getByText(FORBIDDEN)).toHaveCount(0, slow);
      } else {
        await expect(screen.getByText(FORBIDDEN)).toBeVisible(slow);
      }
    }
  });
}
