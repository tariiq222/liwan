/**
 * One saved session per seeded persona, so a test starts signed in instead of
 * repeating the login form. The accounts come from tools/e2e_seed.py and are
 * declared once in e2e.config.ts (`credentials.user(key)` in a test).
 *
 * Signing in happens in the body of a setup test: `session.save` keeps the
 * cookies for the rest of the run only, and only a browser target can save one.
 */
import { test } from '@e2e-dev/web';
import { credentials, expect } from 'e2e';
import { PERSONA_KEYS } from '../../e2e/personas.ts';

for (const key of PERSONA_KEYS) {
  test.setup(`sign in as ${key}`, { sessions: [key], timeout: 120_000 }, async ({ app, screen, session, browser }) => {
    const user = credentials.user(key);
    await app.open('/login');
    await screen.getByLabel('اسم المستخدم').fill(user.username);
    await screen.getByLabel('كلمة المرور').fill(user.password);
    await screen.getByRole('button', 'دخول').tap();
    // The password answered 200 or the form stays on /login; assert before saving.
    await expect(browser).toHaveURL(/localhost:\d+\/(?!login)/, { timeout: 60_000 });
    await session.save(key);
  });
}
