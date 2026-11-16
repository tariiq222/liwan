import { test } from '@e2e-dev/web';
import { expect } from 'e2e';
import { api, ODOO_ONLY, signInAs, slow, type Json, type PageContext, type Stage } from '../scratch.ts';

/**
 * Support Desk journeys on the scratch Odoo stack (`npm run e2e:odoo`), covering the register rows
 * HD-24, HD-30, HD-50 and HD-60 (e2e/scenarios/helpdesk.md).
 *
 * Personas come from tools/e2e_seed.py. No seeded account holds a desk role: each journey grants the built-in
 * role it needs to a seeded employee as `it_admin`, keeping that employee's existing assignments, and then
 * proves the grant from `/api/v1/me`. Every subject carries a timestamp because the database is reused.
 *
 * Every write goes through the page's own session (`api()`), so it carries the signed-in persona's cookie and
 * the same routes the screens call. The screens' create, edit, assignment, stage, close, reopen and merge
 * buttons cannot be used today: the composable parses those answers with a strict schema that requires
 * `attachments`, while the serializer omits them (register row HD-100). The journeys therefore assert the read
 * side through the rendered page, and the write side through the route the page would call. The reply and the
 * internal note are the exception: their mutation re-reads the ticket, so the composer works and is used.
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
 * it is depends on the account the journey signed in as, never on the subject.
 */
async function openRequest(
  browser: PageContext, subject: string, assignedToSelf: boolean, description = 'الجهاز لا يبدأ بعد التحديث الأخير.',
) {
  const created = await ok(browser, 'POST', TICKETS, { subject, description });
  const stage = created.stage as Json;
  const assignee = created.assignee as Json | null;
  expect([created.subject, stage.closed, assignee === null]).toEqual([subject, false, !assignedToSelf]);
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
  // every stage of the company plus the engine's own six (which the starter team does not name), so the four this
  // application seeds are found by name. Only their own closed stage is told apart here: the engine adds three more
  // closed ones (Done, Cancelled, Rejected) as shared records.
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
