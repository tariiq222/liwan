import { test } from '@e2e-dev/web';
import { expect } from 'e2e';
import { api, ODOO_ONLY, signInAs, slow, type Json, type PageContext, type Stage } from '../scratch.ts';

/**
 * Support Desk journeys on the scratch Odoo stack (`npm run e2e:odoo`), covering the register rows
 * HD-10, HD-11, HD-20, HD-21, HD-22, HD-34 to HD-36, HD-42, HD-51, HD-52, HD-24, HD-30 to HD-33, HD-40, HD-41, HD-50, HD-60, HD-63, HD-70, HD-72 and HD-85 (e2e/scenarios/helpdesk.md).
 *
 * Personas come from tools/e2e_seed.py. No seeded account holds a desk role: each journey grants the built-in
 * role it needs to a seeded employee as `it_admin`, keeping that employee's existing assignments, and then
 * proves the grant from `/api/v1/me`. Every subject carries a timestamp because the database is reused.
 *
 * The write side of a ticket goes through the page's own session (`api()`), so it carries the signed-in persona's
 * cookie and the same routes the screens call; the read side is asserted through the rendered page. The create,
 * edit and settings forms are driven by their own journeys (HD-20, HD-33, and e2e/tests/helpdesk-settings.e2e.ts).
 */
const TICKETS = '/api/v1/helpdesk/tickets';
const EMPLOYEE = 'سارة العمري';
const MANAGER = 'أحمد السهلي';
const SUPERVISOR = 'ماجد الغامدي';
const NEW_STAGE = 'جديد';
const IN_PROGRESS_STAGE = 'قيد المعالجة';
const CLOSED_STAGE = 'مغلق';
const UNASSIGNED = 'غير مسندة';
const INTERNAL_BADGE = 'ملاحظة داخلية';
const LIST_HEADING = 'الدعم الفني';
const FORBIDDEN = 'لا تملك صلاحية فتح هذه الصفحة';
const DESK_KEYS = [
  'helpdesk.tickets.read', 'helpdesk.tickets.write', 'helpdesk.tickets.assign', 'helpdesk.tickets.close',
  'helpdesk.tickets.merge', 'helpdesk.requests.read', 'helpdesk.requests.create',
];

/** An API call that must succeed with 200; the body is the answer. */
async function ok(browser: PageContext, method: string, path: string, payload?: Json): Promise<Json> {
  const answer = await api(browser, method, path, payload);
  expect([method, path, answer.status, answer.body.message]).toEqual([method, path, 200, undefined]);
  return answer.body;
}

/** The signed-in identity: its user id, its capabilities and the company it works in. */
async function identity(browser: PageContext): Promise<{ id: number; companyId: number; capabilities: string[] }> {
  const body = await ok(browser, 'GET', '/api/v1/me');
  return {
    id: body.id as number,
    companyId: (body.company as Json).id as number,
    capabilities: body.capabilities as string[],
  };
}

function expectCapabilities(capabilities: string[], keys: string[]) {
  expect(keys.filter(key => !capabilities.includes(key))).toEqual([]);
}

/**
 * Grant one built-in role to the seeded LOGIN as the signed-in administrator, keeping every assignment it
 * already holds: a replace that dropped a business role would change the shared scratch database for later jobs.
 */
async function grantRole(browser: PageContext, login: string, roleKey: string) {
  const roles = await ok(browser, 'GET', '/api/v1/admin/roles?limit=200');
  const role = (roles.items as Json[]).find(item => item.key === roleKey);
  expect([roleKey, role !== undefined]).toEqual([roleKey, true]);
  const roleId = role!.id as number;
  const users = await ok(browser, 'GET', `/api/v1/admin/users?q=${encodeURIComponent(login)}`);
  const listed = (users.items as Json[]).filter(item => item.login === login);
  expect([login, listed.length]).toEqual([login, 1]);
  const user = await ok(browser, 'GET', `/api/v1/admin/users/${listed[0]!.id}`);
  const assignments = user.assignments as Json[];
  if (assignments.some(item => (item.role as Json).key === roleKey)) return;
  const companyId = (await identity(browser)).companyId;
  const scope = { kind: 'company', id: companyId };
  const kept = assignments.map(item => ({ role_id: (item.role as Json).id as number, scope }));
  await ok(browser, 'PATCH', `/api/v1/admin/users/${user.id}/access`, {
    assignments: [...kept, { role_id: roleId, scope }], expected_version: user.version,
  });
}

/**
 * A support request opened by the signed-in employee, with a unique subject.
 *
 * `assignee` is the caller when the caller is an agent (the service gives the ticket to whoever opened it with the
 * write right) and null for an employee opening their own request. The expectation is passed in, because which one
 * it depends on the account the journey signed in as, never on the subject. `null` asserts nothing about who takes
 * the ticket, for an account whose desk roles depend on the journeys that ran before.
 */
async function openRequest(
  browser: PageContext, subject: string, assignedToSelf: boolean | null, description = 'الجهاز لا يبدأ بعد التحديث الأخير.',
) {
  const created = await ok(browser, 'POST', TICKETS, { subject, description });
  const stage = created.stage as Json;
  const assignee = created.assignee as Json | null;
  // `null`: the account's desk roles depend on which journeys ran before, so who takes the ticket is not asserted.
  expect([created.subject, stage.closed, assignedToSelf === null ? null : assignee === null])
    .toEqual([subject, false, assignedToSelf === null ? null : !assignedToSelf]);
  // The stage a new ticket lands on is whatever the team's first open stage is, so it is read, never assumed:
  // the engine's shared stages are applicable to every team as well (register row HD-103).
  return { id: created.id as number, number: created.number as string, stage: stage.name as string };
}

/** The record page of TICKET, opened by its address, with its heading rendered. */
async function openRecord({ screen, browser }: Stage, id: number, subject: string) {
  await browser.goto(`/helpdesk/${id}`, { waitUntil: 'domcontentloaded' });
  await expect(screen.getByRole('heading', { level: 1 })).toContainText(subject, slow);
}

test('[HD-24] an employee opens a request and follows it without the desk’s agent controls', {
  tags: ['helpdesk'], timeout: 300_000, session: 'staff2', skip: ODOO_ONLY,
}, async ({ app, screen, browser }) => {
  const stamp = Date.now().toString(36);
  const subject = `طلب سارة ${stamp}`;
  const reply = `تحديث من مقدّمة الطلب ${stamp}`;

  await app.open('/helpdesk');
  await expect(screen.getByRole('heading', { level: 1, name: LIST_HEADING })).toBeVisible(slow);
  // The counters are an agent's view of the queue: the employee's list draws none (register row HD-72).
  await expect(screen.getByTestId('helpdesk-counters')).toHaveCount(0, slow);
  // The employee holds the two request keys through the base role and no desk key.
  const me = await identity(browser);
  expectCapabilities(me.capabilities, ['helpdesk.requests.read', 'helpdesk.requests.create']);
  expect(me.capabilities.filter(key => /^helpdesk\.(tickets|reports|settings)\./.test(key))).toEqual([]);

  // The request the panel's form would send: the server makes the employee the requester and assigns nobody, since
  // the employee holds no desk write right to take it.
  const request = await openRequest(browser, subject, false);
  const body = await ok(browser, 'GET', `${TICKETS}/${request.id}`);
  expect([(body.requester as Json).kind, (body.requester as Json).name, body.assignee, body.assigned_at])
    .toEqual(['employee', EMPLOYEE, null, null]);

  // The list: «الكل» and the search live in the address, and the search finds the employee's own request.
  await browser.reload();
  await screen.getByTestId('helpdesk-queue').getByRole('button', 'الكل').tap();
  await expect(browser).toHaveURL(/[?&]state=all/, slow);
  await screen.getByTestId('helpdesk-search').fill(stamp);
  await screen.getByTestId('helpdesk-search').press('Enter');
  await expect(browser).toHaveURL(new RegExp(`[?&]q=${stamp}`), slow);
  await expect(screen.getByTestId('helpdesk-ticket-link')).toHaveCount(1, slow);
  await screen.getByTestId('helpdesk-ticket-link').tap();

  // The record: the employee is the requester, nobody answers it yet, and no agent control is drawn.
  await expect(screen.getByRole('heading', { level: 1 })).toContainText(subject, slow);
  const details = screen.getByTestId('helpdesk-details');
  await expect(details).toContainText(EMPLOYEE, slow);
  await expect(details).toContainText(UNASSIGNED, slow);
  for (const control of ['helpdesk-stage-move', 'helpdesk-take', 'helpdesk-release', 'helpdesk-close',
    'helpdesk-reopen', 'helpdesk-edit', 'helpdesk-note', 'helpdesk-merge']) {
    await expect(screen.getByTestId(control)).toHaveCount(0, slow);
  }

  // The employee answers their own request: the composer has no internal-note switch and the reply stays.
  await expect(screen.getByTestId('helpdesk-comment')).toBeVisible(slow);
  await screen.getByTestId('helpdesk-comment').fill(reply);
  await screen.getByTestId('helpdesk-comment-send').tap();
  await expect(screen.getByTestId('helpdesk-thread')).toContainText(reply, slow);
  await browser.reload();
  await expect(screen.getByTestId('helpdesk-thread')).toContainText(reply, slow);

  // Only an agent writes an internal note; the requester is refused.
  const note = await api(browser, 'POST', `${TICKETS}/${request.id}/messages`, { body: 'ملاحظة داخلية', internal: true });
  expect([note.status, note.body.code]).toEqual([403, 'forbidden']);
});

test('[HD-30] a manager takes the request through assignment, stage, reply, note, closing and reopening', {
  tags: ['helpdesk'], timeout: 300_000, session: 'it_admin', skip: ODOO_ONLY,
}, async ({ app, screen, browser }) => {
  const stage = { app, screen, browser };
  const stamp = Date.now().toString(36);
  const subject = `تعذّر بدء الجهاز ${stamp}`;
  const reply = `وصلتنا التذكرة، نراجعها الآن ${stamp}`;
  const note = `الجهاز تحت الضمان حتى نهاية العام ${stamp}`;

  await app.open('/helpdesk');
  await expect(screen.getByRole('heading', { level: 1, name: LIST_HEADING })).toBeVisible(slow);
  await grantRole(browser, 'e2e_crm_manager', 'helpdesk_manager');
  // The request is the employee's, so the manager meets a ticket nobody answers yet.
  await signInAs('staff2', stage);
  const request = await openRequest(browser, subject, false);

  await signInAs('crm_manager', stage);
  expectCapabilities((await identity(browser)).capabilities, DESK_KEYS);

  // Nobody answers it: the record offers «إسنادها إليّ» and no assignee.
  await openRecord(stage, request.id, subject);
  await expect(screen.getByTestId('helpdesk-details')).toContainText(UNASSIGNED, slow);
  await expect(screen.getByTestId('helpdesk-take')).toBeVisible(slow);

  // The manager takes it, releases it, and takes it again; each write is the route the button calls.
  const me = await identity(browser);
  await ok(browser, 'POST', `${TICKETS}/${request.id}/assign`, { assignee_id: me.id });
  await browser.reload();
  await expect(screen.getByTestId('helpdesk-details')).toContainText(MANAGER, slow);
  await expect(screen.getByTestId('helpdesk-release')).toBeVisible(slow);
  await expect(screen.getByTestId('helpdesk-take')).toHaveCount(0, slow);
  await ok(browser, 'POST', `${TICKETS}/${request.id}/assign`, { assignee_id: null });
  await browser.reload();
  await expect(screen.getByTestId('helpdesk-details')).toContainText(UNASSIGNED, slow);
  await expect(screen.getByTestId('helpdesk-take')).toBeVisible(slow);
  await ok(browser, 'POST', `${TICKETS}/${request.id}/assign`, { assignee_id: me.id });

  // The stage moves to a stage of the ticket's team, and the select reads it after a reload. The reference lists
  // the tenant's own stages only (the engine's six are archived at install), found here by name.
  const reference = await ok(browser, 'GET', '/api/v1/helpdesk/reference');
  const stages = reference.stages as Json[];
  expect(stages.map(item => item.name)).toEqual(expect.arrayContaining([NEW_STAGE, IN_PROGRESS_STAGE, 'بانتظار العميل', CLOSED_STAGE]));
  expect((stages.find(item => item.name === CLOSED_STAGE) as Json).closed).toBe(true);
  const target = stages.find(item => item.name === IN_PROGRESS_STAGE)!;
  await ok(browser, 'POST', `${TICKETS}/${request.id}/stage`, { stage_id: target.id });
  await browser.reload();
  await expect(screen.getByTestId('helpdesk-stage-move')).toContainText(IN_PROGRESS_STAGE, slow);

  // A public reply sets the first response; an internal note stays in the team and is badged.
  await expect(screen.getByTestId('helpdesk-details')).toContainText('بانتظار أول ردّ', slow);
  await screen.getByTestId('helpdesk-comment').fill(reply);
  await screen.getByTestId('helpdesk-comment-send').tap();
  await expect(screen.getByTestId('helpdesk-thread')).toContainText(reply, slow);
  await screen.getByTestId('helpdesk-note').check();
  await screen.getByTestId('helpdesk-comment').fill(note);
  await screen.getByTestId('helpdesk-comment-send').tap();
  await expect(screen.getByTestId('helpdesk-thread')).toContainText(note, slow);
  await expect(screen.getByTestId('helpdesk-thread')).toContainText(INTERNAL_BADGE);
  await browser.reload();
  await expect(screen.getByTestId('helpdesk-details')).not.toContainText('بانتظار أول ردّ', slow);
  const messages = await ok(browser, 'GET', `${TICKETS}/${request.id}/messages`);
  const rows = messages.items as Json[];
  expect([rows.filter(row => row.internal === true).length, rows.filter(row => row.internal === false).length]).toEqual([1, 1]);

  // Closing takes the writing controls away and offers the way back.
  await ok(browser, 'POST', `${TICKETS}/${request.id}/close`, {});
  await browser.reload();
  await expect(screen.getByTestId('helpdesk-reopen')).toBeVisible(slow);
  await expect(screen.getByTestId('helpdesk-details')).toContainText('تاريخ الإغلاق', slow);
  await expect(screen.getByText(CLOSED_STAGE).first()).toBeVisible(slow);
  for (const control of ['helpdesk-stage-move', 'helpdesk-close', 'helpdesk-edit', 'helpdesk-merge']) {
    await expect(screen.getByTestId(control)).toHaveCount(0, slow);
  }

  // Reopening returns it to the ticket's first open stage, whatever that stage is named.
  await ok(browser, 'POST', `${TICKETS}/${request.id}/reopen`, {});
  await browser.reload();
  await expect(screen.getByTestId('helpdesk-stage-move')).toContainText(request.stage, slow);
  await expect(screen.getByTestId('helpdesk-close')).toBeVisible(slow);
  await expect(screen.getByTestId('helpdesk-reopen')).toHaveCount(0, slow);
});

test('[HD-50] a supervisor merges a duplicate, then reads the queue, the reports and the policy', {
  tags: ['helpdesk'], timeout: 600_000, session: 'it_admin', skip: ODOO_ONLY,
}, async ({ app, screen, browser }) => {
  const stage = { app, screen, browser };
  const stamp = Date.now().toString(36);
  const keptSubject = `الطابعة لا تطبع ${stamp}`;
  const duplicateSubject = `الطابعة متوقفة ${stamp}`;

  await app.open('/helpdesk');
  await expect(screen.getByRole('heading', { level: 1, name: LIST_HEADING })).toBeVisible(slow);
  await grantRole(browser, 'e2e_pm', 'helpdesk_supervisor');
  await signInAs('pm', stage);
  expectCapabilities((await identity(browser)).capabilities,
    [...DESK_KEYS, 'helpdesk.reports.read', 'helpdesk.settings.read']);

  // The supervisor opens both with the write right, so each becomes theirs: that is the desk's rule for an agent.
  const kept = await openRequest(browser, keptSubject, true);
  const duplicate = await openRequest(browser, duplicateSubject, true);

  // The merge closes the duplicate and leaves the merge note on the ticket that stays, and the duplicate is
  // closed, so it offers no merge section of its own.
  const merged = await ok(browser, 'POST', `${TICKETS}/${kept.id}/merge`, { source_ids: [duplicate.id] });
  expect((merged.stage as Json).closed).toBe(false);
  const closed = await ok(browser, 'GET', `${TICKETS}/${duplicate.id}`);
  expect([(closed.stage as Json).name, (closed.stage as Json).closed]).toEqual([CLOSED_STAGE, true]);
  const thread = await ok(browser, 'GET', `${TICKETS}/${kept.id}/messages`);
  expect((thread.items as Json[]).some(row => String(row.body).includes(duplicate.number))).toBe(true);

  await openRecord(stage, duplicate.id, duplicateSubject);
  await expect(screen.getByTestId('helpdesk-merge')).toHaveCount(0, slow);
  await expect(screen.getByTestId('helpdesk-reopen')).toBeVisible(slow);

  // The queue: «الكل» and the search live in the address, and Back returns to that same filtered list.
  await app.open('/helpdesk');
  await expect(screen.getByRole('heading', { level: 1, name: LIST_HEADING })).toBeVisible(slow);
  await screen.getByTestId('helpdesk-queue').getByRole('button', 'الكل').tap();
  await expect(browser).toHaveURL(/[?&]state=all/, slow);
  await screen.getByTestId('helpdesk-search').fill(stamp);
  await screen.getByTestId('helpdesk-search').press('Enter');
  await expect(browser).toHaveURL(new RegExp(`[?&]q=${stamp}`), slow);
  await expect(screen.getByTestId('helpdesk-ticket-link')).toHaveCount(2, slow);
  await screen.getByTestId('helpdesk-ticket-link').first().tap();
  await expect(screen.getByRole('heading', { level: 1 })).toContainText(stamp, slow);
  await browser.back();
  await expect(browser).toHaveURL(new RegExp(`/helpdesk\\?.*state=all`), slow);
  await expect(browser).toHaveURL(new RegExp(`[?&]q=${stamp}`), slow);
  await expect(screen.getByTestId('helpdesk-ticket-link')).toHaveCount(2, slow);

  // The reports: four figures, the agent load, the tickets by stage, and the period in the address.
  await app.open('/helpdesk/reports');
  await expect(screen.getByRole('heading', { level: 1, name: 'تقارير الدعم' })).toBeVisible(slow);
  await expect(screen.getByTestId('metric-tile')).toHaveCount(4, slow);
  await expect(screen.getByTestId('helpdesk-report-agents')).toBeVisible(slow);
  await expect(screen.getByTestId('helpdesk-report-stages')).toBeVisible(slow);
  await expect(screen.getByTestId('helpdesk-report-period')).toContainText('آخر ٣٠ يومًا', slow);
  await screen.getByTestId('helpdesk-report-period').tap();
  await screen.getByRole('option', 'آخر ٧ أيام').tap();
  await expect(browser).toHaveURL(/[?&]period=7/, slow);
  await expect(screen.getByTestId('helpdesk-report-period')).toContainText('آخر ٧ أيام', slow);

  // The policy page opens for the supervisor's read key: every card is drawn, and the policy card's fields are
  // closed to a reader. Register row HD-102 records that they are not, so the run asserts the badge instead of a
  // disabled control.
  await app.open('/settings/apps/helpdesk');
  await expect(screen.getByRole('heading', { level: 1 })).toBeVisible(slow);
  for (const card of ['helpdesk-settings-teams', 'helpdesk-settings-stages', 'helpdesk-settings-categories',
    'helpdesk-settings-tags', 'helpdesk-settings-channels', 'helpdesk-settings-types', 'helpdesk-settings-sla']) {
    await expect(screen.getByTestId(card)).toBeVisible(slow);
  }
  await expect(screen.getByText('عرض فقط').first()).toBeVisible(slow);
  // Each section draws its own heading (they lost it once, when the cards were built on the wrong box: a plain
  // sub-card drops the title and the actions slot, so the page showed four unlabelled blocks).
  for (const heading of ['فرق الدعم', 'المراحل', 'اتفاقيات مستوى الخدمة']) {
    await expect(screen.getByRole('heading', { name: heading }).first()).toBeVisible(slow);
  }
  // A reader adds nothing: the buttons exist for a manager and stay absent here.
  await expect(screen.getByTestId('helpdesk-team-add')).toHaveCount(0, slow);
  await expect(screen.getByTestId('helpdesk-stage-add')).toHaveCount(0, slow);
  await expect(screen.getByTestId('helpdesk-sla-add')).toHaveCount(0, slow);
});

test('[HD-85] an agent without the settings key cannot open the policy page', {
  tags: ['helpdesk'], timeout: 300_000, session: 'it_admin', skip: ODOO_ONLY,
}, async ({ app, screen, browser }) => {
  await app.open('/helpdesk');
  await expect(screen.getByRole('heading', { level: 1, name: LIST_HEADING })).toBeVisible(slow);
  await grantRole(browser, 'e2e_staff1', 'helpdesk_agent');
  await signInAs('staff1', { app, screen, browser });

  // The agent reads tickets but not the settings: the page is closed and both routes answer 403.
  const me = await identity(browser);
  expectCapabilities(me.capabilities, ['helpdesk.tickets.read', 'helpdesk.tickets.write']);
  expect(me.capabilities.filter(key => key.startsWith('helpdesk.settings.'))).toEqual([]);
  await browser.goto('/settings/apps/helpdesk', { waitUntil: 'domcontentloaded' });
  await expect(screen.getByRole('heading', { name: FORBIDDEN })).toBeVisible(slow);
  for (const path of ['/api/v1/helpdesk/settings', '/api/v1/helpdesk/settings/resources', '/api/v1/helpdesk/sla']) {
    const refused = await api(browser, 'GET', path);
    expect([path, refused.status, refused.body.code]).toEqual([path, 403, 'forbidden']);
  }
});

test('[HD-20] an employee opens a request from the panel, and the form offers no customer', {
  tags: ['helpdesk'], timeout: 300_000, session: 'staff2', skip: ODOO_ONLY,
}, async ({ app, screen, browser }) => {
  const stamp = Date.now().toString(36);
  const subject = `طلب من اللوحة ${stamp}`;
  const description = `الشاشة لا تستجيب بعد التحديث ${stamp}`;

  await app.open('/helpdesk');
  await expect(screen.getByRole('heading', { level: 1, name: LIST_HEADING })).toBeVisible(slow);
  await screen.getByTestId('helpdesk-new').tap();
  await expect(browser).toHaveURL(/\/helpdesk\/new/, slow);
  await expect(screen.getByTestId('helpdesk-form')).toBeVisible(slow);
  // Only an agent names a customer: the employee's form has no picker, the requester is the employee (register row HD-11).
  await expect(screen.getByTestId('customer-picker')).toHaveCount(0, slow);

  await screen.getByTestId('helpdesk-subject').fill(subject);
  await screen.getByTestId('helpdesk-description').fill(description);
  await screen.getByTestId('helpdesk-save').tap();

  await expect(browser).toHaveURL(/\/helpdesk\/\d+(\?|$)/, slow);
  await expect(screen.getByRole('heading', { level: 1 })).toContainText(subject, slow);
  const details = screen.getByTestId('helpdesk-details');
  await expect(details).toContainText(EMPLOYEE, slow);
  await expect(details).toContainText(UNASSIGNED, slow);

  // The record the panel saved is the employee's own request, found by its subject, on the first open stage.
  const listed = await ok(browser, 'GET', `${TICKETS}?q=${encodeURIComponent(stamp)}`);
  const row = (listed.items as Json[]).find(item => item.subject === subject) as Json;
  expect([row !== undefined, (row.requester as Json).kind, row.assignee, (row.stage as Json).name])
    .toEqual([true, 'employee', null, NEW_STAGE]);
});

test('[HD-33] an agent edits a ticket from its edit page', {
  tags: ['helpdesk'], timeout: 300_000, session: 'it_admin', skip: ODOO_ONLY,
}, async ({ app, screen, browser }) => {
  const stage = { app, screen, browser };
  const stamp = Date.now().toString(36);
  const subject = `طابعة الطابق الثاني ${stamp}`;
  const renamed = `طابعة الطابق الثالث ${stamp}`;
  await app.open('/helpdesk');
  await expect(screen.getByRole('heading', { level: 1, name: LIST_HEADING })).toBeVisible(slow);
  await grantRole(browser, 'e2e_staff1', 'helpdesk_agent');
  await signInAs('staff1', stage);
  expectCapabilities((await identity(browser)).capabilities, ['helpdesk.tickets.read', 'helpdesk.tickets.write']);

  const created = await ok(browser, 'POST', TICKETS, { subject, description: 'تتعطل عند الطباعة.', priority: 'low' });
  await browser.goto(`/helpdesk/${created.id}/edit`, { waitUntil: 'domcontentloaded' });
  await expect(screen.getByTestId('helpdesk-form')).toBeVisible(slow);
  await expect(screen.getByTestId('helpdesk-subject')).toHaveValue(subject, slow);

  await screen.getByTestId('helpdesk-subject').fill(renamed);
  await screen.getByTestId('helpdesk-priority-select').tap();
  await screen.getByRole('option', 'عالية').tap();
  await screen.getByTestId('helpdesk-save').tap();

  // The page returns to the record, which shows the saved subject and priority.
  await expect(browser).toHaveURL(new RegExp(`/helpdesk/${created.id}(\\?|$)`), slow);
  await expect(screen.getByRole('heading', { level: 1 })).toContainText(renamed, slow);
  const saved = await ok(browser, 'GET', `${TICKETS}/${created.id}`);
  expect([saved.subject, saved.priority]).toEqual([renamed, 'high']);
});

test('[HD-72] an agent reads the queue counters above the list and follows two of them', {
  tags: ['helpdesk'], timeout: 300_000, session: 'it_admin', skip: ODOO_ONLY,
}, async ({ app, screen, browser }) => {
  const stage = { app, screen, browser };
  await app.open('/helpdesk');
  await expect(screen.getByRole('heading', { level: 1, name: LIST_HEADING })).toBeVisible(slow);
  await grantRole(browser, 'e2e_staff1', 'helpdesk_agent');
  await signInAs('staff1', stage);
  // The agent opens a ticket, which the desk assigns to them: it is open and theirs.
  await ok(browser, 'POST', TICKETS, { subject: `عدّاد ${Date.now().toString(36)}`, description: 'للتحقق من أرقام الطابور.' });
  const figures = await ok(browser, 'GET', '/api/v1/helpdesk/summary');
  expect(figures.mine as number).toBeGreaterThan(0);

  await app.open('/helpdesk');
  const counters = screen.getByTestId('helpdesk-counters');
  await expect(counters.getByTestId('metric-tile')).toHaveCount(4, slow);
  await expect(counters).toContainText(String(figures.open), slow);
  for (const label of ['مفتوحة', 'غير مسندة', 'مسندة إليّ', 'متأخرة عن المهلة']) {
    await expect(counters).toContainText(label, slow);
  }
  // Two of the figures are links into the list, already filtered.
  await counters.getByRole('link', `مسندة إليّ: ${figures.mine}`).tap();
  await expect(browser).toHaveURL(/[?&]assignee=me/, slow);
  await expect(screen.getByTestId('helpdesk-ticket-link').first()).toBeVisible(slow);
});

test('[HD-10] an agent opens a ticket for a customer from the panel', {
  tags: ['helpdesk'], timeout: 300_000, session: 'it_admin', skip: ODOO_ONLY,
}, async ({ app, screen, browser }) => {
  const stage = { app, screen, browser };
  const stamp = Date.now().toString(36);
  const customerName = `عميل الدعم ${stamp}`;
  const subject = `طلب عميل ${stamp}`;
  await app.open('/helpdesk');
  await expect(screen.getByRole('heading', { level: 1, name: LIST_HEADING })).toBeVisible(slow);
  // The seed holds no customer: the administrator, who manages them, adds the one this journey picks.
  const added = await api(browser, 'POST', '/api/v1/customers', { name: customerName });
  expect([added.status, added.body.message]).toEqual([201, undefined]);
  const customer = added.body;
  await grantRole(browser, 'e2e_crm_manager', 'helpdesk_manager');
  await signInAs('crm_manager', stage);
  expectCapabilities((await identity(browser)).capabilities, DESK_KEYS);

  // The panel opens over the list from a direct link and after a refresh.
  await browser.goto('/helpdesk/new', { waitUntil: 'domcontentloaded' });
  await expect(screen.getByTestId('helpdesk-form')).toBeVisible(slow);
  await browser.reload();
  await expect(screen.getByTestId('helpdesk-form')).toBeVisible(slow);

  await screen.getByTestId('helpdesk-subject').fill(subject);
  await screen.getByTestId('helpdesk-description').fill('الاتصال بالخدمة ينقطع كل ساعة.');
  await screen.getByTestId('customer-picker-search').fill(stamp);
  await screen.getByTestId(`customer-picker-option-${customer.id}`).tap();
  await screen.getByTestId('helpdesk-save').tap();

  await expect(browser).toHaveURL(/\/helpdesk\/\d+(\?|$)/, slow);
  await expect(screen.getByRole('heading', { level: 1 })).toContainText(subject, slow);
  const details = screen.getByTestId('helpdesk-details');
  await expect(details).toContainText(customerName, slow);
  await expect(details).toContainText(MANAGER, slow);

  const listed = await ok(browser, 'GET', `${TICKETS}?q=${encodeURIComponent(stamp)}`);
  const row = (listed.items as Json[]).find(item => item.subject === subject) as Json;
  expect([row !== undefined, (row.requester as Json).kind, (row.requester as Json).name, (row.assignee as Json).name])
    .toEqual([true, 'customer', customerName, MANAGER]);
});

/** An API call that must be refused: its status, its code and the field it names (or null). */
async function refused(browser: PageContext, method: string, path: string, payload?: Json) {
  const answer = await api(browser, method, path, payload);
  return [answer.status, answer.body.code, answer.body.field ?? null, answer.body.message];
}

test('[HD-22] an employee reads no request but their own', {
  tags: ['helpdesk'], timeout: 300_000, session: 'staff2', skip: ODOO_ONLY,
}, async ({ app, screen, browser }) => {
  const stage = { app, screen, browser };
  const stamp = Date.now().toString(36);
  const foreign = `طلب يوسف ${stamp}`;
  await signInAs('staff1', stage);
  const other = await openRequest(browser, foreign, null);

  await signInAs('staff2', stage);
  const mine = await openRequest(browser, `طلب سارة ${stamp}`, false);
  // Another employee's ticket is not found, as if it did not exist, and no list or search brings it back.
  expect((await refused(browser, 'GET', `${TICKETS}/${other.id}`)).slice(0, 2)).toEqual([404, 'not_found']);
  expect((await refused(browser, 'GET', `${TICKETS}/${other.id}/messages`)).slice(0, 2)).toEqual([404, 'not_found']);
  const listed = await ok(browser, 'GET', `${TICKETS}?state=all&limit=100`);
  const rows = listed.items as Json[];
  expect(rows.some(row => row.id === mine.id)).toBe(true);
  expect(rows.some(row => row.id === other.id)).toBe(false);
  expect(rows.every(row => (row.requester as Json).name === EMPLOYEE)).toBe(true);
  await app.open('/helpdesk');
  await expect(screen.getByRole('heading', { level: 1, name: LIST_HEADING })).toBeVisible(slow);
  await expect(screen.getByText(foreign)).toHaveCount(0, slow);
});

test('[HD-36] the desk refuses a foreign stage, a stranger as assignee, a bad reply, a merge into a closed ticket and a team move', {
  tags: ['helpdesk'], timeout: 600_000, session: 'it_admin', skip: ODOO_ONLY,
}, async ({ app, screen, browser }) => {
  const stage = { app, screen, browser };
  const stamp = Date.now().toString(36);
  await app.open('/helpdesk');
  await expect(screen.getByRole('heading', { level: 1, name: LIST_HEADING })).toBeVisible(slow);
  await grantRole(browser, 'e2e_crm_manager', 'helpdesk_manager');
  await grantRole(browser, 'e2e_staff1', 'helpdesk_agent');

  await signInAs('crm_manager', stage);
  const reference = await ok(browser, 'GET', '/api/v1/helpdesk/reference');
  const home = (reference.teams as Json[])[0]!;
  const side = await ok(browser, 'POST', '/api/v1/helpdesk/settings/teams', { name: `فريق الحدود ${stamp}` });
  const sideStage = await ok(browser, 'POST', '/api/v1/helpdesk/settings/stages', { name: `مرحلة الحدود ${stamp}`, team_ids: [side.id] });
  const first = await openRequest(browser, `تذكرة الحدود ${stamp}`, true);
  const second = await openRequest(browser, `تذكرة أخرى ${stamp}`, true);

  // HD-36: a stage another team owns is not a stage of this ticket.
  expect((await refused(browser, 'POST', `${TICKETS}/${first.id}/stage`, { stage_id: sideStage.id })).slice(0, 4))
    .toEqual([422, 'invalid', 'stage_id', 'the stage does not belong to the ticket team']);
  // HD-35: an assignee has to be an internal user of the company.
  expect((await refused(browser, 'POST', `${TICKETS}/${first.id}/assign`, { assignee_id: 999999999 })).slice(0, 4))
    .toEqual([422, 'invalid', 'assignee_id', 'the assignee is not an internal user of the company']);
  // HD-42: an empty reply, a reply over 5000 characters and an internal flag that is no boolean.
  const reply = `${TICKETS}/${first.id}/messages`;
  expect((await refused(browser, 'POST', reply, { body: '   ' })).slice(0, 3)).toEqual([422, 'invalid', 'body']);
  expect((await refused(browser, 'POST', reply, { body: 'ا'.repeat(5001) })).slice(0, 3)).toEqual([422, 'invalid', 'body']);
  expect((await refused(browser, 'POST', reply, { body: 'رد', internal: 'yes' })).slice(0, 2)).toEqual([422, 'invalid']);
  // HD-52: a merge names tickets the caller reaches, and at least one.
  const merge = `${TICKETS}/${first.id}/merge`;
  expect((await refused(browser, 'POST', merge, { source_ids: [999999999] })).slice(0, 3)).toEqual([422, 'invalid', 'source_ids']);
  expect((await refused(browser, 'POST', merge, { source_ids: [] })).slice(0, 3)).toEqual([422, 'invalid', 'source_ids']);
  // HD-51: a closed ticket absorbs nobody.
  await ok(browser, 'POST', `${TICKETS}/${second.id}/close`, {});
  expect((await refused(browser, 'POST', `${TICKETS}/${second.id}/merge`, { source_ids: [first.id] })).slice(0, 4))
    .toEqual([409, 'conflict', null, 'a closed ticket cannot absorb others']);

  // HD-34: a manager moves a ticket to another team and back; a write-only agent is refused.
  await ok(browser, 'PATCH', `${TICKETS}/${first.id}`, { team_id: side.id });
  expect(((await ok(browser, 'GET', `${TICKETS}/${first.id}`)).team as Json).id).toBe(side.id);
  await ok(browser, 'PATCH', `${TICKETS}/${first.id}`, { team_id: home.id });
  await signInAs('staff1', stage);
  const own = await openRequest(browser, `تذكرة الوكيل ${stamp}`, true);
  expect((await refused(browser, 'PATCH', `${TICKETS}/${own.id}`, { team_id: side.id })).slice(0, 2)).toEqual([403, 'forbidden']);

  // Put the settings back: the side team and its stage are archived, with no open ticket left on them.
  await signInAs('crm_manager', stage);
  await ok(browser, 'POST', '/api/v1/helpdesk/settings/stages', { id: sideStage.id, name: sideStage.name, active: false });
  await ok(browser, 'POST', '/api/v1/helpdesk/settings/teams', { id: side.id, name: side.name, active: false });
});
