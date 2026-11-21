import { test } from '@e2e-dev/web';
import { expect } from 'e2e';
import { api, ODOO_ONLY, slow } from '../scratch.ts';

/**
 * Conversation to opportunity (register rows CRM-140 and CRM-141) against the scratch Odoo stack (`npm run e2e:odoo`).
 * The WhatsApp channel, its two conversations and the opportunity of the second contact's phone come from
 * tools/e2e_seed.py; the persona `inbox_crm_agent` holds both the inbox and the CRM capabilities. Exact steps only.
 * The first test creates the opportunity of the first conversation once; a re-run on a reused database finds it linked.
 */
test('[CRM-140] an agent creates an opportunity from a conversation and both sides link to each other', {
  tags: ['journey', 'inbox', 'crm'], timeout: 300_000, session: 'inbox_crm_agent', skip: ODOO_ONLY,
}, async ({ app, screen, browser }) => {
  await app.open('/inbox');
  await screen.getByRole('link', /سارة الحربي/).first().tap();
  await expect(browser).toHaveURL(/\/inbox\/\d+/, slow);
  const conversation = (await browser.url()).match(/\/inbox\/(\d+)/)![1];

  // The opportunity card sits in the contact panel; not linked yet, so create from the conversation.
  await screen.getByTestId('inbox-info-toggle').tap();
  await expect(browser).toHaveURL(/\/inbox\/\d+\/info/, slow);
  const linked = screen.getByTestId('inbox-opportunity-linked');
  const existing = await api(browser, 'GET', `/api/v1/inbox/conversations/${conversation}/opportunity`);
  if (!existing.body?.opportunity?.id) {
    await expect(screen.getByTestId('inbox-opportunity-none')).toBeVisible(slow);
    await screen.getByTestId('inbox-opportunity-create').tap();
  }
  await expect(linked).toContainText('سارة الحربي', slow);

  // The conversation side names the opportunity; follow it to the opportunity page.
  await linked.getByRole('link').first().tap();
  await expect(browser).toHaveURL(/\/crm\/opportunities\/\d+/, slow);
  const opportunity = (await browser.url()).match(/\/crm\/opportunities\/(\d+)/)![1];

  // The opportunity carries the channel source and the conversation it came from.
  await expect(screen.getByText('واتساب').first()).toBeVisible(slow);
  const answer = await api(browser, 'GET', `/api/v1/crm/opportunities/${opportunity}`);
  expect((answer.body.source as { name?: string } | null)?.name).toContain('واتساب');
  await expect(screen.getByTestId('crm-conversation-list')).toContainText('سارة الحربي', slow);

  // And the conversation link leads back to the same thread.
  await screen.getByTestId('crm-conversation-list').getByRole('link').first().tap();
  await expect(browser).toHaveURL(new RegExp(`/inbox/${conversation}`), slow);
});

test('[CRM-141] a duplicate phone number opens the picker instead of creating a second opportunity', {
  tags: ['journey', 'inbox', 'crm'], timeout: 300_000, session: 'inbox_crm_agent', skip: ODOO_ONLY,
}, async ({ app, screen, browser }) => {
  await app.open('/inbox');
  const before = (await api(browser, 'GET', '/api/v1/crm/opportunities?limit=1')).body.total as number;
  await screen.getByRole('link', /ماجد الفهد/).first().tap();
  await expect(browser).toHaveURL(/\/inbox\/\d+/, slow);
  const conversation = (await browser.url()).match(/\/inbox\/(\d+)/)![1];
  // The database is reused between runs: a link made by an earlier run is removed first (unlinking answers 204 either way).
  expect((await api(browser, 'DELETE', `/api/v1/inbox/conversations/${conversation}/opportunity`)).status).toBe(204);
  await app.open(`/inbox/${conversation}/info`);
  await expect(screen.getByTestId('inbox-opportunity-none')).toBeVisible(slow);

  // The phone is held by an opportunity: no second one is created, the picker opens with the existing one.
  await screen.getByTestId('inbox-opportunity-create').tap();
  await expect(screen.getByTestId('inbox-opportunity-picker')).toBeVisible(slow);
  await expect(screen.getByTestId('inbox-opportunity-picker')).toContainText('ماجد الفهد', slow);
  expect((await api(browser, 'GET', '/api/v1/crm/opportunities?limit=1')).body.total).toBe(before);

  // Linking the existing opportunity shows it on the card.
  await browser.locator('[data-testid^="inbox-opportunity-pick-option-"]').first().tap();
  await screen.getByTestId('inbox-opportunity-confirm').tap();
  await expect(screen.getByTestId('inbox-opportunity-linked')).toContainText('ماجد الفهد', slow);
});
