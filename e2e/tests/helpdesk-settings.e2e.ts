import { test } from '@e2e-dev/web';
import { expect } from 'e2e';
import { api, ODOO_ONLY, personId, signInAs, slow, type Json, type PageContext, type Stage } from '../scratch.ts';

/**
 * Support Desk settings journeys on the scratch Odoo stack (`npm run e2e:odoo`), covering the register rows
 * HD-80, HD-82, HD-83, HD-84 and HD-102 (e2e/scenarios/helpdesk.md).
 *
 * The settings page is the one place a tenant shapes the desk, so every journey here writes real records and
 * puts them back: the settings row returns to the values it had, and every team, stage, category and service
 * level the journey creates is archived before it ends. The database is reused between runs, so no row asserts
 * a count or a stage name it did not read first.
 *
 * Personas come from tools/e2e_seed.py: no seeded account holds a desk role, so each journey grants the built-in
 * role it needs to a seeded employee as `it_admin`, keeping that employee's existing assignments.
 */
const SETTINGS = '/api/v1/helpdesk/settings';
const RESOURCES = '/api/v1/helpdesk/settings/resources';
const SLA = '/api/v1/helpdesk/sla';
const POLICY_HEADING = 'الدعم الفني';
const STALE = 'the Support Desk settings changed; reload before saving';
const VIEW_ONLY = 'عرض فقط';
const ARCHIVED = 'مؤرشف';
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

/** The signed-in identity: its user id, its company and its capabilities. */
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

/** The manager's session: the register's «مدير الدعم الفني» persona, which holds all ten desk keys. */
async function signInAsManager(stage: Stage) {
  await signInAs('it_admin', stage);
  await grantRole(stage.browser, 'e2e_crm_manager', 'helpdesk_manager');
  await signInAs('crm_manager', stage);
  expectCapabilities((await identity(stage.browser)).capabilities, [...DESK_KEYS, 'helpdesk.reports.read', 'helpdesk.settings.read']);
}

/** The settings page of the working company, opened and read. */
async function openSettings({ app, screen }: Stage) {
  await app.open('/settings/apps/helpdesk');
  await expect(screen.getByRole('heading', { level: 1, name: POLICY_HEADING })).toBeVisible(slow);
  await expect(screen.getByTestId('helpdesk-settings-prefix')).toBeVisible(slow);
}

/** One team, stage, category or service level created by a journey, so the journey archives it again. */
async function archiveKind(browser: PageContext, kind: string, id: number, name: string, extra: Json = {}) {
  await ok(browser, 'POST', `/api/v1/helpdesk/settings/${kind}`, { id, name, ...extra, active: false });
}

test('[HD-80] the policy card saves the desk policy and a stale revision is refused', {
  tags: ['helpdesk'], timeout: 300_000, session: 'it_admin', skip: ODOO_ONLY,
}, async ({ app, screen, browser }) => {
  const stage = { app, screen, browser };
  const stamp = Date.now().toString(36);
  const prefix = `HD${stamp.slice(-2).toUpperCase()}`;
  await signInAsManager(stage);

  const original = await ok(browser, 'GET', SETTINGS);
  await openSettings(stage);
  // The card reads the values the route answered, and its fields carry the current policy.
  await expect(screen.getByTestId('helpdesk-settings-prefix')).toHaveValue(original.reference_prefix as string, slow);
  await expect(screen.getByTestId('helpdesk-settings-reopen')).toHaveValue(String(original.reopen_days), slow);

  // Saving is the page's one bar: a card of a settings page has no footer of its own.
  await screen.getByTestId('helpdesk-settings-prefix').fill(prefix);
  await expect(screen.getByTestId('settings-save-bar')).toBeVisible(slow);
  await screen.getByTestId('settings-save-bar-save').tap();
  await expect(screen.getByTestId('settings-save-bar')).toHaveCount(0, slow);

  // The write landed with the revision the screen read, and the page reads it back.
  const saved = await ok(browser, 'GET', SETTINGS);
  expect([saved.reference_prefix, (saved.revision as number) > (original.revision as number)]).toEqual([prefix, true]);
  await browser.reload();
  await expect(screen.getByTestId('helpdesk-settings-prefix')).toHaveValue(prefix, slow);

  // A screen that kept the old revision cannot overwrite the change.
  const stale = await api(browser, 'PATCH', SETTINGS, {
    revision: original.revision, reference_prefix: `${prefix}X`,
  });
  expect([stale.status, stale.body.code, stale.body.message]).toEqual([409, 'conflict', STALE]);
  const unchanged = await ok(browser, 'GET', SETTINGS);
  expect(unchanged.reference_prefix).toBe(prefix);

  // Put the policy back, so the reused scratch database is unchanged for the next journey.
  await ok(browser, 'PATCH', SETTINGS, {
    revision: unchanged.revision,
    reference_prefix: original.reference_prefix,
    reopen_days: original.reopen_days,
    first_response_hours: original.first_response_hours,
    resolution_hours: original.resolution_hours,
    visibility: original.visibility,
    default_priority: original.default_priority,
    portal_enabled: original.portal_enabled,
    auto_close_days: original.auto_close_days,
  });
  expect((await ok(browser, 'GET', SETTINGS)).reference_prefix).toBe(original.reference_prefix);
});

test('[HD-82] a new team is saved with its members and the default team cannot be archived', {
  tags: ['helpdesk'], timeout: 300_000, session: 'it_admin', skip: ODOO_ONLY,
}, async ({ app, screen, browser }) => {
  const stage = { app, screen, browser };
  const stamp = Date.now().toString(36);
  const name = `فريق المساء ${stamp}`;
  await signInAsManager(stage);
  await openSettings(stage);

  // «فريق جديد» saves the team whole; the leader picker only offers the members it already holds.
  await screen.getByTestId('helpdesk-team-add').tap();
  await expect(screen.getByTestId('helpdesk-team-form')).toBeVisible(slow);
  await screen.getByTestId('helpdesk-team-name').fill(name);
  await screen.getByTestId('helpdesk-team-save').tap();
  // The name also fills the default-team choice of the policy card, so the row is asked inside the teams card.
  await expect(screen.getByTestId('helpdesk-settings-teams').getByText(name)).toBeVisible(slow);

  const saved = await ok(browser, 'GET', RESOURCES);
  const team = (saved.teams as Json[]).find(row => row.name === name);
  expect([name, team !== undefined]).toEqual([name, true]);
  const teamId = team!.id as number;
  // The team reaches the reference lists at once, so the ticket form and its filter offer it.
  const reference = await ok(browser, 'GET', '/api/v1/helpdesk/reference');
  expect((reference.teams as Json[]).some(row => row.id === teamId)).toBe(true);

  // The server holds the guards the picker cannot express: a leader outside the team, and the default team.
  const member = await personId(browser, 'يوسف المالكي');
  const outsider = await personId(browser, 'سارة العمري');
  const refused = await api(browser, 'POST', '/api/v1/helpdesk/settings/teams', {
    id: teamId, name, member_ids: [member], leader_id: outsider,
  });
  expect([refused.status, refused.body.message, refused.body.field])
    .toEqual([422, 'the leader must be a member of the team', 'leader_id']);
  const defaultTeamId = (await ok(browser, 'GET', SETTINGS)).default_team_id as number;
  const defaults = await ok(browser, 'GET', RESOURCES);
  const defaultName = ((defaults.teams as Json[]).find(row => row.id === defaultTeamId) as Json).name as string;
  const kept = await api(browser, 'POST', '/api/v1/helpdesk/settings/teams', {
    id: defaultTeamId, name: defaultName, active: false,
  });
  expect([kept.status, kept.body.message])
    .toEqual([422, 'the default team cannot be archived; choose another default first']);

  // Archiving a team that holds no open ticket is the switch on its row.
  await screen.getByTestId(`helpdesk-team-${teamId}`).getByRole('switch').tap();
  await expect(screen.getByTestId(`helpdesk-team-${teamId}`)).toContainText(ARCHIVED, slow);
  const archived = await ok(browser, 'GET', RESOURCES);
  expect(((archived.teams as Json[]).find(row => row.id === teamId) as Json).active).toBe(false);
  await archiveKind(browser, 'teams', teamId, name);
});

test('[HD-83] a stage and the value lists are saved, and a category refuses a cycle', {
  tags: ['helpdesk'], timeout: 300_000, session: 'it_admin', skip: ODOO_ONLY,
}, async ({ app, screen, browser }) => {
  const stage = { app, screen, browser };
  const stamp = Date.now().toString(36);
  const stageName = `مرحلة الفرز ${stamp}`;
  const parentName = `تصنيف أب ${stamp}`;
  const childName = `تصنيف ابن ${stamp}`;
  const tagName = `وسم الهاتف ${stamp}`;
  await signInAsManager(stage);
  await openSettings(stage);

  // «مرحلة جديدة» saves the name, the order and the flags; a stage no ticket holds is archived again on its row.
  await screen.getByTestId('helpdesk-stage-add').tap();
  await expect(screen.getByTestId('helpdesk-stage-form')).toBeVisible(slow);
  await screen.getByTestId('helpdesk-stage-name').fill(stageName);
  await screen.getByTestId('helpdesk-stage-save').tap();
  await expect(screen.getByText(stageName)).toBeVisible(slow);
  const resources = await ok(browser, 'GET', RESOURCES);
  const created = (resources.stages as Json[]).find(row => row.name === stageName);
  expect([stageName, created !== undefined, created!.closed]).toEqual([stageName, true, false]);
  const stageId = created!.id as number;
  const reference = await ok(browser, 'GET', '/api/v1/helpdesk/reference');
  expect((reference.stages as Json[]).some(row => row.id === stageId)).toBe(true);

  // A tag is added in the SharedSettingsList footer and reaches the reference the ticket form reads.
  await screen.getByTestId('helpdesk-tags-name').fill(tagName);
  await screen.getByTestId('helpdesk-settings-tags').getByRole('button', { name: 'إضافة' }).tap();
  await expect(screen.getByTestId('helpdesk-tags-name')).toHaveValue('', slow);
  const tagged = await ok(browser, 'GET', RESOURCES);
  const tag = (tagged.tags as Json[]).find(row => row.name === tagName);
  expect([tagName, tag !== undefined]).toEqual([tagName, true]);
  await expect(screen.getByTestId(`helpdesk-tags-${tag!.id as number}`).getByRole('textbox')).toHaveValue(tagName, slow);

  // Categories keep a tree: a parent cannot move under its own child.
  const parent = await ok(browser, 'POST', '/api/v1/helpdesk/settings/categories', { name: parentName });
  const child = await ok(browser, 'POST', '/api/v1/helpdesk/settings/categories', {
    name: childName, parent_id: parent.id,
  });
  const cycle = await api(browser, 'POST', '/api/v1/helpdesk/settings/categories', {
    id: parent.id, name: parentName, parent_id: child.id,
  });
  expect([cycle.status, cycle.body.message]).toEqual([422, 'a category cannot move under its own child']);

  // Every record the journey made is archived again.
  await screen.getByTestId(`helpdesk-stage-${stageId}`).getByRole('switch').tap();
  await expect(screen.getByTestId(`helpdesk-stage-${stageId}`)).toContainText(ARCHIVED, slow);
  await archiveKind(browser, 'categories', child.id as number, childName);
  await archiveKind(browser, 'categories', parent.id as number, parentName);
  await archiveKind(browser, 'tags', tag!.id as number, tagName);
  await archiveKind(browser, 'stages', stageId, stageName);
});

test('[HD-84] a service level is saved with its target and archived from its row', {
  tags: ['helpdesk'], timeout: 300_000, session: 'it_admin', skip: ODOO_ONLY,
}, async ({ app, screen, browser }) => {
  const stage = { app, screen, browser };
  const stamp = Date.now().toString(36);
  const name = `اتفاقية الفروع ${stamp}`;
  await signInAsManager(stage);
  await openSettings(stage);

  // «اتفاقية جديدة» saves a name, a target of whole days and hours and the stage it aims at; the form starts at a
  // valid target (0 days, 4 hours) and the first open stage, so the name is all a journey must type.
  await screen.getByTestId('helpdesk-sla-add').tap();
  await expect(screen.getByTestId('helpdesk-sla-form')).toBeVisible(slow);
  await screen.getByTestId('helpdesk-sla-name').fill(name);
  await screen.getByTestId('helpdesk-sla-save').tap();
  await expect(screen.getByText(name)).toBeVisible(slow);

  const list = await ok(browser, 'GET', SLA);
  const policy = (list.items as Json[]).find(row => row.name === name);
  expect([name, policy !== undefined, policy!.active, policy!.team_ids]).toEqual([name, true, true, []]);
  const row = screen.getByTestId(`helpdesk-sla-${policy!.id as number}`);
  await expect(row).toContainText('حتى', slow);
  await expect(row).toContainText('ساعة', slow);
  // With no team named the policy covers every team, which the row says.
  await expect(row).toContainText('كل الفرق', slow);

  // Archiving is the switch on the row, and the deadlines it gave stop counting.
  await row.getByRole('switch').tap();
  await expect(row).toContainText(ARCHIVED, slow);
  const archived = await ok(browser, 'GET', SLA);
  expect(((archived.items as Json[]).find(item => item.id === policy!.id) as Json).active).toBe(false);
});

test('[HD-102] a supervisor with the read key meets a closed policy card', {
  tags: ['helpdesk'], timeout: 300_000, session: 'it_admin', skip: ODOO_ONLY,
}, async ({ app, screen, browser }) => {
  const stage = { app, screen, browser };
  await signInAs('it_admin', stage);
  await grantRole(browser, 'e2e_pm', 'helpdesk_supervisor');
  await signInAs('pm', stage);

  // The supervisor reads the policy and shapes nothing: the card is marked, and every control is closed.
  const me = await identity(browser);
  expectCapabilities(me.capabilities, ['helpdesk.settings.read']);
  expect(me.capabilities).not.toContain('helpdesk.settings.manage');
  await openSettings(stage);
  await expect(screen.getByText(VIEW_ONLY).first()).toBeVisible(slow);
  // The visibility field is named with a sentence, not with the object of its three options (register row HD-101).
  await expect(screen.getByText('من يرى التذاكر')).toBeVisible(slow);
  for (const control of ['helpdesk-settings-prefix', 'helpdesk-settings-reopen', 'helpdesk-settings-first-response',
    'helpdesk-settings-resolution', 'helpdesk-settings-auto-close']) {
    await expect(screen.getByTestId(control)).toBeDisabled(slow);
  }
  // A manager's add buttons and value-list add form are not drawn for a reader either.
  for (const control of ['helpdesk-team-add', 'helpdesk-stage-add', 'helpdesk-sla-add', 'helpdesk-tags-name']) {
    await expect(screen.getByTestId(control)).toHaveCount(0, slow);
  }
});

