import type { PoolClient } from 'pg'
import { hashToken, newToken } from './crypto.js'
import { AdminAuthError } from './accounts.js'

export const IDLE_MS = 30 * 60_000
export const ABSOLUTE_MS = 12 * 3600_000
export const STEP_UP_MS = 5 * 60_000

export function parseSession(value: unknown): { accountId: number; token: string } | null {
  if (typeof value !== 'string') return null
  const match = /^([1-9][0-9]{0,15})\.([A-Za-z0-9_-]{43})$/.exec(value)
  if (!match) return null
  const accountId = Number(match[1])
  return Number.isSafeInteger(accountId) ? { accountId, token: match[2] } : null
}
export async function createSession(client: PoolClient, accountId: number, now: Date, stepUp: boolean) {
  const token = newToken()
  const expiresAt = new Date(now.getTime() + ABSOLUTE_MS)
  await client.query('INSERT INTO vendor_sessions(token_hash,account_id,created_at,last_seen_at,expires_at,step_up_at) VALUES($1,$2,$3,$3,$4,$5)', [hashToken(token), accountId, now, expiresAt, stepUp ? now : null])
  return { session: `${accountId}.${token}`, expiresAt, idleExpiresAt: new Date(Math.min(now.getTime() + IDLE_MS, expiresAt.getTime())) }
}
export async function resolveSession(client: PoolClient, value: unknown, now: Date) {
  const parsed = parseSession(value)
  if (!parsed) throw new AdminAuthError(401, 'auth_failed')
  const tokenHash = hashToken(parsed.token)
  const row = await client.query(`SELECT s.account_id, s.expires_at, s.last_seen_at, s.step_up_at FROM vendor_sessions s JOIN vendor_accounts a ON a.id=s.account_id
    WHERE s.token_hash=$1 AND s.revoked_at IS NULL AND a.status='active' FOR UPDATE OF s`, [tokenHash])
  const s = row.rows[0]
  if (!s || Number(s.account_id) !== parsed.accountId || now >= new Date(s.expires_at) || now.getTime() - new Date(s.last_seen_at).getTime() >= IDLE_MS) throw new AdminAuthError(401, 'auth_failed')
  await client.query('UPDATE vendor_sessions SET last_seen_at=$2 WHERE token_hash=$1', [tokenHash, now])
  return { accountId: parsed.accountId, tokenHash, stepUpFresh: Boolean(s.step_up_at) && now.getTime() - new Date(s.step_up_at).getTime() < STEP_UP_MS }
}
export async function markStepUp(client: PoolClient, tokenHash: string, now: Date) {
  await client.query('UPDATE vendor_sessions SET step_up_at=$2 WHERE token_hash=$1 AND revoked_at IS NULL', [tokenHash, now])
}
export async function revokeSession(client: PoolClient, tokenHash: string) {
  await client.query('UPDATE vendor_sessions SET revoked_at=now() WHERE token_hash=$1 AND revoked_at IS NULL', [tokenHash])
}
