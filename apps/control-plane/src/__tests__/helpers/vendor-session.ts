import { randomUUID } from 'node:crypto'
import type { Pool, PoolClient } from 'pg'
import { signServiceRequest } from '@nasq/commercial-contracts/server'
import { transaction } from '../../db.js'
import { createSession } from '../../admin-auth/sessions.js'
import { hashToken } from '../../admin-auth/crypto.js'
import { vendorActorIssuer } from '../../admin-auth/grants.js'
import type { VendorRole } from '../../admin-auth/roles.js'

export const TEST_KEY = 'test-key-'.repeat(8)

type Db = Pick<Pool | PoolClient, 'query'>
/** An active vendor account holding exactly these roles; `id` pins the account id (shared tests act as account 7 / 8) and is idempotent. */
export async function vendorAccount(db: Db, roles: readonly VendorRole[], id?: number): Promise<number> {
  const email = `vendor-${randomUUID()}@example.test`
  const account = id
    ? await db.query("INSERT INTO vendor_accounts(id,email,display_name,status,password_hash) VALUES($1,$2,'Test vendor','active','hash') ON CONFLICT (id) DO UPDATE SET status='active' RETURNING id", [id, email])
    : await db.query("INSERT INTO vendor_accounts(email,display_name,status,password_hash) VALUES($1,'Test vendor','active','hash') RETURNING id", [email])
  const accountId = Number(account.rows[0].id)
  // Explicit ids must not collide with the ids later auto-inserted accounts receive.
  await db.query("SELECT setval(pg_get_serial_sequence('vendor_accounts','id'), (SELECT max(id) FROM vendor_accounts))")
  await replaceRoles(db, accountId, roles)
  return accountId
}
/** Replaces an account's roles directly, as an owner's role change would. */
export async function replaceRoles(db: Db, accountId: number, roles: readonly VendorRole[]): Promise<void> {
  await db.query('DELETE FROM vendor_account_roles WHERE account_id=$1', [accountId])
  for (const role of roles) await db.query('INSERT INTO vendor_account_roles(account_id,role) VALUES($1,$2)', [accountId, role])
}
/** The actor identity the HTTP layer gives a vendor account on queued rows. */
export const vendorActor = (installationId: string, accountId: number) => ({ issuer: vendorActorIssuer(installationId), actorUid: accountId })

/** Active vendor account with these roles + session; headers() signs a request as that account. */
export async function vendorSession(pool: Pool, issuer: string, roles: readonly VendorRole[], options: { stepUp?: boolean; key?: string } = {}) {
  const key = options.key ?? TEST_KEY
  return transaction(pool, async (client) => {
    const accountId = await vendorAccount(client, roles)
    const { session } = await createSession(client, accountId, new Date(), options.stepUp ?? true)
    return {
      accountId, session,
      headers: (method: string, path: string, body = '', nonce?: string): Record<string, string> => ({
        ...signServiceRequest({ method, path, body, actor: accountId, issuer, key, nonce }),
        'x-nasq-session': session,
      }),
    }
  })
}

// Mock-pool tests: a session value per actor whose vendor_sessions row the mock pool can answer.
const mockTokens = new Map<string, number>()
export function mockSessionHeader(actor: number): string {
  const token = `mock${actor}`.padEnd(43, 'x')
  mockTokens.set(hashToken(token), actor)
  return `${actor}.${token}`
}
/** Answers the session SELECT/UPDATE of resolveSession; returns null for any other statement. */
export function mockSessionQuery(sql: string, params: unknown[] = []): { rowCount: number; rows: Record<string, unknown>[] } | null {
  if (sql.includes('FROM vendor_sessions')) {
    const actor = mockTokens.get(String(params[0]))
    if (actor === undefined) return { rowCount: 0, rows: [] }
    const now = new Date()
    return { rowCount: 1, rows: [{ account_id: String(actor), expires_at: new Date(now.getTime() + 3600_000), last_seen_at: now, step_up_at: now }] }
  }
  if (sql.startsWith('UPDATE vendor_sessions')) return { rowCount: 1, rows: [] }
  return null
}
/** signServiceRequest plus the session header the mock pool recognises. */
export function signMock(args: Parameters<typeof signServiceRequest>[0]): Record<string, string> {
  return { ...signServiceRequest(args), 'x-nasq-session': mockSessionHeader(args.actor as number) }
}
