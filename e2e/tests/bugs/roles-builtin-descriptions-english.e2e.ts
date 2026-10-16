import { test } from '@e2e-dev/web';
import { expect } from 'e2e';

/**
 * Bug-bash repro (severity low, apps/web + webvue_core data, /settings/roles):
 * built-in role descriptions are the English strings from
 * odoo-addons/webvue_core/data/access_roles.xml, shown unchanged in the Arabic UI
 * next to Arabic role names. Expected: Arabic description in the Arabic locale.
 * Skipped until fixed; run with E2E_BUGS=1 on `npm run e2e:odoo`.
 */
test(
  'built-in role descriptions are localized in the Arabic UI',
  { session: 'admin', tags: ['bug', 'settings'], skip: process.env.E2E_BUGS === '1' ? false : 'known bug: built-in role descriptions render in English' },
  async ({ app, screen }) => {
    test.skip(process.env.E2E_STACK !== 'odoo', 'needs the scratch Odoo stack (npm run e2e:odoo)');
    await app.open('/settings/roles');
    await expect(screen.getByText('مدير النظام').first()).toBeVisible();
    await expect(screen.getByText('System administrator')).not.toBeVisible();
  },
);
