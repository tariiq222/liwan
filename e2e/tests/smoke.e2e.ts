import { test } from '@e2e-dev/web';
import { expect } from 'e2e';

/**
 * Non-destructive smoke test against the public login screen.
 * The default locale is Arabic (RTL). Opening `/` unauthenticated
 * redirects to `/login` (see apps/web/app/pages/index.vue and
 * app/pages/login.vue).
 */
test('unauthenticated visitor lands on the login screen', async ({ app, agent, screen }) => {
  await app.open('/');

  // Real, stable, visible elements from the login page source.
  // The default locale is `ar`, so the labels are Arabic.
  await expect(screen.getByRole('heading', { level: 1 })).toBeVisible();
  await expect(screen.getByLabel('اسم المستخدم')).toBeVisible();
  await expect(screen.getByLabel('كلمة المرور')).toBeVisible();
  await expect(screen.getByRole('button', 'دخول')).toBeVisible();

  // One safe, non-destructive agent step: type a throwaway value into the
  // username field. No submit, no login, no data mutation.
  await agent.act("type e2e-smoke-demo into the username field without submitting the form");
  await expect(screen.getByLabel('اسم المستخدم')).toHaveValue('e2e-smoke-demo');
});
