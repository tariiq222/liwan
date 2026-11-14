import { test, type Browser as WebBrowser } from '@e2e-dev/web';
import { expect } from 'e2e';
import { api, ODOO_ONLY, signInAs, slow, type Answer, type Json, type PageContext, type Stage } from '../scratch.ts';

/**
 * Operations register rows against the scratch Odoo stack (`npm run e2e:odoo`).
 * Scenarios OPS-55, OPS-71, OPS-86, OPS-131, OPS-165 and OPS-202 (e2e/scenarios/operations.md).
 * Personas come from tools/e2e_seed.py; every process and request name carries a timestamp because the
 * database is reused between runs. API calls go through the signed-in page, so they carry the persona's
 * session cookie; only the two simultaneous decisions of OPS-131 are sent from the test process, each with
 * the cookies of its own signed-in persona, because one page holds one session.
 */
const PROCESSES = '/api/v1/operations/processes';
const REQUESTS = '/api/v1/operations/requests';
const PROCESS_PAGES = '/settings/apps/operations/processes';
const PM_NAME = 'ماجد الغامدي';
const CEO_NAME = 'خالد العتيبي';
const CONFLICT_MESSAGE = 'This record changed. Refresh and try again.';
const PURPOSE_FILTER = 'نوع الإجراء';
const PURPOSE_LABELS = { all: 'كل الأنواع', work: 'طلبات العمل', employee: 'شؤون الموظفين الشخصية' };
const RACE_ROUNDS = 3;

type Step = { name: string; reviewer_ids: number[] };
type ProcessOptions = { purpose?: 'work' | 'employee'; stage_approval_mode?: 'per_stage' | 'single' };
type Record_ = { id: number; revision: number };

/** An API call that must succeed; the body is the record. */
async function ok(browser: PageContext, method: string, path: string, payload?: Json): Promise<Json> {
  const answer = await api(browser, method, path, payload);
  expect([method, path, answer.status, answer.body.message]).toEqual([method, path, 200, undefined]);
  return answer.body;
}

/** The user id of the one person the people picker finds under NAME. */
async function personId(browser: PageContext, name: string): Promise<number> {
  const found = await api(browser, 'GET', `/api/v1/people?q=${encodeURIComponent(name)}`);
  const people = (found.body as unknown as { name: string; user_id: number }[]).filter(person => person.name === name);
  expect([name, found.status, people.length]).toEqual([name, 200, 1]);
  return people[0]!.user_id;
}

function asRecord(body: Json): Record_ {
  return { id: body.id as number, revision: body.revision as number };
}

/** A draft process with the given stages, created by the signed-in process manager. */
async function draftProcess(browser: PageContext, name: string, steps: Step[], options: ProcessOptions = {}): Promise<Record_> {
  return asRecord(await ok(browser, 'POST', PROCESSES, { name, steps, ...options }));
}

async function publish(browser: PageContext, draft: Record_): Promise<Record_> {
  return asRecord(await ok(browser, 'POST', `${PROCESSES}/${draft.id}/publish`, { revision: draft.revision }));
}

/** A request on PROCESS by the signed-in user, submitted for approval. */
async function submittedRequest(browser: PageContext, name: string, processId: number): Promise<Record_> {
  const created = asRecord(await ok(browser, 'POST', REQUESTS, { name, process_id: processId }));
  return asRecord(await ok(browser, 'POST', `${REQUESTS}/${created.id}/submit`, { revision: created.revision }));
}

function approve(browser: PageContext, request: Record_): Promise<Answer> {
  return api(browser, 'POST', `${REQUESTS}/${request.id}/approve`, { revision: request.revision });
}

/** The state of a request and the status of each of its stages, in order. */
function progress(body: Json): [unknown, unknown[]] {
  return [body.state, (body.steps as Json[]).map(step => step.status)];
}

/** An archived process of the signed-in process manager, with the page that lists its actions open. */
async function archivedProcess({ app, screen, browser }: Stage, label: string): Promise<{ archived: Record_; steps: Step[]; name: string }> {
  await app.open(PROCESS_PAGES);
  await expect(screen.getByRole('heading', { level: 1 })).toBeVisible(slow);
  const name = `${label} ${Date.now().toString(36)}`;
  const steps = [{ name: 'مراجعة', reviewer_ids: [await personId(browser, PM_NAME)] }];
  const draft = await draftProcess(browser, name, steps);
  const answer = await ok(browser, 'POST', `${PROCESSES}/${draft.id}/archive`, { revision: draft.revision });
  expect([answer.state, answer.revision]).toEqual(['archived', draft.revision + 1]);
  return { archived: asRecord(answer), steps, name };
}

async function expectStillArchived(browser: PageContext, archived: Record_) {
  const read = await ok(browser, 'GET', `${PROCESSES}/${archived.id}`);
  expect([read.state, read.revision]).toEqual(['archived', archived.revision]);
}

async function openProcessPage({ screen, browser }: Stage, id: number, name: string) {
  await browser.goto(`${PROCESS_PAGES}/${id}`, { waitUntil: 'domcontentloaded' });
  await expect(screen.getByRole('heading', { level: 1, name })).toBeVisible(slow);
  await expect(screen.getByText('مؤرشف').first()).toBeVisible(slow);
}

test('[OPS-55] saving an archived process is refused and it stays archived', {
  tags: ['operations'], timeout: 300_000, session: 'ops_manager', skip: ODOO_ONLY,
}, async ({ app, screen, browser }) => {
  const stage = { app, screen, browser };
  const { archived, steps, name } = await archivedProcess(stage, 'إجراء مؤرشف');

  const saved = await api(browser, 'PATCH', `${PROCESSES}/${archived.id}`, { revision: archived.revision, name: `${name} معدل`, steps });
  expect([saved.status, saved.body.code, saved.body.message]).toEqual([422, 'invalid', 'An archived process cannot be changed.']);
  await expectStillArchived(browser, archived);

  await openProcessPage(stage, archived.id, name);
  await expect(screen.getByRole('link', 'تعديل')).toHaveCount(0, slow);
  await browser.goto(`${PROCESS_PAGES}/${archived.id}/edit`, { waitUntil: 'domcontentloaded' });
  await expect(screen.getByText('لا يمكن تعديل إجراء مؤرشف.')).toBeVisible(slow);
  await expect(screen.getByRole('button', 'حفظ')).toHaveCount(0, slow);
});

test('[OPS-71] a second archive of an archived process is refused without a revision bump', {
  tags: ['operations'], timeout: 300_000, session: 'ops_manager', skip: ODOO_ONLY,
}, async ({ app, screen, browser }) => {
  const stage = { app, screen, browser };
  const { archived, name } = await archivedProcess(stage, 'إجراء مؤرشف مرتين');

  const again = await api(browser, 'POST', `${PROCESSES}/${archived.id}/archive`, { revision: archived.revision });
  expect([again.status, again.body.code, again.body.message]).toEqual([422, 'invalid', 'This process is already archived.']);
  await expectStillArchived(browser, archived);

  await openProcessPage(stage, archived.id, name);
  await expect(screen.getByRole('button', 'أرشفة')).toHaveCount(0, slow);
  await expect(screen.getByRole('button', 'نشر')).toHaveCount(0, slow);
});

test('[OPS-86] the same reviewer on two consecutive stages approves each stage with its own decision', {
  tags: ['operations'], timeout: 300_000, session: 'ops_manager', skip: ODOO_ONLY,
}, async ({ app, screen, browser }) => {
  await app.open('/operations');
  await expect(screen.getByRole('heading', { level: 1 })).toBeVisible(slow);
  const stamp = Date.now().toString(36);
  const pm = await personId(browser, PM_NAME);
  const draft = await draftProcess(browser, `إجراء بمرحلتين ${stamp}`, [{ name: 'مراجعة أولى', reviewer_ids: [pm] }, { name: 'مراجعة ثانية', reviewer_ids: [pm] }]);
  expect((await ok(browser, 'GET', `${PROCESSES}/${draft.id}`)).stage_approval_mode).toBe('per_stage');
  const published = await publish(browser, draft);
  const request = await submittedRequest(browser, `طلب بمرحلتين ${stamp}`, published.id);

  await signInAs('pm', { app, screen, browser });
  const first = await approve(browser, request);
  expect([first.status, ...progress(first.body)]).toEqual([200, 'pending', ['approved', 'pending']]);
  expect((first.body.allowed_actions as Json).approve).toBe(true);
  const second = await approve(browser, asRecord(first.body));
  expect([second.status, ...progress(second.body)]).toEqual([200, 'done', ['approved', 'approved']]);
  expect((second.body.events as Json[]).filter(event => event.kind === 'approved')).toHaveLength(2);
});

test('[OPS-202] the stage approval mode decides how many stages one approval covers, and a pending request keeps its mode', {
  tags: ['operations'], timeout: 600_000, session: 'ops_manager', skip: ODOO_ONLY,
}, async ({ app, screen, browser }) => {
  const stage = { app, screen, browser };
  await app.open(PROCESS_PAGES);
  await expect(screen.getByRole('heading', { level: 1 })).toBeVisible(slow);
  const stamp = Date.now().toString(36);
  const name = `إجراء المراجع المتكرر ${stamp}`;
  const [pm, ceo] = [await personId(browser, PM_NAME), await personId(browser, CEO_NAME)];
  const steps = [{ name: 'مراجعة أولى', reviewer_ids: [pm] }, { name: 'مراجعة ثانية', reviewer_ids: [pm] }, { name: 'اعتماد المدير العام', reviewer_ids: [ceo] }];

  // The default mode; this request is submitted under it.
  const perStage = await publish(browser, await draftProcess(browser, name, steps));
  const underPerStage = await submittedRequest(browser, `طلب قبل تغيير الإعداد ${stamp}`, perStage.id);
  // The manager switches the setting and publishes again; the next request is submitted under the new mode.
  const switched = await ok(browser, 'PATCH', `${PROCESSES}/${perStage.id}`, { revision: perStage.revision, name, steps, stage_approval_mode: 'single' });
  const single = await publish(browser, asRecord(switched));
  const underSingle = await submittedRequest(browser, `طلب بعد تغيير الإعداد ${stamp}`, single.id);
  const unknownMode = await api(browser, 'PATCH', `${PROCESSES}/${single.id}`, { revision: single.revision, name, steps, stage_approval_mode: 'every_other' });
  expect([unknownMode.status, unknownMode.body.code, unknownMode.body.field]).toEqual([422, 'invalid', 'stage_approval_mode']);

  await browser.goto(`${PROCESS_PAGES}/${single.id}`, { waitUntil: 'domcontentloaded' });
  await expect(screen.getByRole('heading', { level: 1, name })).toBeVisible(slow);
  await expect(screen.getByText('المراجع المتكرر في أكثر من مرحلة')).toBeVisible(slow);
  await expect(screen.getByText('اعتماد واحد يكفي')).toBeVisible(slow);

  await signInAs('pm', stage);
  // Submitted under «اعتماد لكل مرحلة»: the later switch does not reach it, each stage takes its own decision.
  const first = await approve(browser, underPerStage);
  expect([first.status, ...progress(first.body)]).toEqual([200, 'pending', ['approved', 'pending', 'waiting']]);
  const second = await approve(browser, asRecord(first.body));
  expect([second.status, ...progress(second.body)]).toEqual([200, 'pending', ['approved', 'approved', 'pending']]);
  // Submitted under «اعتماد واحد يكفي»: one decision covers pm's two consecutive stages and stops at the CEO's.
  const both = await approve(browser, underSingle);
  expect([both.status, ...progress(both.body)]).toEqual([200, 'pending', ['approved', 'approved', 'pending']]);
  expect((both.body.events as Json[]).filter(event => event.kind === 'approved')).toHaveLength(1);
  // The CEO's stage is not pm's to decide in either mode.
  for (const body of [second.body, both.body]) {
    expect((body.allowed_actions as Json).approve).toBe(false);
    const early = await approve(browser, asRecord(body));
    expect([early.status, early.body.code]).toEqual([403, 'forbidden']);
  }

  await signInAs('ceo', stage);
  for (const body of [second.body, both.body]) {
    const last = await approve(browser, asRecord(body));
    expect([last.status, ...progress(last.body)]).toEqual([200, 'done', ['approved', 'approved', 'approved']]);
  }
});

/** The type filter of a shared request list: every option narrows the two stamped requests and stays in the URL. */
async function expectPurposeFilter({ screen, browser }: Stage, listPath: string, stamp: string, names: { work: string; employee: string }) {
  const search = `q=${stamp}`;
  await browser.goto(`${listPath}?${search}`, { waitUntil: 'domcontentloaded' });
  const filter = screen.getByRole('combobox', PURPOSE_FILTER);
  await expect(filter).toContainText(PURPOSE_LABELS.all, slow);
  await expect(screen.getByRole('link', names.work)).toBeVisible(slow);
  await expect(screen.getByRole('link', names.employee)).toBeVisible(slow);

  for (const [purpose, shown, hidden] of [['employee', names.employee, names.work], ['work', names.work, names.employee]] as const) {
    await screen.getByRole('combobox', PURPOSE_FILTER).tap();
    await screen.getByRole('option', PURPOSE_LABELS[purpose]).tap();
    await expect(browser).toHaveURL(new RegExp(`[?&]purpose=${purpose}(&|$)`), slow);
    await expect(screen.getByRole('link', shown)).toBeVisible(slow);
    await expect(screen.getByRole('link', hidden)).toHaveCount(0, slow);
  }

  // The filter survives a refresh, and the record's return link brings the filtered list back.
  await browser.reload();
  await expect(screen.getByRole('combobox', PURPOSE_FILTER)).toContainText(PURPOSE_LABELS.work, slow);
  await expect(screen.getByRole('link', names.employee)).toHaveCount(0, slow);
  await screen.getByRole('link', names.work).tap();
  await expect(screen.getByRole('heading', { level: 1, name: names.work })).toBeVisible(slow);
  await expect(browser).toHaveURL(/returnTo=.*purpose(=|%3D)work/, slow);
  await browser.back();
  await expect(browser).toHaveURL(new RegExp(`${listPath}\\?.*purpose=work`), slow);
  await expect(screen.getByRole('link', names.work)).toBeVisible(slow);
  await expect(screen.getByRole('link', names.employee)).toHaveCount(0, slow);
}

/** What the list API answers for SCOPE: the stamped request names per purpose, and the refusal of an unknown one. */
async function expectPurposeApi(browser: PageContext, scope: string, stamp: string, names: { work: string; employee: string }) {
  const list = `${REQUESTS}?scope=${scope}&q=${stamp}`;
  const listed = async (suffix: string) => ((await ok(browser, 'GET', `${list}${suffix}`)).items as Json[]).map(item => item.name).sort();
  expect(await listed('')).toEqual([names.work, names.employee].sort());
  expect(await listed('&purpose=work')).toEqual([names.work]);
  expect(await listed('&purpose=employee')).toEqual([names.employee]);
  const refused = await api(browser, 'GET', `${list}&purpose=personal`);
  expect([refused.status, refused.body.code, refused.body.field]).toEqual([422, 'invalid', 'purpose']);
}

test('[OPS-165] the shared request lists filter by type and refuse an unknown type', {
  tags: ['operations'], timeout: 600_000, session: 'ops_manager', skip: ODOO_ONLY,
}, async ({ app, screen, browser }) => {
  const stage = { app, screen, browser };
  await app.open('/operations/monitoring');
  await expect(screen.getByRole('heading', { level: 1 })).toBeVisible(slow);
  const stamp = Date.now().toString(36);
  const steps = [{ name: 'مراجعة', reviewer_ids: [await personId(browser, PM_NAME)] }];
  const names = { work: `طلب عمل ${stamp}`, employee: `طلب شؤون موظف ${stamp}` };
  for (const purpose of ['work', 'employee'] as const) {
    const published = await publish(browser, await draftProcess(browser, `إجراء ${PURPOSE_LABELS[purpose]} ${stamp}`, steps, { purpose }));
    await submittedRequest(browser, names[purpose], published.id);
  }

  await expectPurposeApi(browser, 'monitoring', stamp, names);
  await expectPurposeFilter(stage, '/operations/monitoring', stamp, names);

  await signInAs('pm', stage);
  await expectPurposeApi(browser, 'pending', stamp, names);
  await expectPurposeFilter(stage, '/operations/pending', stamp, names);
});

/** The signed-in persona's cookies as a request header, for a call the test process sends itself. */
async function sessionCookies(browser: WebBrowser): Promise<string> {
  return (await browser.cookies()).map(cookie => `${cookie.name}=${cookie.value}`).join('; ');
}

/** An approval sent by the test process with one persona's cookies, so two personas can decide at the same moment. */
async function approveWith(baseUrl: string, cookie: string, request: Record_): Promise<Answer> {
  const response = await fetch(`${baseUrl}${REQUESTS}/${request.id}/approve`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', cookie, origin: baseUrl },
    body: JSON.stringify({ revision: request.revision }),
  });
  return { status: response.status, body: await response.json().catch(() => ({})) as Json };
}

test('[OPS-131] two reviewers of one stage approve at once: one wins, the other gets a 409 conflict', {
  tags: ['operations'], timeout: 600_000, session: 'ops_manager', skip: ODOO_ONLY,
}, async ({ app, screen, browser }) => {
  const stage = { app, screen, browser };
  await app.open('/operations');
  await expect(screen.getByRole('heading', { level: 1 })).toBeVisible(slow);
  const stamp = Date.now().toString(36);
  const reviewers = [await personId(browser, PM_NAME), await personId(browser, CEO_NAME)];
  const published = await publish(browser, await draftProcess(browser, `إجراء بمراجعين ${stamp}`, [{ name: 'مراجعة مشتركة', reviewer_ids: reviewers }]));
  const requests: Record_[] = [];
  for (let round = 1; round <= RACE_ROUNDS; round++) requests.push(await submittedRequest(browser, `طلب قرارين معًا ${stamp}-${round}`, published.id));

  await signInAs('pm', stage);
  const pmCookies = await sessionCookies(browser);
  await signInAs('ceo', stage);
  const ceoCookies = await sessionCookies(browser);
  expect(pmCookies).not.toBe(ceoCookies);

  for (const [round, request] of requests.entries()) {
    // Both decisions carry the same revision and leave together; the order of the two alternates per round.
    const order = round % 2 ? [ceoCookies, pmCookies] : [pmCookies, ceoCookies];
    const answers = await Promise.all(order.map(cookie => approveWith(app.baseUrl, cookie, request)));
    expect(answers.map(answer => answer.status).sort()).toEqual([200, 409]);
    const lost = answers.find(answer => answer.status === 409)!;
    expect([lost.body.code, lost.body.message]).toEqual(['conflict', CONFLICT_MESSAGE]);

    const after = await ok(browser, 'GET', `${REQUESTS}/${request.id}`);
    expect([...progress(after), after.execution_count]).toEqual(['done', ['approved'], 1]);
    expect((after.events as Json[]).filter(event => event.kind === 'approved')).toHaveLength(1);
  }
});
