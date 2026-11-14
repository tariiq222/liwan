import { readFileSync } from 'node:fs';

/**
 * Sign-in is two-step (an emailed code) and the scratch stack has no mail. tools/e2e_seed.py issues one remembered
 * device per login through the product's own model and writes the tokens to .e2e/devices.json (git-ignored, 0600);
 * a test presents it as the `liwan_device` cookie, the way a returning browser does. Never print the token.
 */
export function deviceToken(login: string): string {
  const file = process.env.E2E_DEVICE_FILE ?? '.e2e/devices.json';
  const token = (JSON.parse(readFileSync(file, 'utf8')) as Record<string, string>)[login];
  if (!token) throw new Error(`${file} holds no remembered device for ${login}; re-run with E2E_ODOO_SEED=1`);
  return token;
}
