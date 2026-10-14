import { test, expect, type Page, type APIResponse } from '@playwright/test';
import { readFileSync } from 'node:fs';
test.skip(process.env.E2E_REAL_ODOO !== '1', 'Explicit isolated real Odoo acceptance only');
test.beforeEach(async ({}, info) => { const origin = new URL(String(info.project.use.baseURL)); expect(origin.hostname).toBe('localhost'); expect(origin.port).toBe('44300'); });
const fixture = process.env.E2E_REAL_ODOO === '1' ? JSON.parse(readFileSync(new URL('../../../.superpowers/real-odoo/fixtures.json', import.meta.url), 'utf8')) : {};
async function body(response: APIResponse, status = 200) { expect(response.status(), await response.text()).toBe(status); return response.json(); }
async function login(page: Page, reader = false) { await body(await page.request.post('/api/auth/login', { data: { login: reader ? 'e2e_employee' : 'e2e_admin', password: reader ? (process.env.E2E_USER_EMPLOYEE_PASSWORD ?? process.env.E2E_EMPLOYEE_PASSWORD ?? 'nasq-e2e-employee-2026') : (process.env.E2E_USER_ADMIN_PASSWORD ?? process.env.E2E_ADMIN_PASSWORD ?? 'nasq-e2e-admin-2026') } })); }
async function open(page: Page, path: string) { await page.goto(path); await expect(page.getByTestId('global-search-trigger')).toBeEnabled(); await expect(page.locator('main')).toBeVisible(); }
async function project(page: Page) { return body(await page.request.post('/api/v1/projects', { data: { name: `تحقق حقيقي ${Date.now()}`, date_end: '2030-12-31' } }), 201); }
test('real login form rejects invalid credentials then loads a real capability identity', async ({ page }) => {
    await page.goto('/login');
    await page.getByLabel('اسم المستخدم').fill('e2e_admin');
    await page.getByLabel('كلمة المرور').fill('invalid-scratch-password');
    let response = page.waitForResponse(r => r.url().endsWith('/api/auth/login') && r.request().method() === 'POST');
    await page.getByRole('button', { name: 'دخول', exact: true }).click();
    expect((await response).status()).toBe(401);
    await expect(page.getByText('بيانات الدخول غير صحيحة')).toBeVisible();
    await page.getByLabel('كلمة المرور').fill(process.env.E2E_USER_ADMIN_PASSWORD ?? process.env.E2E_ADMIN_PASSWORD ?? 'nasq-e2e-admin-2026');
    response = page.waitForResponse(r => r.url().endsWith('/api/auth/login') && r.request().method() === 'POST');
    await page.getByRole('button', { name: 'دخول', exact: true }).click();
    expect((await response).status()).toBe(200);
    await expect(page.getByTestId('global-search-trigger')).toBeEnabled();
    const me = await body(await page.request.get('/api/v1/me'));
    expect(me.company.id).toBe(fixture.company);
    expect(me.capabilities).toContain('hr.employees.manage');
});
for (const path of ['/projects', '/projects/dashboard', '/tasks', '/project-templates', '/hr', '/hr/departments', '/hr/documents', '/meetings', '/meetings/series', '/meetings/calendar', '/chat', '/account', '/projects/settings', '/settings/users', '/settings/roles', '/settings/branding', '/operations']) {
    test(`real backend renders ${path} without server failures`, async ({ page }) => {
        await login(page);
        const failures: string[] = [];
        page.on('response', r => {
            if (new URL(r.url()).pathname.startsWith('/api/') && r.status() >= 500)
                failures.push(`${r.status()} ${new URL(r.url()).pathname}`);
        });
        await open(page, path);
        await expect(page.getByRole('heading', { level: 1 })).toHaveCount(1);
        await page.waitForLoadState('networkidle');
        await expect(page.locator('main')).not.toContainText('حدث خطأ');
        await expect.poll(() => failures).toEqual([]);
        expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    });
}
test('employee edit saves in Odoo and survives refresh with the department', async ({ page }) => { await login(page); await open(page, `/hr/employees/${fixture.employee}/edit`); const name = `موظف معدل ${Date.now()}`; await page.locator('#hr-employee-name').fill(name); const saved = page.waitForResponse(r => new URL(r.url()).pathname === `/api/v1/hr/employees/${fixture.employee}` && r.request().method() === 'PATCH'); await page.getByRole('button', { name: 'حفظ', exact: true }).click(); await body(await saved); await expect(page).not.toHaveURL(/\/edit/); await page.reload(); await expect(page.getByRole('heading', { level: 1 })).toContainText(name); const data = await body(await page.request.get(`/api/v1/hr/employees/${fixture.employee}`)); expect(data.name).toBe(name); expect(data.department.id).toBe(fixture.department); });
test('department create and edit persist through the real API', async ({ page }) => { await login(page); await open(page, '/hr/departments/new'); const dialog = page.getByRole('dialog'); const name = `قسم جديد ${Date.now()}`; await dialog.locator('#hr-dept-name').fill(name); const created = page.waitForResponse(r => new URL(r.url()).pathname === '/api/v1/hr/departments' && r.request().method() === 'POST'); await dialog.getByRole('button', { name: 'حفظ', exact: true }).click(); const department = await body(await created, 201); await open(page, `/hr/departments/${department.id}/edit`); await page.locator('#hr-dept-name').fill(`${name} معدل`); const saved = page.waitForResponse(r => new URL(r.url()).pathname === `/api/v1/hr/departments/${department.id}` && r.request().method() === 'PATCH'); await page.getByRole('button', { name: 'حفظ', exact: true }).click(); await body(await saved); await expect(page).not.toHaveURL(/\/edit/); await page.reload(); await expect(page.getByRole('heading', { level: 1 })).toContainText(`${name} معدل`); });
test('task edit, real attachment download, inline deletion and refresh', async ({ page }) => { await login(page); const p = await project(page); const task = await body(await page.request.post('/api/v1/tasks', { data: { project_id: p.id, name: `مهمة تحقق ${Date.now()}`, user_ids: [fixture.admin] } }), 201); await open(page, `/tasks/${task.id}`); await page.getByTestId('task-title-edit').click(); const name = `مهمة معدلة ${Date.now()}`; const title = page.getByRole('textbox', { name: 'عنوان المهمة', exact: true }); await title.fill(name); const saved = page.waitForResponse(r => new URL(r.url()).pathname === `/api/v1/tasks/${task.id}` && r.request().method() === 'PATCH'); await title.press('Enter'); await body(await saved); await page.reload(); await expect(page.getByRole('heading', { level: 1 })).toHaveText(name); await page.getByTestId('task-detail-tabs').getByRole('tab', { name: 'المرفقات', exact: true }).click(); const section = page.getByTestId('task-attachments'); const content = Buffer.from('%PDF-1.7\nScratch real file\n'); const filename = `scratch-${Date.now()}.pdf`; const uploaded = page.waitForResponse(r => new URL(r.url()).pathname === `/api/v1/tasks/${task.id}/attachments` && r.request().method() === 'POST'); await section.locator('input[type=file]').setInputFiles({ name: filename, mimeType: 'application/pdf', buffer: content }); await body(await uploaded, 201); const link = section.getByRole('link', { name: filename }); await expect(link).toBeVisible(); const download = await page.request.get((await link.getAttribute('href'))!); expect(download.status()).toBe(200); expect(await download.body()).toEqual(content); await section.getByRole('button', { name: 'حذف المرفق' }).click(); await section.getByRole('button', { name: 'إلغاء', exact: true }).click(); await expect(link).toBeVisible(); await section.getByRole('button', { name: 'حذف المرفق' }).click(); const deleted = page.waitForResponse(r => r.url().includes(`/api/v1/tasks/${task.id}/attachments/`) && r.request().method() === 'DELETE'); await section.getByRole('button', { name: 'تأكيد الحذف' }).click(); expect((await deleted).status()).toBe(204); await expect(link).toHaveCount(0); });
test('finance budget create, record edit and list return use real stored values', async ({ page }) => {
    await login(page);
    const p = await project(page);
    const origin = `/projects/${p.id}/finance?kind=budget#ledger`;
    await open(page, `/projects/${p.id}/finance/new?kind=budget&returnTo=${encodeURIComponent(origin)}`);
    const dialog = page.getByRole('dialog');
    const title = `ميزانية فعلية ${Date.now()}`;
    await dialog.locator('#finance-title').fill(title);
    await dialog.locator('#finance-amount').fill('1200');
    const created = page.waitForResponse(r => new URL(r.url()).pathname === `/api/v1/projects/${p.id}/finance` && r.request().method() === 'POST');
    await dialog.getByRole('button', { name: 'إنشاء', exact: true }).click();
    const entry = await body(await created, 201);
    await expect.poll(() => new URL(page.url()).pathname).toBe(`/projects/${p.id}/finance`);
    expect(new URL(page.url()).hash).toBe('#ledger');
    await expect(page.getByRole('link', { name: title, exact: true })).toBeVisible();
    await open(page, `/projects/${p.id}/finance/${entry.id}/edit?returnTo=${encodeURIComponent(origin)}`);
    await page.locator('#finance-amount').fill('1500');
    const saved = page.waitForResponse(r => new URL(r.url()).pathname === `/api/v1/projects/${p.id}/finance/${entry.id}` && r.request().method() === 'PATCH');
    await page.getByRole('button', { name: 'حفظ', exact: true }).click();
    await body(await saved);
    const list = await body(await page.request.get(`/api/v1/projects/${p.id}/finance`));
    expect(list.items.find((e: any) => e.id === entry.id).amount).toBe(1500);
    await expect(page).not.toHaveURL(/\/edit/);
    await page.reload();
    await expect(page.locator('main')).toContainText('1500.00');
});
test('project template create applies through Odoo and its tasks render on direct refresh', async ({ page }) => {
    await login(page);
    await open(page, '/project-templates/new');
    const dialog = page.getByRole('dialog');
    const name = `قالب حقيقي ${Date.now()}`;
    await dialog.locator('[name=template-name]').fill(name);
    await dialog.locator('#stage-name-0').fill('التنفيذ');
    const taskName = `مهمة القالب ${Date.now()}`;
    await dialog.getByRole('button', { name: 'إضافة مهمة', exact: true }).click();
    await dialog.locator('#task-name-0').fill(taskName);
    const created = page.waitForResponse(r => new URL(r.url()).pathname === '/api/v1/project-templates' && r.request().method() === 'POST');
    await dialog.getByRole('button', { name: 'حفظ', exact: true }).click();
    const template = await body(await created, 201);
    await expect(page).toHaveURL(new RegExp(`/project-templates/${template.id}`));
    await page.reload();
    await expect(page.getByRole('heading', { level: 1 })).toHaveText(name);
    const applied = await body(await page.request.post(`/api/v1/project-templates/${template.id}/apply`, { data: { name: `مشروع ${name}`, start_date: '2030-05-01' } }), 201);
    const tasks = await body(await page.request.get(`/api/v1/tasks?project_id=${applied.id}`));
    expect(tasks.items).toHaveLength(1);
    expect(tasks.items[0].name).toBe(taskName);
    await open(page, `/projects/${applied.id}/tasks?view=board`);
    await expect(page.locator('main')).toContainText(taskName);
    await expect(page.getByTestId('project-workspace-name')).toContainText(`مشروع ${name}`);
    await page.reload();
    await expect(page.getByTestId('project-workspace-name')).toContainText(`مشروع ${name}`);
    await expect(page.locator('main')).toContainText(taskName);
});
test('real record permissions reject HR writes for the employee while read UI remains usable', async ({ page }) => {
    await login(page, true);
    const me = await body(await page.request.get('/api/v1/me'));
    expect(me.capabilities).toContain('hr.employees.read');
    expect(me.capabilities).not.toContain('hr.employees.manage');
    await open(page, `/hr/employees/${fixture.employee}`);
    await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
    expect((await page.request.patch(`/api/v1/hr/employees/${fixture.employee}`, { data: { name: 'forbidden' } })).status()).toBe(403);
    await expect(page.getByRole('link', { name: 'تعديل', exact: true })).toHaveCount(0);
    expect((await page.request.get(`/api/v1/hr/employees/${fixture.employee}`)).status()).toBe(200);
});
test('real project task context survives finance roundtrip and refresh', async ({ page }) => {
    await login(page);
    const p = await project(page);
    const title = `مهام سياق ${Date.now()}`;
    await body(await page.request.post('/api/v1/tasks', { data: { project_id: p.id, name: title, user_ids: [fixture.admin] } }), 201);
    const path = `/projects/${p.id}/tasks?view=board&q=${encodeURIComponent(title)}#tasks`;
    await open(page, path);
    await expect(page.locator('main')).toContainText(title);
    await page.getByRole('navigation', { name: 'أقسام المشروع' }).getByRole('link', { name: 'المالية', exact: true }).click();
    await expect(page).toHaveURL(new RegExp(`/projects/${p.id}/finance`));
    await page.getByRole('navigation', { name: 'أقسام المشروع' }).getByRole('link', { name: 'المهام', exact: true }).click();
    await expect.poll(() => new URL(page.url()).searchParams.get('view')).toBe('board');
    expect(new URL(page.url()).searchParams.get('q')).toBe(title);
    await page.reload();
    await expect(page.locator('main')).toContainText(title);
});
for (const path of ['/projects', '/hr', '/hr/documents', '/meetings', '/meetings/calendar', '/chat']) {
    test(`real phone UI fits ${path}`, async ({ page }) => { await page.setViewportSize({ width: 390, height: 844 }); await login(page); await open(page, path); await page.waitForLoadState('networkidle'); expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true); await expect(page.getByRole('heading', { level: 1 })).toHaveCount(1); });
}
test('real chat message arrives in another logged-in browser without refresh', async ({ page, browser }) => {
    await login(page);
    const conversation = await body(await page.request.post('/api/v1/chat/conversations', { data: { user_ids: [fixture.reader] } }), 201);
    const peerContext = await browser.newContext({ baseURL: 'http://localhost:44300', locale: 'ar-SA' });
    try {
        const peer = await peerContext.newPage();
        await login(peer, true);
        await open(peer, `/chat/${conversation.id}`);
        await expect(peer.getByTestId('chat-thread')).toBeVisible();
        await expect(peer.getByRole('status', { name: 'متصل', exact: true })).toBeVisible();
        const message = `رسالة لحظية ${Date.now()}`;
        const sentMessage = await body(await page.request.post(`/api/v1/chat/conversations/${conversation.id}/messages`, { data: { body: message } }), 201);
        const received = peer.getByTestId('chat-thread').locator(`[data-message-id="${sentMessage.id}"]`);
        await expect(received).toBeVisible({ timeout: 10000 });
        await expect(received.locator('.nasq-chat-bubble')).toContainText(message);
    }
    finally {
        await peerContext.close();
    }
});
