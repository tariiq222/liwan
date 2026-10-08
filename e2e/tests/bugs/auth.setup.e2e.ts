import { test } from '@e2e-dev/web';
import { expect } from 'e2e';

// Cookie sign-in for the repro tests under e2e/tests/bugs (scratch Odoo stack
// only, accounts from tools/e2e_seed.py; defaults mirror e2e.config.ts).
const accounts = {
  admin: ['e2e_admin', process.env.E2E_USER_ADMIN_PASSWORD ?? 'nasq-e2e-admin-2026'],
  employee: ['e2e_employee', process.env.E2E_USER_EMPLOYEE_PASSWORD ?? 'nasq-e2e-employee-2026'],
} as const;

for (const [name, [login, password]] of Object.entries(accounts)) {
  test.setup(`api sign-in ${name}`, { sessions: [name] }, async ({ app, browser, session }) => {
    const res = await fetch(new URL('/api/auth/login', app.baseUrl), {
      method: 'POST',
      headers: { 'content-type': 'application/json', origin: new URL(app.baseUrl).origin },
      body: JSON.stringify({ login, password }),
    });
    expect(res.status).toBe(200);
    const cookies = res.headers.getSetCookie().map((c) => {
      const [pair] = c.split(';');
      const i = pair.indexOf('=');
      return { name: pair.slice(0, i), value: pair.slice(i + 1), url: app.baseUrl };
    });
    await browser.setCookies(cookies);
    await session.save(name);
  });
}
