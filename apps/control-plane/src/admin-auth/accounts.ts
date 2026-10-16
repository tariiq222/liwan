import { randomUUID } from 'node:crypto'
import type { PoolClient } from 'pg'
import { VENDOR_ROLES, type VendorRole } from './roles.js'

export class AdminAuthError extends Error {
  constructor(public status: 401 | 403 | 409 | 422 | 429, public code: 'auth_failed' | 'forbidden' | 'conflict' | 'invalid' | 'rate_limited' | 'last_owner' | 'step_up_required', message: string = code) { super(message) }
}
export function normalizeEmail(raw: string): string {
  const email = String(raw ?? '').trim().toLowerCase()
  if (!/^[^@\s]+@[^@\s]+$/.test(email) || email.length > 254) throw new AdminAuthError(422, 'invalid')
  return email
}
export async function audit(client: PoolClient, actor: string, action: string, subject: string, reason: string): Promise<void> {
  await client.query('INSERT INTO audit_events(id,actor,action,subject,reason) VALUES($1,$2,$3,$4,$5)', [randomUUID(), actor, action, subject, reason])
}
export const actorName = (actor: { id: number } | 'operator'): string => actor === 'operator' ? 'operator' : `account:${actor.id}`
function requireReason(reason: string): string {
  const text = String(reason ?? '').trim()
  if (text.length < 3 || text.length > 1000) throw new AdminAuthError(422, 'invalid', 'reason of 3-1000 characters required')
  return text
}
// Serializes every owner-set change: the advisory lock is taken first, then the owners are read
// in a new statement so it sees changes committed by the previous lock holder (READ COMMITTED).
export async function lockOwners(client: PoolClient): Promise<number[]> {
  await client.query("SELECT pg_advisory_xact_lock(hashtext('nasq-vendor-owners'))")
  const rows = await client.query("SELECT a.id FROM vendor_accounts a JOIN vendor_account_roles r ON r.account_id=a.id AND r.role='owner' WHERE a.status='active' ORDER BY a.id")
  return rows.rows.map((r) => Number(r.id))
}
// A non-operator actor must still be an active owner when the mutation runs (the owner set is locked).
export function requireActingOwner(actor: { id: number } | 'operator', owners: number[]): void {
  if (actor !== 'operator' && !owners.includes(Number(actor.id))) throw new AdminAuthError(403, 'forbidden')
}
export async function setRoles(client: PoolClient, actor: { id: number } | 'operator', accountId: number, roles: VendorRole[], reason: string): Promise<void> {
  const why = requireReason(reason)
  if (!roles.length || roles.some((r) => !VENDOR_ROLES.includes(r)) || new Set(roles).size !== roles.length) throw new AdminAuthError(422, 'invalid')
  const owners = await lockOwners(client)
  requireActingOwner(actor, owners)
  const target = await client.query('SELECT status FROM vendor_accounts WHERE id=$1', [accountId])
  if (!target.rowCount || target.rows[0].status === 'disabled') throw new AdminAuthError(422, 'invalid')
  if (owners.includes(Number(accountId)) && !roles.includes('owner') && owners.length <= 1) throw new AdminAuthError(409, 'last_owner')
  if (actor !== 'operator' && !roles.includes('owner') && Number(actor.id) === Number(accountId) && owners.filter((id) => id !== Number(accountId)).length === 0) throw new AdminAuthError(409, 'last_owner')
  await client.query('DELETE FROM vendor_account_roles WHERE account_id=$1', [accountId])
  for (const role of roles) await client.query('INSERT INTO vendor_account_roles(account_id,role) VALUES($1,$2)', [accountId, role])
  await audit(client, actorName(actor), 'account.roles_set', `account:${accountId}`, `${why} [${roles.join(',')}]`)
}
export async function disableAccount(client: PoolClient, actor: { id: number } | 'operator', accountId: number, reason: string): Promise<void> {
  const why = requireReason(reason)
  const owners = await lockOwners(client)
  requireActingOwner(actor, owners)
  const target = await client.query('SELECT 1 FROM vendor_accounts WHERE id=$1', [accountId])
  if (!target.rowCount) throw new AdminAuthError(422, 'invalid')
  if (owners.includes(Number(accountId)) && owners.length <= 1) throw new AdminAuthError(409, 'last_owner')
  const updated = await client.query("UPDATE vendor_accounts SET status='disabled', disabled_at=now() WHERE id=$1 AND status<>'disabled' RETURNING id", [accountId])
  if (!updated.rowCount) throw new AdminAuthError(422, 'invalid')
  await client.query('UPDATE vendor_sessions SET revoked_at=now() WHERE account_id=$1 AND revoked_at IS NULL', [accountId])
  await client.query('UPDATE vendor_invitations SET consumed_at=now() WHERE account_id=$1 AND consumed_at IS NULL', [accountId])
  await audit(client, actorName(actor), 'account.disabled', `account:${accountId}`, why)
}
