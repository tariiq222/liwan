import { test } from '@e2e-dev/web';
import { expect } from 'e2e';
import { api, ODOO_ONLY, signInAs, slow, type PageContext, type Stage } from '../scratch.ts';

/**
 * Documents register rows against the scratch Odoo stack (`npm run e2e:odoo`).
 * Scenarios DOC-30, DOC-34, DOC-53 and DOC-61 (e2e/scenarios/documents.md).
 * Personas come from tools/e2e_seed.py; every document name carries a timestamp because the database is
 * reused between runs. API calls go through the signed-in page, so they carry the persona's session cookie.
 */
const DOCUMENTS = '/api/v1/documents';
const CONTEXTS = `${DOCUMENTS}/contexts`;
const DEPARTMENT_KIND = 'hr.department';
const EMPLOYEE_KIND = 'hr.employee';
const DEPARTMENT_LABEL = 'القسم';
const EMPLOYEE_LABEL = 'الموظف';
const HR_DEPARTMENT = 'الموارد البشرية';
const KIND_SELECT = 'السياق المرتبط';
const RECORD_SELECT = 'السجل المرتبط';
const ALL_KINDS = 'كل السياقات';
const NEW_DOCUMENT = 'مستند جديد';
const EDIT_DOCUMENT = 'تعديل المستند';
const NOT_FOUND = 'هذا السجل غير متاح أو لم يعد موجودًا.';
const UNSAVED_DIALOG = 'unsaved-changes-dialog';
const ENGLISH_LABELS = ['Department', 'Employee'];

type Kind = { kind: string; label: string };

/** The HR context kinds the API offers the signed-in user, in its order. Other applications add their own kinds. */
async function hrKinds(browser: PageContext): Promise<Kind[]> {
  const answer = await api(browser, 'GET', CONTEXTS);
  const items = answer.body.items as Kind[];
  expect([answer.status, answer.body.total]).toEqual([200, items.length]);
  return items.filter(item => item.kind.startsWith('hr.'));
}

/** The id of the seeded department NAME, from the record options a document manager picks from. */
async function departmentId(browser: PageContext, name: string): Promise<number> {
  const answer = await api(browser, 'GET', `${CONTEXTS}/${DEPARTMENT_KIND}/options?q=${encodeURIComponent(name)}`);
  const found = (answer.body.items as { id: number; name: string }[]).filter(item => item.name === name);
  expect([name, answer.status, found.length]).toEqual([name, 200, 1]);
  return found[0]!.id;
}

/** A document created by the signed-in manager, linked to CONTEXT when one is given. */
async function createDocument(browser: PageContext, name: string, context: { kind: string; id: number } | null): Promise<number> {
  const answer = await api(browser, 'POST', DOCUMENTS, { name, context });
  expect([name, answer.status, answer.body.message]).toEqual([name, 201, undefined]);
  return answer.body.id as number;
}

async function openList({ app, screen }: Stage, path = '/documents') {
  await app.open(path);
  await expect(screen.getByRole('heading', { level: 1, name: 'المستندات' })).toBeVisible(slow);
}

test('[DOC-53] the contexts list names the HR kinds in Arabic and offers each one only to its holder', {
  tags: ['documents'], timeout: 300_000, session: 'hr_manager', skip: ODOO_ONLY,
}, async ({ app, screen, browser }) => {
  const stage = { app, screen, browser };
  await openList(stage);
  expect(await hrKinds(browser)).toEqual([{ kind: DEPARTMENT_KIND, label: DEPARTMENT_LABEL }, { kind: EMPLOYEE_KIND, label: EMPLOYEE_LABEL }]);

  // The form offers the same kinds under the same names.
  await browser.goto('/documents/new', { waitUntil: 'domcontentloaded' });
  const panel = screen.getByRole('dialog', NEW_DOCUMENT);
  await panel.getByRole('combobox', KIND_SELECT).tap();
  await expect(screen.getByRole('option', DEPARTMENT_LABEL)).toBeVisible(slow);
  await expect(screen.getByRole('option', EMPLOYEE_LABEL)).toBeVisible(slow);
  for (const english of ENGLISH_LABELS) await expect(screen.getByRole('option', english)).toHaveCount(0, slow);

  // An employee reads departments and manages no employee: the department kind only.
  await signInAs('staff1', stage);
  const capabilities = (await api(browser, 'GET', '/api/v1/me')).body.capabilities as string[];
  expect(['hr.departments.read', 'hr.employees.manage'].map(key => capabilities.includes(key))).toEqual([true, false]);
  expect(await hrKinds(browser)).toEqual([{ kind: DEPARTMENT_KIND, label: DEPARTMENT_LABEL }]);

  // Without the right to read documents there is no list at all.
  await signInAs('no_roles', stage);
  const refused = await api(browser, 'GET', CONTEXTS);
  expect([refused.status, refused.body.code]).toEqual([403, 'forbidden']);
});

test('[DOC-30] the context filter narrows the list to one record, and a reader without manage gets no selects', {
  tags: ['documents'], timeout: 600_000, session: 'hr_manager', skip: ODOO_ONLY,
}, async ({ app, screen, browser }) => {
  const stage = { app, screen, browser };
  await openList(stage);
  const stamp = Date.now().toString(36);
  const department = await departmentId(browser, HR_DEPARTMENT);
  const names = { linked: `مستند قسم ${stamp}`, free: `مستند بلا سياق ${stamp}` };
  await createDocument(browser, names.linked, { kind: DEPARTMENT_KIND, id: department });
  await createDocument(browser, names.free, null);

  await browser.goto(`/documents?q=${stamp}`, { waitUntil: 'domcontentloaded' });
  await expect(screen.getByRole('link', names.linked)).toBeVisible(slow);
  await expect(screen.getByRole('link', names.free)).toBeVisible(slow);
  await expect(screen.getByRole('combobox', RECORD_SELECT)).toHaveCount(0, slow);

  await expect(screen.getByRole('combobox', KIND_SELECT)).toContainText(ALL_KINDS, slow);
  await screen.getByRole('combobox', KIND_SELECT).tap();
  await expect(screen.getByRole('option', EMPLOYEE_LABEL)).toBeVisible(slow);
  for (const english of ENGLISH_LABELS) await expect(screen.getByRole('option', english)).toHaveCount(0, slow);
  await screen.getByRole('option', DEPARTMENT_LABEL).tap();
  await expect(browser).toHaveURL(/[?&]context_kind=hr\.department(&|$)/, slow);

  await screen.getByRole('combobox', RECORD_SELECT).tap();
  await screen.getByRole('option', HR_DEPARTMENT).tap();
  await expect(browser).toHaveURL(new RegExp(`[?&]context_id=${department}(&|$)`), slow);
  await expect(screen.getByRole('link', names.linked)).toBeVisible(slow);
  await expect(screen.getByRole('link', names.free)).toHaveCount(0, slow);

  // The filter is in the URL: a refresh keeps both selects and the narrowed list.
  await browser.reload();
  await expect(screen.getByRole('combobox', KIND_SELECT)).toContainText(DEPARTMENT_LABEL, slow);
  await expect(screen.getByRole('combobox', RECORD_SELECT)).toContainText(HR_DEPARTMENT, slow);
  await expect(screen.getByRole('link', names.linked)).toBeVisible(slow);
  await expect(screen.getByRole('link', names.free)).toHaveCount(0, slow);

  await signInAs('staff1', stage);
  const options = await api(browser, 'GET', `${CONTEXTS}/${DEPARTMENT_KIND}/options`);
  expect([options.status, options.body.code]).toEqual([403, 'forbidden']);
  for (const path of ['/documents', `/documents?context_kind=${DEPARTMENT_KIND}&context_id=${department}`]) {
    await browser.goto(path, { waitUntil: 'domcontentloaded' });
    await expect(screen.getByTestId('documents-visibility-filter')).toBeVisible(slow);
    await expect(screen.getByRole('combobox', KIND_SELECT)).toHaveCount(0, slow);
    await expect(screen.getByRole('combobox', RECORD_SELECT)).toHaveCount(0, slow);
  }
});

test('[DOC-34] the create panel carries the list state, and an untouched form leaves without the unsaved-changes dialog', {
  tags: ['documents'], timeout: 600_000, session: 'hr_manager', skip: ODOO_ONLY,
}, async ({ app, screen, browser }) => {
  const stage = { app, screen, browser };
  await openList(stage);
  const stamp = Date.now().toString(36);
  const department = await departmentId(browser, HR_DEPARTMENT);
  const state = `q=${stamp}&visibility=restricted&context_kind=${DEPARTMENT_KIND}&context_id=${department}`;
  const listUrl = new RegExp(`/documents\\?(?=.*q=${stamp})(?=.*visibility=restricted)(?=.*context_kind=hr\\.department)(?=.*context_id=${department}(&|$))`);
  const panelUrl = new RegExp(`/documents/new\\?(?=.*q=${stamp})(?=.*visibility=restricted)(?=.*context_kind=hr\\.department)(?=.*context_id=${department}(&|$))`);
  const panel = screen.getByRole('dialog', NEW_DOCUMENT);

  async function openPanel() {
    await screen.getByTestId('document-new').tap();
    await expect(browser).toHaveURL(panelUrl, slow);
    await expect(panel.getByRole('heading', { level: 1, name: NEW_DOCUMENT })).toBeVisible(slow);
    // The list's context arrives preselected, and that alone is not a change.
    await expect(panel.getByRole('combobox', KIND_SELECT)).toContainText(DEPARTMENT_LABEL, slow);
    await expect(panel.getByRole('button', 'إنشاء المستند')).toBeEnabled(slow);
  }
  async function expectBackOnList() {
    await expect(browser).toHaveURL(listUrl, slow);
    await expect(screen.getByTestId(UNSAVED_DIALOG)).toHaveCount(0, slow);
    await expect(screen.getByRole('combobox', RECORD_SELECT)).toContainText(HR_DEPARTMENT, slow);
  }

  await browser.goto(`/documents?${state}`, { waitUntil: 'domcontentloaded' });
  await expect(screen.getByRole('combobox', RECORD_SELECT)).toContainText(HR_DEPARTMENT, slow);

  await openPanel();
  await panel.getByRole('link', 'إلغاء').tap();
  await expectBackOnList();

  await openPanel();
  await panel.getByRole('button', 'إغلاق').tap();
  await expectBackOnList();

  await openPanel();
  await panel.press('Escape');
  await expectBackOnList();

  // The same exit on a touched form does ask, so the three silent exits above are not a missing guard.
  await openPanel();
  await panel.getByLabel('العنوان').fill(`مسودة ${stamp}`);
  await panel.getByRole('link', 'إلغاء').tap();
  await expect(screen.getByTestId(UNSAVED_DIALOG)).toBeVisible(slow);
  await expect(browser).toHaveURL(panelUrl, slow);
  await screen.getByTestId(UNSAVED_DIALOG).getByRole('button', 'المغادرة بدون حفظ').tap();
  await expectBackOnList();
});

test('[DOC-61] the edit page of an unknown or a non-numeric document id shows the not-found state', {
  tags: ['documents'], timeout: 300_000, session: 'hr_manager', skip: ODOO_ONLY,
}, async ({ app, screen, browser }) => {
  await openList({ app, screen, browser });
  const missing = await api(browser, 'GET', `${DOCUMENTS}/999999`);
  expect([missing.status, missing.body.code]).toEqual([404, 'not_found']);

  for (const id of ['999999', 'abc']) {
    await browser.goto(`/documents/${id}/edit`, { waitUntil: 'domcontentloaded' });
    await expect(screen.getByRole('heading', { level: 1, name: EDIT_DOCUMENT })).toBeVisible(slow);
    await expect(screen.getByText(NOT_FOUND)).toBeVisible(slow);
    await expect(screen.getByRole('button', 'حفظ التغييرات')).toHaveCount(0, slow);
    await expect(screen.getByLabel('العنوان')).toHaveCount(0, slow);
  }
});
