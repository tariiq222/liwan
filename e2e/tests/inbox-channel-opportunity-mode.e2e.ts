import { spawnSync } from 'node:child_process';
import { join } from 'node:path';
import { test } from '@e2e-dev/web';
import { expect } from 'e2e';
import { api, ODOO_ONLY, slow, type Json, type PageContext } from '../scratch.ts';

/**
 * The channel setting that opens opportunities from new conversations (register rows CRM-150, CRM-151 and
 * CRM-152) against the scratch Odoo stack (`npm run e2e:odoo`). The WhatsApp channel comes from tools/e2e_seed.py.
 * The stack runs no cron, so the inbound step stores one delivery and runs the events cron through
 * `odoo-bin shell` on the same scratch database, exactly what the cron does on a real tenant. Each run uses a
 * fresh phone number, because the database is reused between runs.
 */
const CHANNEL_NAME = 'واتساب الاختبار';
const CARD = 'inbox-channel-opportunity-mode';
const MANUAL = 'يدويًا';
const AUTO = 'تلقائيًا عند أول رسالة';
const SAVED = 'حُفظ وضع إنشاء الفرصة';
const ODOO_ROOT = process.env.E2E_ODOO_ROOT ?? '/Users/tariq/code/odoo';
const SHELL_SCRIPT = `
import json, os, time
spec = json.loads(os.environ['E2E_INBOUND'])
company = env['liwan.tenant.profile'].search([], limit=1).root_company_id
channel = env['liwan.inbox.channel'].browse(spec['channel'])
owner = env['res.users'].search([('login', '=', 'e2e_inbox_crm_agent')], limit=1)
phone = '+' + spec['wa_id']
seeded = env['crm.lead']
if spec['lead']:
    seeded = env['crm.lead'].create({
        'name': 'فرصة الاختبار ' + phone, 'contact_name': 'عميل الاختبار', 'phone': phone, 'type': 'opportunity',
        'stage_id': env['crm.lead']._liwan_first_stage().id, 'company_id': company.id, 'user_id': owner.id,
    })
    if spec['lead'] == 'lost':
        seeded.action_set_lost()
message_id = 'wamid.E2E' + spec['wa_id']
raw = json.dumps({'object': 'whatsapp_business_account', 'entry': [{'id': '1', 'changes': [{'field': 'messages', 'value': {
    'messaging_product': 'whatsapp', 'metadata': {'phone_number_id': channel.phone_number_id, 'display_phone_number': '966'},
    'contacts': [{'wa_id': spec['wa_id'], 'profile': {'name': 'عميل الاختبار'}}],
    'messages': [{'id': message_id, 'from': spec['wa_id'], 'timestamp': str(int(time.time())), 'type': 'text', 'text': {'body': 'مرحبا'}}],
}}]}]}).encode()
event = env['liwan.inbox.event']._liwan_store(channel, raw)
env['liwan.inbox.event']._liwan_run_events()
env.cr.commit()
conversation = env['liwan.inbox.message'].search([('provider_message_id', '=', message_id)]).conversation_id
print('RESULT:' + json.dumps({'event': event.state, 'conversation': conversation.id, 'lead': conversation.lead_id.id, 'seeded': seeded.id}))
`;

type Delivery = { event: string; conversation: number; lead: number; seeded: number };

/** One inbound customer message from a fresh phone, processed the way the events cron does; LEAD is the opportunity the phone already holds first. */
function deliver(channel: number, lead: 'open' | 'lost' | null): Delivery {
  const waId = `96650${String(Date.now()).slice(-7)}`;
  const root = process.cwd();
  const result = spawnSync(join(ODOO_ROOT, '.venv', 'bin', 'python'), [
    join(ODOO_ROOT, 'odoo-bin'), 'shell', '-c', join(root, '.e2e', 'odoo', 'odoo.conf'), '-d', 'liwan_scratch_e2e', '--no-http',
  ], {
    cwd: root, input: SHELL_SCRIPT, encoding: 'utf8', timeout: 240_000,
    env: {
      ...process.env, PYTHONDONTWRITEBYTECODE: '1', LIWAN_COMMERCIAL_CONFIG: join(root, '.e2e', 'odoo', 'classification.json'),
      E2E_INBOUND: JSON.stringify({ channel, wa_id: waId, lead }),
    },
  });
  const line = `${result.stdout}`.split('\n').find(row => row.startsWith('RESULT:'));
  expect([result.status, line === undefined ? `${result.stderr}`.slice(-600) : 'RESULT']).toEqual([0, 'RESULT']);
  return JSON.parse(line!.slice('RESULT:'.length)) as Delivery;
}

async function channelId(browser: PageContext): Promise<number> {
  const answer = await api(browser, 'GET', '/api/v1/inbox/channels');
  const found = (answer.body.items as { id: number; name: string }[]).find(channel => channel.name === CHANNEL_NAME);
  expect(found, `channel ${CHANNEL_NAME}`).toBeTruthy();
  return found!.id;
}

async function setMode(browser: PageContext, channel: number, mode: 'manual' | 'auto_first_message'): Promise<void> {
  const answer = await api(browser, 'PATCH', `/api/v1/inbox/channels/${channel}/crm-settings`, { opportunity_mode: mode });
  expect([answer.status, answer.body.opportunity_mode]).toEqual([200, mode]);
}

test('[CRM-150] a channel set to automatic opens an opportunity from a new customer\'s first message', {
  tags: ['journey', 'inbox', 'crm'], timeout: 600_000, session: 'inbox_crm_admin', skip: ODOO_ONLY,
}, async ({ app, screen, browser }) => {
  await app.open('/inbox');
  const channel = await channelId(browser);
  await setMode(browser, channel, 'manual');

  // The card offers both modes and starts on the manual one.
  await app.open(`/settings/apps/inbox/channels/${channel}`);
  await expect(screen.getByTestId(CARD)).toContainText('إنشاء الفرصة من المحادثة الجديدة', slow);
  await expect(screen.getByTestId(CARD)).toContainText(MANUAL, slow);
  await expect(screen.getByTestId(CARD)).toContainText(AUTO, slow);

  // Choosing the automatic mode saves at once.
  await screen.getByText(AUTO).tap();
  await expect(screen.getByText(SAVED)).toBeVisible(slow);
  const saved = await api(browser, 'GET', `/api/v1/inbox/channels/${channel}/crm-settings`);
  expect([saved.status, saved.body.opportunity_mode]).toEqual([200, 'auto_first_message']);

  // A new customer's first message now opens a conversation that is already linked to an opportunity from WhatsApp.
  const delivery = deliver(channel, null);
  expect([delivery.event, delivery.lead > 0]).toEqual(['done', true]);
  const linked = await api(browser, 'GET', `/api/v1/inbox/conversations/${delivery.conversation}/opportunity`);
  expect(linked.body.id).toBe(delivery.lead);
  const opportunity = await api(browser, 'GET', `/api/v1/crm/opportunities/${delivery.lead}`);
  expect((opportunity.body.source as { name?: string } | null)?.name).toContain('واتساب');
  await app.open(`/inbox/${delivery.conversation}/info`);
  await expect(screen.getByTestId('inbox-opportunity-linked')).toBeVisible(slow);

  await setMode(browser, channel, 'manual');
});

test('[CRM-151] automatic mode links the open opportunity of the phone and opens a new one after a lost one', {
  tags: ['journey', 'inbox', 'crm'], timeout: 600_000, session: 'inbox_crm_admin', skip: ODOO_ONLY,
}, async ({ app, browser }) => {
  await app.open('/inbox');
  const channel = await channelId(browser);
  await setMode(browser, channel, 'auto_first_message');

  // The phone already holds an open opportunity: the conversation links to it and no second one exists.
  const open = deliver(channel, 'open');
  expect(open.lead).toBe(open.seeded);
  const openList = await api(browser, 'GET', `/api/v1/crm/opportunities/${open.seeded}/conversations`);
  expect(((openList.body.items as Json[]) ?? []).map(item => item.id)).toContain(open.conversation);

  // The phone holds only a lost opportunity: a new one is created and the lost one stays lost.
  const lost = deliver(channel, 'lost');
  expect([lost.lead > 0, lost.lead === lost.seeded]).toEqual([true, false]);
  const lostList = await api(browser, 'GET', `/api/v1/crm/opportunities/${lost.seeded}/conversations`);
  expect(lostList.body.total).toBe(0);
  const fresh = await api(browser, 'GET', `/api/v1/crm/opportunities/${lost.lead}/conversations`);
  expect(((fresh.body.items as Json[]) ?? []).map(item => item.id)).toContain(lost.conversation);

  await setMode(browser, channel, 'manual');
});

test('[CRM-152] without the CRM settings right the card is hidden and the route answers forbidden', {
  tags: ['journey', 'inbox', 'crm'], timeout: 300_000, session: 'inbox_manager', skip: ODOO_ONLY,
}, async ({ app, screen, browser }) => {
  await app.open('/inbox');
  const channel = await channelId(browser);
  await app.open(`/settings/apps/inbox/channels/${channel}`);
  await expect(screen.getByText(CHANNEL_NAME).first()).toBeVisible(slow);
  await expect(screen.getByTestId(CARD)).toHaveCount(0, slow);

  const read = await api(browser, 'GET', `/api/v1/inbox/channels/${channel}/crm-settings`);
  expect([read.status, read.body.code]).toEqual([403, 'forbidden']);
  const write = await api(browser, 'PATCH', `/api/v1/inbox/channels/${channel}/crm-settings`, { opportunity_mode: 'auto_first_message' });
  expect(write.status).toBe(403);
  // The feature-off answer (403 feature_not_included with CRM switched off) is covered by liwan_crm_inbox/tests/test_channel_opportunity_mode.py.
});
