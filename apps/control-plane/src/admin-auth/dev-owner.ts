import type { PoolClient } from 'pg'
import { isLoopbackHost } from '../config.js'
import { audit, lockOwners } from './accounts.js'

// Satisfies the active-account CHECK while matching no password: verifyPassword rejects anything that is not an argon2 hash.
const UNUSABLE_PASSWORD_HASH = '!'

/** `admin dev-owner` writes an account without credentials, so it touches only a database on this machine. */
export function assertLoopbackDatabase(databaseUrl: string): void {
  if (!isLoopbackHost(new URL(databaseUrl).hostname)) throw new Error('dev-owner requires CONTROL_DATABASE_URL on a loopback host')
}

/**
 * Development only (`admin dev-owner`): an active owner with no password, passkey or authenticator. A new account is created;
 * an existing one is never re-enabled or altered, it only gets the owner role when it is already active.
 */
export async function ensureDevOwner(client: PoolClient, email: string, displayName: string): Promise<{ id: number; created: boolean }> {
  await lockOwners(client)
  const found = (await client.query('SELECT id, status FROM vendor_accounts WHERE email=$1 FOR UPDATE', [email])).rows[0]
  if (found && found.status !== 'active') throw new Error(`account ${found.id} exists but is ${found.status}; dev-owner does not change it`)
  const id = found
    ? Number(found.id)
    : Number((await client.query("INSERT INTO vendor_accounts(email,display_name,status,password_hash) VALUES($1,$2,'active',$3) RETURNING id", [email, displayName, UNUSABLE_PASSWORD_HASH])).rows[0].id)
  await client.query("INSERT INTO vendor_account_roles(account_id,role) VALUES($1,'owner') ON CONFLICT DO NOTHING", [id])
  await audit(client, 'operator', 'account.dev_owner', `account:${id}`, found ? 'ensured' : 'created')
  return { id, created: !found }
}
