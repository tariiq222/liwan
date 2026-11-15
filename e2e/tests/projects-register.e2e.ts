import { test } from '@e2e-dev/web';
import { expect } from 'e2e';
import { api, ODOO_ONLY, personId, signInAs, slow, type Answer, type Json, type PageContext, type Stage } from '../scratch.ts';

/**
 * Projects register rows against the scratch Odoo stack (`npm run e2e:odoo`).
 * Scenarios PMO-92, PMO-100, PMO-105, PMO-114, PMO-146, PMO-214, PMO-220, PMO-277, PMO-288, PMO-363,
 * PMO-374, PMO-413, PMO-433 and PMO-506 (e2e/scenarios/projects.md). Personas come from tools/e2e_seed.py; every
 * project and task name carries a timestamp because the database is reused between runs. API calls go through the
 * signed-in page, so they carry the persona's session cookie.
 *
 * The tests read the tenant's project settings as they are seeded and change none: only managers create projects,
 * the three project tools are optional per project, and only managers read a project's finance.
 */
const PROJECTS = '/api/v1/projects';
const TASKS = '/api/v1/tasks';
const ARCHIVED = `${TASKS}/archived`;
const PM_NAME = 'ماجد الغامدي';
const STAFF1_NAME = 'يوسف المالكي';
const NOT_FOUND = 'المشروع غير موجود أو لا تملك صلاحية عرضه';
const BACK_TO_PROJECTS = 'العودة إلى المشاريع';
const COPY_ACTION = 'نسخ المشروع';
const ERROR_KEYS = ['code', 'message', 'field', 'details'];
const NO_PROJECT_ID = 2_000_000_000;
const MISSING_PROJECT_PAGE = 99_999_999;
const PROJECT_SECTIONS = ['', '/tasks', '/milestones', '/charter', '/finance', '/updates', '/meetings', '/stakeholders', '/raci', '/register', '/changes', '/baselines', '/evm', '/documents', '/settings'];

type Tool = 'planning' | 'governance' | 'finance';
type Project = { id: number; updated_at: string };
type ProjectOptions = { date_start?: string; date_end?: string; tools?: Tool[] };
type Refusal = [status: number, code: unknown, field: unknown];

/** An API call that must answer STATUS; the body is the record. */
async function ok(browser: PageContext, method: string, path: string, payload?: Json, status = 200): Promise<Json> {
  const answer = await api(browser, method, path, payload);
  expect([method, path, answer.status, answer.body.message]).toEqual([method, path, status, undefined]);
  return answer.body;
}

function refusal(answer: Answer): Refusal {
  return [answer.status, answer.body.code, answer.body.field];
}

/** A project open to every employee, created by the signed-in ceo and managed by pm, with the named optional tools switched on. */
async function projectOfPm({ app, screen, browser }: Stage, name: string, options: ProjectOptions = {}): Promise<Project> {
  await app.open('/projects');
  await expect(screen.getByRole('heading', { level: 1 })).toBeVisible(slow);
  const { tools = [], ...dates } = options;
  const created = await ok(browser, 'POST', PROJECTS, { name, user_id: await personId(browser, PM_NAME), ...dates }, 201);
  if (!tools.length) return created as unknown as Project;
  const preferences = Object.fromEntries(tools.map(tool => [tool, true]));
  return await ok(browser, 'PATCH', `${PROJECTS}/${created.id as number}`, { expected_updated_at: created.updated_at, tool_preferences: preferences }) as unknown as Project;
}

async function createTask(browser: PageContext, projectId: number, name: string): Promise<number> {
  return (await ok(browser, 'POST', TASKS, { name, project_id: projectId }, 201)).id as number;
}

async function expectProjectNotFound({ screen, browser }: Stage, path: string) {
  await browser.goto(path, { waitUntil: 'domcontentloaded' });
  await expect(screen.getByTestId('project-not-found')).toBeVisible(slow);
  await expect(screen.getByTestId('project-not-found')).toContainText(NOT_FOUND, slow);
  await expect(screen.getByRole('link', BACK_TO_PROJECTS)).toBeVisible(slow);
  await expect(screen.getByTestId('project-workspace-frame')).toHaveCount(0, slow);
}

test('[PMO-92] an employee who may not create projects gets the shared permission page on /projects/new', {
  tags: ['projects'], timeout: 300_000, session: 'staff1', skip: ODOO_ONLY,
}, async ({ app, screen, browser }) => {
  await app.open('/projects');
  await expect(screen.getByRole('heading', { level: 1 })).toBeVisible(slow);
  expect((await ok(browser, 'GET', `${PROJECTS}?limit=1`)).can_create).toBe(false);
  const defaults = await api(browser, 'GET', '/api/v1/settings/projects/create-defaults');
  expect([defaults.status, defaults.body.code]).toEqual([403, 'forbidden']);

  await browser.goto('/projects/new', { waitUntil: 'domcontentloaded' });
  const page = screen.getByTestId('app-error');
  await expect(page).toContainText('لا تملك صلاحية فتح هذه الصفحة', slow);
  await expect(page).toContainText('رمز الخطأ 403', slow);
  await expect(screen.getByRole('button', 'العودة إلى الصفحة الرئيسية')).toBeVisible(slow);
  await expect(screen.getByRole('button', 'رجوع')).toBeVisible(slow);
  await expect(screen.getByTestId('project-create-form')).toHaveCount(0, slow);
});

test('[PMO-100] [PMO-105] [PMO-277] a followers-only project answers a non-follower like a project that does not exist', {
  tags: ['projects'], timeout: 900_000, session: 'ceo', skip: ODOO_ONLY,
}, async ({ app, screen, browser }) => {
  const stage = { app, screen, browser };
  const stamp = Date.now().toString(36);
  const name = `مشروع للمتابعين ${stamp}`;
  const project = await projectOfPm(stage, name, { tools: ['governance'] });
  const base = `${PROJECTS}/${project.id}`;
  await ok(browser, 'POST', `${base}/followers`, { user_id: await personId(browser, STAFF1_NAME) });
  // Who may create projects is offered the copy on the project's menu.
  await browser.goto(`/projects/${project.id}`, { waitUntil: 'domcontentloaded' });
  await screen.getByTestId('project-workspace-menu').tap();
  await expect(screen.getByRole('menuitem', COPY_ACTION)).toBeVisible(slow);

  await signInAs('pm', stage);
  expect((await ok(browser, 'PATCH', base, { privacy_visibility: 'followers' })).privacy_visibility).toBe('followers');
  const taskId = await createTask(browser, project.id, `مهمة للمتابعين ${stamp}`);
  const stakeholder = await ok(browser, 'POST', `${base}/stakeholders`, { name: `صاحب مصلحة ${stamp}` }, 201);
  const item = await ok(browser, 'POST', `${base}/register`, { kind: 'issue', title: `مشكلة ${stamp}`, task_id: taskId }, 201);
  const row = await ok(browser, 'POST', `${base}/raci`, { task_id: taskId, stakeholder_id: stakeholder.id, role: 'R' }, 201);
  // The manager cannot create projects, so the same menu carries no copy.
  expect((await ok(browser, 'GET', `${PROJECTS}?q=${stamp}`)).can_create).toBe(false);
  await browser.goto(`/projects/${project.id}`, { waitUntil: 'domcontentloaded' });
  await screen.getByTestId('project-workspace-menu').tap();
  await expect(screen.getByRole('menuitem', 'إعدادات المشروع')).toBeVisible(slow);
  await expect(screen.getByRole('menuitem', COPY_ACTION)).toHaveCount(0, slow);

  // A follower reads the project and its governance, so the refusals below are about the caller.
  await signInAs('staff1', stage);
  expect((await ok(browser, 'GET', base)).name).toBe(name);
  for (const list of ['stakeholders', 'raci', 'register']) expect((await ok(browser, 'GET', `${base}/${list}`)).total).toBe(1);
  expect((await ok(browser, 'GET', `${PROJECTS}?q=${stamp}`)).total).toBe(1);

  await signInAs('staff2', stage);
  const missing = await api(browser, 'GET', `${PROJECTS}/${NO_PROJECT_ID}`);
  expect([missing.status, missing.body.code, Object.keys(missing.body).sort()]).toEqual([404, 'not_found', ['code', 'message']]);
  const hidden: [method: string, path: string, payload?: Json][] = [
    ['GET', base],
    ['PATCH', base, { name: `${name} معدل` }],
    ['POST', `${base}/copy`, { name: `نسخة ${stamp}`, start_date: '2027-02-01' }],
    ['GET', `${base}/followers`],
    ['GET', `${base}/stakeholders`],
    ['GET', `${base}/stakeholders/${stakeholder.id as number}`],
    ['POST', `${base}/stakeholders`, { name: `دخيل ${stamp}` }],
    ['PATCH', `${base}/stakeholders/${stakeholder.id as number}`, { name: `دخيل ${stamp}` }],
    ['DELETE', `${base}/stakeholders/${stakeholder.id as number}`],
    ['GET', `${base}/raci`],
    ['POST', `${base}/raci`, { task_id: taskId, stakeholder_id: stakeholder.id, role: 'A' }],
    ['PATCH', `${base}/raci/${row.id as number}`, { role: 'C' }],
    ['DELETE', `${base}/raci/${row.id as number}`],
    ['GET', `${base}/register`],
    ['GET', `${base}/register/${item.id as number}`],
    ['POST', `${base}/register`, { kind: 'issue', title: `دخيلة ${stamp}` }],
    ['PATCH', `${base}/register/${item.id as number}`, { title: `دخيلة ${stamp}` }],
    ['DELETE', `${base}/register/${item.id as number}`],
  ];
  for (const [method, path, payload] of hidden) {
    const answer = await api(browser, method, path, payload);
    expect([method, path, answer.status, answer.body]).toEqual([method, path, 404, missing.body]);
  }
  expect((await ok(browser, 'GET', `${PROJECTS}?q=${stamp}`)).total).toBe(0);

  // The page of the hidden project is the page of a missing one, and names nothing of the project.
  for (const id of [project.id, MISSING_PROJECT_PAGE]) {
    await expectProjectNotFound(stage, `/projects/${id}`);
    await expect(screen.getByText(name)).toHaveCount(0, slow);
  }
});

test('[PMO-114] a project edit with an empty name, a bad date or a start after the end is refused on its field', {
  tags: ['projects'], timeout: 600_000, session: 'ceo', skip: ODOO_ONLY,
}, async ({ app, screen, browser }) => {
  const stage = { app, screen, browser };
  const name = `مشروع تحقق ${Date.now().toString(36)}`;
  const dates = { date_start: '2026-10-15', date_end: '2027-01-20' };
  const project = await projectOfPm(stage, name, dates);
  const path = `${PROJECTS}/${project.id}`;

  await signInAs('pm', stage);
  const refused: [payload: Json, field: string][] = [
    [{ name: '   ' }, 'name'],
    [{ date_start: '2026-13-45' }, 'date_start'],
    [{ date_end: 'غدًا' }, 'date_end'],
    [{ date_start: '2027-05-01', date_end: '2027-01-20' }, 'date_start'],
  ];
  for (const [payload, field] of refused) {
    expect([field, ...refusal(await api(browser, 'PATCH', path, payload))]).toEqual([field, 422, 'invalid', field]);
  }
  // One date sent alone against the stored other one: refused as well, and the answer carries the contract's keys only.
  for (const payload of [{ date_start: '2027-05-01' }, { date_end: '2026-01-01' }]) {
    const answer = await api(browser, 'PATCH', path, payload);
    expect([answer.status, answer.body.code]).toEqual([422, 'invalid']);
    expect(Object.keys(answer.body).filter(key => !ERROR_KEYS.includes(key))).toEqual([]);
  }
  const after = await ok(browser, 'GET', path);
  expect([after.name, after.date_start, after.date_end]).toEqual([name, dates.date_start, dates.date_end]);
});

test('[PMO-146] the read-only charter shows the estimate with the company currency, and no amount when the budget is unknown', {
  tags: ['projects'], timeout: 600_000, session: 'ceo', skip: ODOO_ONLY,
}, async ({ app, screen, browser }) => {
  const stage = { app, screen, browser };
  const project = await projectOfPm(stage, `مشروع ميزانية ${Date.now().toString(36)}`, { tools: ['governance', 'finance'] });
  const path = `${PROJECTS}/${project.id}`;
  const charter = screen.getByTestId('project-charter-display');
  const budgetSection = 'التخطيط والميزانية';

  await signInAs('pm', stage);
  const estimated = await ok(browser, 'PATCH', path, { expected_updated_at: project.updated_at, charter: { budget_state: 'estimate', amount: 12345.5 } });
  const currency = (estimated.charter as Json).currency as { name: string; symbol: string };
  const amount = `12,345.50 ${currency.name} (${currency.symbol})`;
  await browser.goto(`/projects/${project.id}/charter`, { waitUntil: 'domcontentloaded' });
  await expect(charter).toContainText(budgetSection, slow);
  await expect(charter.getByText(amount)).toBeVisible(slow);

  await ok(browser, 'PATCH', path, { expected_updated_at: estimated.updated_at, charter: { budget_state: 'unknown' } });
  await browser.reload();
  await expect(charter).toContainText('غير معروفة', slow);
  await expect(charter.getByText('المبلغ')).toHaveCount(0, slow);
  await expect(charter.getByText(currency.name)).toHaveCount(0, slow);

  // An employee who may not read the project's finance gets the charter without its budget section.
  await signInAs('staff1', stage);
  const read = await ok(browser, 'GET', path);
  expect([read.can_read_finance, (read.charter as Json).budget_state, (read.charter as Json).currency]).toEqual([false, null, null]);
  await browser.goto(`/projects/${project.id}/charter`, { waitUntil: 'domcontentloaded' });
  await expect(charter).toContainText('الأساسيات', slow);
  await expect(charter.getByText(budgetSection)).toHaveCount(0, slow);
});

test('[PMO-214] [PMO-220] the timeline switches between weeks and calendar months, and a task is scheduled inside its project and milestone only', {
  tags: ['projects'], timeout: 600_000, session: 'ceo', skip: ODOO_ONLY,
}, async ({ app, screen, browser }) => {
  const stage = { app, screen, browser };
  const stamp = Date.now().toString(36);
  // Two years: longer than the weekly axis has columns for, so that scale groups three weeks into a column.
  const project = await projectOfPm(stage, `مشروع جدول ${stamp}`, { date_start: '2026-01-01', date_end: '2028-01-10', tools: ['planning'] });
  const base = `${PROJECTS}/${project.id}`;

  await signInAs('pm', stage);
  const taskName = `مهمة مجدولة ${stamp}`;
  const taskId = await createTask(browser, project.id, taskName);
  const schedule = `${base}/schedule/tasks/${taskId}`;
  const outsideProject: [start: string, end: string, message: string][] = [
    ['2026-12-10', '2026-12-01', 'يجب أن يكون بدء الجدولة في تاريخ الانتهاء أو قبله.'],
    ['2027-12-01', '2030-01-01', 'يجب أن يكون انتهاء الجدولة في تاريخ انتهاء المشروع أو قبله.'],
    ['2025-12-01', '2026-02-01', 'يجب أن يكون بدء الجدولة في تاريخ بدء المشروع أو بعده.'],
  ];
  const outsideMilestone: [start: string, end: string, message: string][] = [
    ['2026-12-05', '2026-12-10', 'يجب أن يكون تاريخ بدء المهمة في أو قبل الموعد النهائي للمعلم.'],
    ['2026-10-20', '2026-11-10', 'يجب أن يكون تاريخ بدء المهمة في أو بعد تاريخ بدء المعلم.'],
  ];
  async function expectRefused(cases: [start: string, end: string, message: string][]) {
    for (const [start, end, message] of cases) {
      const answer = await api(browser, 'PATCH', schedule, { start, end });
      expect([start, end, answer.status, answer.body.code, answer.body.message]).toEqual([start, end, 422, 'invalid', message]);
    }
  }
  await expectRefused(outsideProject);
  const milestone = await ok(browser, 'POST', `${base}/milestones`, { name: `معلم ${stamp}`, start_date: '2026-11-01', deadline: '2026-11-30' }, 201);
  await ok(browser, 'PATCH', `${TASKS}/${taskId}`, { milestone_id: milestone.id });
  await expectRefused(outsideMilestone);
  const placed = await ok(browser, 'PATCH', schedule, { start: '2026-11-05', end: '2026-11-10' });
  expect([placed.start, placed.end, placed.milestone_id]).toEqual(['2026-11-05', '2026-11-10', milestone.id]);

  // An employee reads the same timeline.
  await signInAs('staff1', stage);
  const range = screen.getByTestId('timeline-range');
  const scale = screen.getByTestId('timeline-scale');
  const columns = screen.getByTestId('schedule-gantt-scroller');
  const grouped = screen.getByTestId('schedule-gantt-grouped-note');
  await browser.goto(`/projects/${project.id}/tasks?view=timeline`, { waitUntil: 'domcontentloaded' });
  await expect(columns).toContainText(taskName, slow);
  await expect(scale.getByRole('button', 'أسبوعي')).toHaveAttribute('aria-pressed', 'true', slow);
  await expect(range).toHaveText('كل عمود = 3 أسابيع — الأعمدة مجمّعة', slow);
  await expect(grouped).toContainText('يجمع كل عمود عدة وحدات زمنية', slow);
  await expect(columns).toContainText('المهمة 1 يناير 22 يناير 12 فبراير 5 مارس', slow);

  await scale.getByRole('button', 'شهري').tap();
  await expect(browser).toHaveURL(/[?&]scale=month(&|$)/, slow);
  await expect(range).toHaveText('كل عمود = شهر', slow);
  await expect(grouped).toHaveCount(0, slow);
  // Calendar months: every column starts on the first of its month.
  await expect(columns).toContainText('المهمة 1 يناير 1 فبراير 1 مارس 1 أبريل 1 مايو', slow);
  await expect(columns.getByText('22 يناير')).toHaveCount(0, slow);
  await expect(columns.getByText('31 يناير')).toHaveCount(0, slow);

  await browser.reload();
  await expect(scale.getByRole('button', 'شهري')).toHaveAttribute('aria-pressed', 'true', slow);
  await scale.getByRole('button', 'أسبوعي').tap();
  await expect(browser).toHaveURL(/[?&]scale=week(&|$)/, slow);
  await expect(range).toHaveText('كل عمود = 3 أسابيع — الأعمدة مجمّعة', slow);
});

test('[PMO-288] the task list filters are stored in the browser and mirrored in the URL, and a key in the URL wins', {
  tags: ['projects'], timeout: 300_000, session: 'staff1', skip: ODOO_ONLY,
}, async ({ app, screen, browser }) => {
  const chips = screen.getByTestId('task-filter-chips');
  const stored = async () => JSON.parse(await browser.evaluate(() => localStorage.getItem('liwan.tasks.filters') ?? '{}')) as Json;
  const picks: [group: string, label: string, key: string, value: string][] = [
    ['task-filter-priority', 'عاجلة', 'priority', '3'],
    ['task-filter-assignee', 'أنا', 'assignee', 'me'],
    ['task-filter-deadline', 'متأخرة', 'deadline', 'overdue'],
  ];

  await app.open('/tasks');
  await screen.getByTestId('task-filters-button').tap();
  for (const [group, label, key, value] of picks) {
    await screen.getByTestId(group).getByRole('button', label).tap();
    await expect(browser).toHaveURL(new RegExp(`[?&]${key}=${value}(&|$)`), slow);
  }
  expect(await stored()).toEqual({ closed: false, priority: ['3'], assignee: 'me', deadline: 'overdue' });

  // The mirrored URL is the filtered list by itself: a refresh keeps the three filters.
  await browser.reload();
  await expect(chips).toContainText('الأولوية: عاجلة المسؤول: أنا الموعد: متأخرة', slow);

  // A key in the URL wins over the stored value, which stays what the user chose.
  await browser.goto('/tasks?priority=0', { waitUntil: 'domcontentloaded' });
  await expect(chips).toContainText('الأولوية: عادية', slow);
  await expect(chips.getByText('الأولوية: عاجلة')).toHaveCount(0, slow);
  expect((await stored()).priority).toEqual(['3']);

  // Clearing empties both, so the next test of this persona starts unfiltered.
  await chips.getByRole('button', 'مسح الفلاتر').tap();
  await expect(chips).toHaveCount(0, slow);
  await expect(browser).toHaveURL(/\/tasks(\?(?!.*(priority|assignee|deadline)=).*)?$/, slow);
  expect(await stored()).toEqual({ closed: false });
});

test('[PMO-363] the archived task list validates its project id and paging, and searches by name', {
  tags: ['projects'], timeout: 600_000, session: 'ceo', skip: ODOO_ONLY,
}, async ({ app, screen, browser }) => {
  const stage = { app, screen, browser };
  const stamp = Date.now().toString(36);
  const project = await projectOfPm(stage, `مشروع أرشيف ${stamp}`);

  await signInAs('staff1', stage);
  const name = `مهمة مؤرشفة ${stamp}`;
  const taskId = await createTask(browser, project.id, name);
  expect((await ok(browser, 'POST', `${TASKS}/${taskId}/archive`)).id).toBe(taskId);

  const refused: [query: string, field: string][] = [
    ['filter=mine&project_id=abc', 'project_id'],
    ['filter=mine&project_id=-1', 'project_id'],
    ['filter=mine&limit=-1', 'limit'],
    ['filter=mine&offset=-1', 'offset'],
    [`project_id=${project.id}&limit=x`, 'limit'],
  ];
  for (const [query, field] of refused) {
    expect([query, ...refusal(await api(browser, 'GET', `${ARCHIVED}?${query}`))]).toEqual([query, 422, 'invalid', field]);
  }
  const named = async (query: string) => {
    const page = await ok(browser, 'GET', `${ARCHIVED}?${query}`);
    return [page.total, (page.items as Json[]).map(item => item.name)];
  };
  const search = encodeURIComponent(name);
  expect(await named(`filter=mine&q=${search}`)).toEqual([1, [name]]);
  expect(await named(`project_id=${project.id}&q=${search}&limit=1&offset=0`)).toEqual([1, [name]]);
  expect(await named(`project_id=${project.id}&q=${search}&offset=1`)).toEqual([1, []]);
  expect(await named(`filter=mine&q=${encodeURIComponent(`لا شيء ${stamp}`)}`)).toEqual([0, []]);
});

test('[PMO-374] an uploaded task attachment answers 201 with its name, size and download link, and appears in the task', {
  tags: ['projects'], timeout: 600_000, session: 'ceo', skip: ODOO_ONLY,
}, async ({ app, screen, browser }) => {
  const stage = { app, screen, browser };
  const stamp = Date.now().toString(36);
  const project = await projectOfPm(stage, `مشروع مرفقات ${stamp}`);
  const file = { name: `ملاحظة ${stamp}.txt`, text: 'hello world' };

  await signInAs('staff1', stage);
  const taskId = await createTask(browser, project.id, `مهمة بمرفق ${stamp}`);
  const attachments = `${TASKS}/${taskId}/attachments`;
  const uploaded = await ok(browser, 'POST', attachments, { name: file.name, mimetype: 'text/plain', data: btoa(file.text) }, 201);
  expect(uploaded).toEqual({ id: uploaded.id, name: file.name, mimetype: 'text/plain', size: file.text.length, url: `${attachments}/${uploaded.id as number}/download` });
  const listed = await ok(browser, 'GET', attachments);
  expect([listed.total, listed.items]).toEqual([1, [uploaded]]);
  expect(await browser.evaluate(async link => (await fetch(link)).text(), uploaded.url as string)).toBe(file.text);

  await browser.goto(`/projects/${project.id}/tasks/${taskId}`, { waitUntil: 'domcontentloaded' });
  await expect(screen.getByTestId('task-attachments')).toContainText(file.name, slow);
});

test('[PMO-413] a finance entry edit with nothing to change or with a fixed field is refused', {
  tags: ['projects'], timeout: 600_000, session: 'ceo', skip: ODOO_ONLY,
}, async ({ app, screen, browser }) => {
  const stage = { app, screen, browser };
  const stamp = Date.now().toString(36);
  const project = await projectOfPm(stage, `مشروع مالية ${stamp}`, { tools: ['finance'] });
  const finance = `${PROJECTS}/${project.id}/finance`;

  await signInAs('pm', stage);
  const line = await ok(browser, 'POST', finance, { kind: 'budget', title: `بند ميزانية ${stamp}`, amount: 100 }, 201);
  const path = `${finance}/${line.id as number}`;
  const token = { expected_updated_at: line.updated_at };

  const empty = await api(browser, 'PATCH', path, token);
  expect([empty.status, empty.body.code, empty.body.message]).toEqual([422, 'invalid', 'no fields to update']);
  // The project and the kind of an entry never change: named alone or beside a real change, each is refused by name.
  for (const [field, value] of [['kind', 'expense'], ['project_id', NO_PROJECT_ID], ['entry_id', NO_PROJECT_ID]] as const) {
    for (const payload of [{ ...token, [field]: value }, { ...token, [field]: value, title: `بند معدل ${stamp}` }]) {
      const answer = await api(browser, 'PATCH', path, payload);
      expect([...refusal(answer), answer.body.message]).toEqual([422, 'unknown_field', field, `field '${field}' cannot be changed`]);
    }
  }
  expect(await ok(browser, 'GET', path)).toEqual(line);
});

test('[PMO-433] every section of a project that does not exist shows the one not-found state without the workspace frame', {
  tags: ['projects'], timeout: 600_000, session: 'staff1', skip: ODOO_ONLY,
}, async ({ app, screen, browser }) => {
  const stage = { app, screen, browser };
  await app.open('/projects');
  await expect(screen.getByRole('heading', { level: 1 })).toBeVisible(slow);
  const missing = await api(browser, 'GET', `${PROJECTS}/${MISSING_PROJECT_PAGE}`);
  expect([missing.status, missing.body.code]).toEqual([404, 'not_found']);

  for (const section of PROJECT_SECTIONS) {
    await expectProjectNotFound(stage, `/projects/${MISSING_PROJECT_PAGE}${section}`);
    await expect(screen.getByText('هذا السجل غير متاح أو لم يعد موجودًا.')).toHaveCount(0, slow);
  }
});

test('[PMO-506] the options other applications add to the project settings are named in Arabic', {
  tags: ['projects'], timeout: 300_000, session: 'ceo', skip: ODOO_ONLY,
}, async ({ app, screen, browser }) => {
  const costCenters = { name: 'liwan_pmo_finance_cost_center_mode', label: 'مراكز تكلفة المشاريع', options: ['تلقائي', 'يدوي'] };
  await app.open('/settings/apps/projects');
  await expect(screen.getByRole('heading', { level: 1 })).toBeVisible(slow);
  const extensions = (await ok(browser, 'GET', '/api/v1/settings/projects')).extensions as { name: string; label: string; help: string; options: { label: string }[] }[];
  expect(extensions.map(extension => [extension.name, extension.label, extension.options.map(option => option.label)])).toEqual([[costCenters.name, costCenters.label, costCenters.options]]);
  expect(/[A-Za-z]/.test(extensions[0]!.help)).toBe(false);

  await expect(screen.getByText('الربط مع التطبيقات الأخرى')).toBeVisible(slow);
  const choice = screen.getByTestId(`settings-extension-${costCenters.name}`);
  await expect(choice).toHaveAccessibleName(costCenters.label, slow);
  for (const option of costCenters.options) await expect(choice.getByRole('button', option)).toBeVisible(slow);
  await expect(screen.getByText(extensions[0]!.help)).toBeVisible(slow);
  for (const english of ['Cost centers of projects', 'Automatic', 'Manual']) await expect(screen.getByText(english)).toHaveCount(0, slow);
});

test('[PMO-283] a board column opens the task create panel with that column preset', {
  tags: ['projects'], timeout: 300_000, session: 'ceo', skip: ODOO_ONLY,
}, async ({ app, screen, browser }) => {
  const stage = { app, screen, browser };
  const project = await projectOfPm(stage, `مشروع عمود اللوحة ${Date.now().toString(36)}`);
  await signInAs('pm', stage);
  const board = `/projects/${project.id}/tasks?view=board`;
  await browser.goto(board, { waitUntil: 'domcontentloaded' });

  const columnCreate = screen.getByRole('link', 'مهمة جديدة في هذا العمود').first();
  await expect(columnCreate).toBeVisible(slow);
  const linked = new URL((await columnCreate.getAttribute('href'))!, app.baseUrl);
  const preset = [...linked.searchParams].filter(([key]) => key.startsWith('preset_'));
  expect(preset).toHaveLength(1);

  await columnCreate.tap();
  await expect(browser).toHaveURL(new RegExp(`/projects/${project.id}/tasks/new\\?`), slow);
  const opened = new URL(await browser.url());
  expect([...opened.searchParams].filter(([key]) => key.startsWith('preset_'))).toEqual(preset);
  expect(opened.searchParams.get('returnTo')).toBe(board);
  // Leaving the untouched panel returns to the board it was opened from.
  await screen.getByRole('button', 'إلغاء').first().tap();
  await expect(browser).toHaveURL(new RegExp(`/projects/${project.id}/tasks\\?view=board$`), slow);
});
