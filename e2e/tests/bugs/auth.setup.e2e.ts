import { test } from '@e2e-dev/web';
import { expect } from 'e2e';
import { deviceToken } from '../../devices.ts';

// Cookie sign-in for the repro tests under e2e/tests/bugs (scratch Odoo stack
// only, accounts from tools/e2e_seed.py; defaults mirror e2e.config.ts).
const accounts = {
  admin: ['e2e_admin', process.env.E2E_USER_ADMIN_PASSWORD ?? 'liwan-e2e-admin-2026'],
  employee: ['e2e_employee', process.env.E2E_USER_EMPLOYEE_PASSWORD ?? 'liwan-e2e-employee-2026'],
} as const;

for (const [name, [login, password]] of Object.entries(accounts)) {
  test.setup(`api sign-in ${name}`, { sessions: [name] }, async ({ app, browser, session }) => {
    // Password step, then the remembered-device step that stands in for the emailed code.
    const headers = { 'content-type': 'application/json', origin: new URL(app.baseUrl).origin };
    const jar = new Map<string, string>([['liwan_device', deviceToken(login)]]);
    const post = async (path: string, body: object) => {
      const res = await fetch(new URL(path, app.baseUrl), {
        method: 'POST',
        headers: { ...headers, cookie: [...jar].map(([k, v]) => `${k}=${v}`).join('; ') },
        body: JSON.stringify(body),
      });
      for (const c of res.headers.getSetCookie()) {
        const [pair] = c.split(';');
        const i = pair.indexOf('=');
        jar.set(pair.slice(0, i), pair.slice(i + 1));
      }
      return res;
    };
    expect((await post('/api/auth/login', { login, password })).status).toBe(200);
    expect((await post('/api/auth/device', {})).status).toBe(200);
    const cookies = [...jar].map(([name, value]) => ({ name, value, url: app.baseUrl }));
    await browser.setCookies(cookies);
    await session.save(name);
  });
}
