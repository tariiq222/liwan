import { test } from '@e2e-dev/web';
import { expect } from 'e2e';
import { api, ODOO_ONLY, signInAs, slow, type Json } from '../scratch.ts';

/**
 * Personal-tasks register rows against the scratch Odoo stack (`npm run e2e:odoo`).
 * Scenarios TSK-18, TSK-94 and TSK-107 (e2e/scenarios/tasks.md). Personas come from tools/e2e_seed.py;
 * every task name carries a timestamp because the database is reused between runs.
 * API calls go through the signed-in page, so they carry the persona's session cookie.
 */
const PAGE_SIZE = 50;
const EMPTY_PAGE = 'لا توجد نتائج ظاهرة في هذه الصفحة.';
const CONVERT_ACTION = 'تحويل إلى مهمة مشروع';

test('[TSK-18] an offset past the last page of my tasks jumps to the last page', {
  tags: ['tasks'], timeout: 600_000, session: 'staff1', skip: ODOO_ONLY,
}, async ({ app, screen, browser }) => {
  await app.open('/my-tasks');
  await expect(screen.getByTestId('my-tasks-total')).toBeVisible(slow);

  // Paging needs more than one page of open tasks; add only what the reused database lacks.
  const before = (await api(browser, 'GET', '/api/v1/my-tasks?limit=1')).body.total as number;
  const stamp = Date.now().toString(36);
  for (let index = before; index <= PAGE_SIZE; index++) {
    const created = await api(browser, 'POST', '/api/v1/my-tasks', { name: `مهمة ترقيم ${stamp}-${index}` });
    expect(created.status).toBe(200);
  }
  const total = (await api(browser, 'GET', '/api/v1/my-tasks?limit=1')).body.total as number;
  expect(total).toBeGreaterThan(PAGE_SIZE);
  const pages = Math.ceil(total / PAGE_SIZE);
  const lastOffset = (pages - 1) * PAGE_SIZE;

  await browser.goto(`/my-tasks?offset=${lastOffset + 10 * PAGE_SIZE}`, { waitUntil: 'domcontentloaded' });
  await expect(browser).toHaveURL(new RegExp(`/my-tasks\\?(.*&)?offset=${lastOffset}(&|$)`), slow);
  await expect(screen.getByTestId('shared-pagination').getByText(`صفحة ${pages} من ${pages}`)).toBeVisible(slow);
  await expect(screen.getByTestId('my-tasks-total')).toContainText(String(total), slow);
  await expect(screen.getByText(EMPTY_PAGE)).toHaveCount(0, slow);
});

test('[TSK-107] a personal task of staff1 is not found by pm through any task route', {
  tags: ['tasks'], timeout: 300_000, session: 'staff1', skip: ODOO_ONLY,
}, async ({ app, screen, browser }) => {
  await app.open('/my-tasks');
  await expect(screen.getByTestId('my-tasks-total')).toBeVisible(slow);
  const name = `مهمة خاصة ${Date.now().toString(36)}`;
  const created = await api(browser, 'POST', '/api/v1/my-tasks', { name });
  expect(created.status).toBe(200);
  const id = created.body.id as number;
  // The owner reads it, so a 404 below is about the caller and not a missing record.
  expect((await api(browser, 'GET', `/api/v1/my-tasks/${id}`)).status).toBe(200);

  await signInAs('pm', { app, screen, browser });

  for (const path of [`/api/v1/my-tasks/${id}`, `/api/v1/tasks/${id}`, `/api/v1/tasks/${id}/timeline`]) {
    const answer = await api(browser, 'GET', path);
    expect([path, answer.status, answer.body.code]).toEqual([path, 404, 'not_found']);
  }
  const listed = await api(browser, 'GET', `/api/v1/my-tasks?q=${encodeURIComponent(name)}`);
  expect([listed.status, listed.body.total]).toEqual([200, 0]);
});

test('[TSK-94] a role with the tasks capabilities and no project rights cannot convert a task', {
  tags: ['tasks'], timeout: 300_000, session: 'tasks_only', skip: ODOO_ONLY,
}, async ({ app, screen, browser }) => {
  await app.open('/my-tasks');
  await expect(screen.getByTestId('my-tasks-total')).toBeVisible(slow);
  const created = await api(browser, 'POST', '/api/v1/my-tasks', { name: `مهمة بلا مشاريع ${Date.now().toString(36)}` });
  expect(created.status).toBe(200);
  const id = created.body.id as number;

  const targets = await api(browser, 'GET', '/api/v1/my-tasks/convert-targets');
  expect([targets.status, targets.body.code]).toEqual([403, 'forbidden']);
  // Refused for the missing capability before the project is read: a project id that exists nowhere still answers 403.
  const converted = await api(browser, 'POST', `/api/v1/my-tasks/${id}/convert`, { project_id: 2_000_000_000 });
  expect([converted.status, converted.body.code]).toEqual([403, 'forbidden']);

  const task = await api(browser, 'GET', `/api/v1/my-tasks/${id}`);
  expect([task.status, (task.body.allowed_actions as Json).convert]).toEqual([200, false]);
  await browser.goto(`/my-tasks/${id}`, { waitUntil: 'domcontentloaded' });
  await expect(screen.getByTestId('my-task-detail')).toBeVisible(slow);
  await expect(screen.getByTestId('my-task-convert')).toHaveCount(0, slow);
  await expect(screen.getByText(CONVERT_ACTION)).toHaveCount(0, slow);
});
