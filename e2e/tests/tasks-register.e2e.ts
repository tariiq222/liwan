import { test } from '@e2e-dev/web';
import { credentials, expect } from 'e2e';
import { deviceToken } from '../devices.ts';

/**
 * Personal-tasks register rows against the scratch Odoo stack (`npm run e2e:odoo`).
 * Scenarios TSK-18 and TSK-107 (e2e/scenarios/tasks.md). Personas come from tools/e2e_seed.py;
 * every task name carries a timestamp because the database is reused between runs.
 * API calls go through the signed-in page, so they carry the persona's session cookie.
 */
const slow = { timeout: 30_000 };
const ODOO_ONLY = process.env.E2E_STACK !== 'odoo' ? 'needs the scratch Odoo stack (npm run e2e:odoo)' : false;
const PAGE_SIZE = 50;
const EMPTY_PAGE = 'لا توجد نتائج ظاهرة في هذه الصفحة.';

type Json = Record<string, unknown>;
type Answer = { status: number; body: Json };
type Browser = { evaluate<T, A>(fn: (arg: A) => T | Promise<T>, arg: A): Promise<T> };

/** One API call from the page: the status and the JSON body, never a thrown error on 4xx. */
function api(browser: Browser, method: string, path: string, payload?: Json): Promise<Answer> {
  return browser.evaluate(async ([verb, target, body]) => {
    const response = await fetch(target as string, {
      method: verb as string,
      headers: body ? { 'content-type': 'application/json' } : undefined,
      body: body ? JSON.stringify(body) : undefined,
    });
    return { status: response.status, body: await response.json().catch(() => ({})) };
  }, [method, path, payload ?? null]) as Promise<Answer>;
}

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

  await app.clearState();
  const pm = credentials.user('pm');
  await app.open('/login');
  await browser.setCookies([{ url: '/', name: 'liwan_device', value: deviceToken(pm.username), httpOnly: true, sameSite: 'Lax' }]);
  await screen.getByLabel('اسم المستخدم').fill(pm.username);
  await screen.getByLabel('كلمة المرور').fill(pm.password);
  await screen.getByRole('button', 'دخول').tap();
  await expect(browser).toHaveURL(/localhost:\d+\/(?!login)/, { timeout: 60_000 });
  const me = await api(browser, 'GET', '/api/v1/me');
  expect((me.body.user as Json | undefined)?.login ?? me.body.login).toBe(pm.username);

  for (const path of [`/api/v1/my-tasks/${id}`, `/api/v1/tasks/${id}`, `/api/v1/tasks/${id}/timeline`]) {
    const answer = await api(browser, 'GET', path);
    expect([path, answer.status, answer.body.code]).toEqual([path, 404, 'not_found']);
  }
  const listed = await api(browser, 'GET', `/api/v1/my-tasks?q=${encodeURIComponent(name)}`);
  expect([listed.status, listed.body.total]).toEqual([200, 0]);
});
