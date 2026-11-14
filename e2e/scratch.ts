import type { Browser, WebApp } from '@e2e-dev/web';
import { credentials, expect, type TestFixtures } from 'e2e';
import { deviceToken } from './devices.ts';

/**
 * What the register tests on the scratch Odoo stack (`npm run e2e:odoo`) share: the declaration option
 * that skips them on any other stack, API calls through the signed-in page, and a change of persona
 * inside one test. Personas come from tools/e2e_seed.py.
 */
export const slow = { timeout: 30_000 };
export const ODOO_ONLY = process.env.E2E_STACK !== 'odoo' ? 'needs the scratch Odoo stack (npm run e2e:odoo)' : false;

export type Json = Record<string, unknown>;
export type Answer = { status: number; body: Json };
export type Persona = Parameters<typeof credentials.user>[0];
export type Stage = { app: WebApp; screen: TestFixtures['screen']; browser: Browser };
/** The part of the browser an API call needs. */
export type PageContext = { evaluate<T, A>(fn: (arg: A) => T | Promise<T>, arg: A): Promise<T> };

/** One API call from the page, so it carries the persona's session cookie: the status and the JSON body, never a thrown error on 4xx. */
export function api(browser: PageContext, method: string, path: string, payload?: Json): Promise<Answer> {
  return browser.evaluate(async ([verb, target, body]) => {
    const response = await fetch(target as string, {
      method: verb as string,
      headers: body ? { 'content-type': 'application/json' } : undefined,
      body: body ? JSON.stringify(body) : undefined,
    });
    return { status: response.status, body: await response.json().catch(() => ({})) };
  }, [method, path, payload ?? null]) as Promise<Answer>;
}

/** Replace the current session with PERSONA's: the remembered-device cookie passes the second sign-in step. */
export async function signInAs(persona: Persona, { app, screen, browser }: Stage) {
  const user = credentials.user(persona);
  await app.clearState();
  await app.open('/login');
  await browser.setCookies([{ url: '/', name: 'liwan_device', value: deviceToken(user.username), httpOnly: true, sameSite: 'Lax' }]);
  await screen.getByLabel('اسم المستخدم').fill(user.username);
  await screen.getByLabel('كلمة المرور').fill(user.password);
  await screen.getByRole('button', 'دخول').tap();
  await expect(browser).toHaveURL(/localhost:\d+\/(?!login)/, { timeout: 60_000 });
  const me = await api(browser, 'GET', '/api/v1/me');
  expect((me.body.user as Json | undefined)?.login ?? me.body.login).toBe(user.username);
}
