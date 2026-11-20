import { test } from '@e2e-dev/web';
import { expect } from 'e2e';
import { api, ODOO_ONLY, personId, signInAs, slow, type Json, type PageContext, type Stage } from '../scratch.ts';

/**
 * The Helpdesk bridges on the scratch Odoo stack (`npm run e2e:odoo`), covering the register rows HD-95, HD-96,
 * CRM-153 and INB-284: the conversation card that lists and raises tickets (`liwan_helpdesk_inbox`) and the ticket
 * page card that links an opportunity (`liwan_helpdesk_crm`).
 *
 * Personas come from tools/e2e_seed.py. `inbox_crm_agent` holds the inbox and CRM agent roles; each journey grants
 * it the built-in `helpdesk_agent` role as `it_admin`, keeping its other assignments. Every name carries a
 * timestamp because the database is reused. Opportunities are created through the API as the persona that owns them.
 */
const TICKETS = '/api/v1/helpdesk/tickets';
const AGENT_LOGIN = 'e2e_inbox_crm_agent';
const CONVERSATION_CONTACT = 'سارة الحربي';
const OTHER_AGENT = 'مها الثبيتي';

async function ok(browser: PageContext, method: string, path: string, payload?: Json): Promise<Json> {
  const answer = await api(browser, method, path, payload);
  expect([method, path, answer.status, answer.body.message]).toEqual([method, path, 200, undefined]);
  return answer.body;
}

/** Grant one built-in role to LOGIN as the signed-in administrator, keeping every assignment it already holds. */
async function grantRole(browser: PageContext, login: string, roleKey: string) {
  const roles = await ok(browser, 'GET', '/api/v1/admin/roles?limit=200');
  const role = (roles.items as Json[]).find(item => item.key === roleKey);
  expect([roleKey, role !== undefined]).toEqual([roleKey, true]);
  const users = await ok(browser, 'GET', `/api/v1/admin/users?q=${encodeURIComponent(login)}`);
  const listed = (users.items as Json[]).filter(item => item.login === login);
  expect([login, listed.length]).toEqual([login, 1]);
  const user = await ok(browser, 'GET', `/api/v1/admin/users/${listed[0]!.id}`);
  const assignments = user.assignments as Json[];
  if (assignments.some(item => (item.role as Json).key === roleKey)) return;
  const me = await ok(browser, 'GET', '/api/v1/me');
  const scope = { kind: 'company', id: (me.company as Json).id as number };
  const kept = assignments.map(item => ({ role_id: (item.role as Json).id as number, scope }));
  await ok(browser, 'PATCH', `/api/v1/admin/users/${user.id}/access`, {
    assignments: [...kept, { role_id: role!.id as number, scope }], expected_version: user.version,
  });
}

/** Sign in as the bridge agent after granting it the desk role. */
async function agentWithDesk(stage: Stage, roleKey = 'helpdesk_agent') {
  await signInAs('it_admin', stage);
  await grantRole(stage.browser, AGENT_LOGIN, roleKey);
  await signInAs('inbox_crm_agent', stage);
}

async function closeTicket(browser: PageContext, id: number) {
  await ok(browser, 'POST', `${TICKETS}/${id}/close`, {});
}

/** An opportunity created through the API as the signed-in persona; the phone is unique per call. */
async function createOpportunity(browser: PageContext, name: string, userId?: number): Promise<number> {
  const phone = `+96655${Math.floor(1_000_000 + Math.random() * 8_999_999)}`;
  const body = await ok(browser, 'POST', '/api/v1/crm/opportunities', {
    contact_name: name, phone, ...(userId ? { user_id: userId } : {}),
  });
  return body.id as number;
}

test('[HD-95] [INB-284] an agent raises tickets from a conversation, one open at a time', {
  tags: ['helpdesk', 'inbox'], timeout: 600_000, session: 'it_admin', skip: ODOO_ONLY,
}, async ({ app, screen, browser }) => {
  const stage = { app, screen, browser };
  const stamp = Date.now().toString(36);
  const first = `جهاز العميل لا يعمل ${stamp}`;
  const second = `طلب صيانة ثانٍ ${stamp}`;
  // Closing a ticket is a desk-manager right, so this journey's persona holds that role.
  await agentWithDesk(stage, 'helpdesk_manager');

  await app.open('/inbox');
  const found = await ok(browser, 'GET', `/api/v1/inbox/conversations?q=${encodeURIComponent(CONVERSATION_CONTACT)}`);
  const conversation = String((found.items as Json[])[0]!.id);
  const listUrl = `/api/v1/inbox/conversations/${conversation}/tickets`;

  // The database is reused: a ticket left open by an earlier run is closed first.
  for (const ticket of (await ok(browser, 'GET', listUrl)).items as Json[]) {
    if (!(ticket.stage as Json).closed) await closeTicket(browser, ticket.id as number);
  }
  const before = (await ok(browser, 'GET', listUrl)).total as number;
  await app.open(`/inbox/${conversation}/info`);
  const card = screen.getByTestId('inbox-tickets');
  await expect(card).toBeVisible(slow);

  // Raise the first ticket from the card: it shows in the list and the raise button steps aside.
  await screen.getByTestId('inbox-tickets-raise').tap();
  await screen.getByTestId('inbox-tickets-subject').fill(first);
  await screen.getByTestId('inbox-tickets-confirm').tap();
  await expect(screen.getByTestId('inbox-tickets-list')).toContainText(first, slow);
  await expect(screen.getByTestId('inbox-tickets-raise')).toHaveCount(0, slow);

  // A second attempt while one is open is refused by the server and names no ticket.
  const again = await api(browser, 'POST', listUrl, { subject: second });
  expect([again.status, again.body.code, (again.body.details as Json).reason]).toEqual([409, 'conflict', 'open_ticket_exists']);

  // After closing it a new one is raised, and the card lists both.
  const opened = ((await ok(browser, 'GET', listUrl)).items as Json[]).find(item => item.subject === first)!;
  await closeTicket(browser, opened.id as number);
  await browser.reload();
  await screen.getByTestId('inbox-tickets-raise').tap();
  await screen.getByTestId('inbox-tickets-subject').fill(second);
  await screen.getByTestId('inbox-tickets-confirm').tap();
  await expect(screen.getByTestId('inbox-tickets-list')).toContainText(second, slow);
  await expect(screen.getByTestId('inbox-tickets-list')).toContainText(first, slow);
  expect(((await ok(browser, 'GET', listUrl)).total as number)).toBe(before + 2);
});

test('[HD-96] [CRM-153] an agent links, replaces and unlinks a ticket opportunity the CRM lets them see', {
  tags: ['helpdesk', 'crm'], timeout: 600_000, session: 'it_admin', skip: ODOO_ONLY,
}, async ({ app, screen, browser }) => {
  const stage = { app, screen, browser };
  const stamp = Date.now().toString(36);
  const hiddenName = `فرصة مخفية ${stamp}`;
  const firstName = `فرصة أولى ${stamp}`;
  const secondName = `فرصة ثانية ${stamp}`;
  const subject = `تذكرة ما بعد البيع ${stamp}`;

  // The opportunity of another agent: the desk agent's CRM visibility (own) never shows it.
  await signInAs('crm_manager', stage);
  const otherAgent = await personId(browser, OTHER_AGENT);
  const hiddenId = await createOpportunity(browser, hiddenName, otherAgent);

  await agentWithDesk(stage);
  const firstId = await createOpportunity(browser, firstName);
  const secondId = await createOpportunity(browser, secondName);
  const ticket = await ok(browser, 'POST', TICKETS, { subject, description: 'يحتاج العميل إلى متابعة.' });
  const url = `${TICKETS}/${ticket.id}/opportunity`;
  expect(await ok(browser, 'GET', url)).toEqual({ opportunity: null, hidden: false });

  await app.open(`/helpdesk/${ticket.id}`);
  const card = screen.getByTestId('helpdesk-opportunity');
  await expect(card).toBeVisible(slow);
  await expect(screen.getByTestId('helpdesk-opportunity-none')).toBeVisible(slow);

  // A hidden opportunity is not offered by the picker and is refused by the server without naming it.
  await screen.getByTestId('helpdesk-opportunity-link').tap();
  await screen.getByTestId('helpdesk-opportunity-pick-search').fill(stamp);
  await expect(screen.getByTestId(`helpdesk-opportunity-pick-option-${firstId}`)).toBeVisible(slow);
  await expect(screen.getByTestId(`helpdesk-opportunity-pick-option-${secondId}`)).toBeVisible(slow);
  await expect(screen.getByTestId(`helpdesk-opportunity-pick-option-${hiddenId}`)).toHaveCount(0);
  const refused = await api(browser, 'PUT', url, { opportunity_id: hiddenId });
  expect([refused.status, refused.body.code]).toEqual([404, 'not_found']);
  expect(JSON.stringify(refused.body)).not.toContain(hiddenName);

  // Link the first one: the card names it and links to it. The agent needs no write on the opportunity.
  await screen.getByTestId(`helpdesk-opportunity-pick-option-${firstId}`).tap();
  await screen.getByTestId('helpdesk-opportunity-confirm').tap();
  await expect(screen.getByTestId('helpdesk-opportunity-linked')).toContainText(firstName, slow);
  expect(((await ok(browser, 'GET', url)).opportunity as Json).id).toBe(firstId);

  // Replace it with the second one.
  await screen.getByTestId('helpdesk-opportunity-link').tap();
  await screen.getByTestId('helpdesk-opportunity-pick-search').fill(stamp);
  await screen.getByTestId(`helpdesk-opportunity-pick-option-${secondId}`).tap();
  await screen.getByTestId('helpdesk-opportunity-confirm').tap();
  await expect(screen.getByTestId('helpdesk-opportunity-linked')).toContainText(secondName, slow);
  expect(((await ok(browser, 'GET', url)).opportunity as Json).id).toBe(secondId);

  // The manager hands the linked opportunity to another agent: the ticket keeps the link, the page never names it,
  // and the agent can still unlink it.
  await signInAs('crm_manager', stage);
  await ok(browser, 'POST', `/api/v1/crm/opportunities/${secondId}/assign`, { user_id: otherAgent });
  await signInAs('inbox_crm_agent', stage);
  expect(await ok(browser, 'GET', url)).toEqual({ opportunity: null, hidden: true });
  await app.open(`/helpdesk/${ticket.id}`);
  await expect(screen.getByTestId('helpdesk-opportunity-hidden')).toBeVisible(slow);
  await expect(card).not.toContainText(secondName);
  await screen.getByTestId('helpdesk-opportunity-unlink').tap();
  await expect(screen.getByTestId('helpdesk-opportunity-none')).toBeVisible(slow);
  expect(await ok(browser, 'GET', url)).toEqual({ opportunity: null, hidden: false });
});
