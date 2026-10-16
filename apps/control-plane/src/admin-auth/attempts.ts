import type { Pool, PoolClient } from 'pg'
import { transaction } from '../db.js'
import { AdminAuthError, audit } from './accounts.js'

const WINDOW_MS = 15 * 60_000
const limitFor = (scope: string) => scope.startsWith('account:') ? 5 : 20

// Reserve-before-verify: every attempt is counted (in autocommit, so parallel requests see each other) before
// credentials are checked. A burst of N requests therefore cannot get more than `limit` verifications through.
// Success refunds the reservation (recordSuccess); a failure keeps it.
// The ip scope is reserved first and the first blocked scope stops the walk, so an attacker locked out by
// address cannot keep raising a victim's account counter.
export async function reserveAttempt(pool: Pool, scopes: string[], now: Date): Promise<void> {
  try {
    await pool.query("DELETE FROM vendor_auth_attempts WHERE window_start < $1::timestamptz - interval '15 minutes' AND (locked_until IS NULL OR locked_until < $1)", [now])
    const ordered = [...scopes].sort((a, b) => Number(b.startsWith('ip:')) - Number(a.startsWith('ip:')))
    for (const scope of ordered) {
      const row = (await pool.query(`INSERT INTO vendor_auth_attempts(scope,window_start,failures) VALUES($1,$2,1)
        ON CONFLICT (scope) DO UPDATE SET
          failures = CASE WHEN vendor_auth_attempts.window_start <= $2::timestamptz - interval '15 minutes' THEN 1 ELSE vendor_auth_attempts.failures + 1 END,
          window_start = CASE WHEN vendor_auth_attempts.window_start <= $2::timestamptz - interval '15 minutes' THEN $2 ELSE vendor_auth_attempts.window_start END
        RETURNING failures, locked_until`, [scope, now])).rows[0]
      if (row.locked_until && new Date(row.locked_until) > now) throw new AdminAuthError(429, 'rate_limited')
      if (Number(row.failures) > limitFor(scope)) {
        const locked = await pool.query('UPDATE vendor_auth_attempts SET locked_until=$2 WHERE scope=$1 AND (locked_until IS NULL OR locked_until <= $3) RETURNING scope', [scope, new Date(now.getTime() + WINDOW_MS), now])
        if (locked.rowCount) await transaction(pool, (c) => audit(c, 'anonymous', 'auth.locked', scope, 'lockout'))
        throw new AdminAuthError(429, 'rate_limited')
      }
    }
  } catch (error) {
    if (error instanceof AdminAuthError) throw error
    // Fail closed: without a reservation nothing may be verified.
    throw new AdminAuthError(401, 'auth_failed')
  }
}
export async function recordSuccess(client: PoolClient, scopes: string[]) {
  await client.query("DELETE FROM vendor_auth_attempts WHERE scope = ANY($1) AND scope LIKE 'account:%'", [scopes])
  await client.query("UPDATE vendor_auth_attempts SET failures = GREATEST(failures - 1, 0) WHERE scope = ANY($1) AND scope NOT LIKE 'account:%'", [scopes])
}
