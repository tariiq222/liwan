import type { PoolClient } from 'pg'
import { AdminAuthError } from './accounts.js'

const WINDOW_MS = 15 * 60_000
const limitFor = (scope: string) => scope.startsWith('account:') ? 5 : 20
export async function checkAllowed(client: PoolClient, scopes: string[], now: Date) {
  const rows = await client.query('SELECT 1 FROM vendor_auth_attempts WHERE scope = ANY($1) AND locked_until > $2', [scopes, now])
  if (rows.rowCount) throw new AdminAuthError(429, 'rate_limited')
}
export async function recordFailure(client: PoolClient, scopes: string[], now: Date) {
  for (const scope of scopes) {
    await client.query(`INSERT INTO vendor_auth_attempts(scope,window_start,failures) VALUES($1,$2,1)
      ON CONFLICT (scope) DO UPDATE SET
        failures = CASE WHEN vendor_auth_attempts.window_start <= $2 - interval '15 minutes' THEN 1 ELSE vendor_auth_attempts.failures + 1 END,
        window_start = CASE WHEN vendor_auth_attempts.window_start <= $2 - interval '15 minutes' THEN $2 ELSE vendor_auth_attempts.window_start END`, [scope, now])
    await client.query('UPDATE vendor_auth_attempts SET locked_until=$3 WHERE scope=$1 AND failures >= $2', [scope, limitFor(scope), new Date(now.getTime() + WINDOW_MS)])
  }
}
export async function recordSuccess(client: PoolClient, scopes: string[]) {
  await client.query("DELETE FROM vendor_auth_attempts WHERE scope = ANY($1) AND scope LIKE 'account:%'", [scopes])
}
