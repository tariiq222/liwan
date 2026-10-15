import { randomUUID } from 'node:crypto'
import type { Pool } from 'pg'
import type { VendorCapability } from '@nasq/commercial-contracts'
import { signServiceRequest } from '@nasq/commercial-contracts/server'
import { transaction } from '../../db.js'
import { createSession } from '../../admin-auth/sessions.js'
import { hashToken } from '../../admin-auth/crypto.js'

export const TEST_KEY = 'test-key-'.repeat(8)

/** Active vendor account + exact membership + session; headers() signs a request as that account. */
export async function vendorSession(pool: Pool, issuer: string, capabilities: readonly VendorCapability[], options: { stepUp?: boolean; key?: string } = {}) {
  const key = options.key ?? TEST_KEY
  return transaction(pool, async (client) => {
    const id = randomUUID()
    const account = await client.query("INSERT INTO vendor_accounts(email,display_name,status) VALUES($1,'Test vendor','active') RETURNING id", [`vendor-${id}@example.test`])
    const accountId = Number(account.rows[0].id)
    await client.query(`INSERT INTO vendor_memberships(issuer,actor_uid,capabilities) VALUES($1,$2,$3)
      ON CONFLICT(issuer,actor_uid) DO UPDATE SET capabilities=EXCLUDED.capabilities, revoked_at=NULL`, [issuer, accountId, [...capabilities]])
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
