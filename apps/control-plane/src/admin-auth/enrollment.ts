import type { PoolClient } from 'pg'
import { hashToken, newRecoveryCodes, newToken, open } from './crypto.js'
import { checkTotp } from './totp.js'
import { hashPassword, passwordAcceptable } from './passwords.js'
import { actorName, AdminAuthError, audit, normalizeEmail, setRoles, syncMembership } from './accounts.js'
import type { VendorRole } from './roles.js'

const DAY = 24 * 3600_000

export async function inviteAccount(client: PoolClient, issuer: string, actor: { id: number } | 'operator', input: { email: string; displayName: string; roles: VendorRole[]; reason: string }, now: Date) {
  const email = normalizeEmail(input.email)
  const name = String(input.displayName ?? '').trim()
  if (!name || name.length > 120) throw new AdminAuthError(422, 'invalid')
  const inserted = await client.query('INSERT INTO vendor_accounts(email,display_name) VALUES($1,$2) ON CONFLICT (email) DO NOTHING RETURNING id', [email, name])
  if (!inserted.rowCount) throw new AdminAuthError(409, 'conflict')
  const accountId = Number(inserted.rows[0].id)
  await setRoles(client, issuer, actor, accountId, input.roles, input.reason)
  const token = newToken(); const expiresAt = new Date(now.getTime() + DAY)
  await client.query("INSERT INTO vendor_invitations(token_hash,account_id,purpose,created_by,expires_at,created_at) VALUES($1,$2,'enroll',$3,$4,$5)", [hashToken(token), accountId, actorName(actor), expiresAt, now])
  await audit(client, actorName(actor), 'account.invited', `account:${accountId}`, input.reason)
  return { token, expiresAt }
}

export async function issueReset(client: PoolClient, actor: { id: number } | 'operator', accountId: number, reason: string, now: Date) {
  const account = await client.query("SELECT id FROM vendor_accounts WHERE id=$1 AND status<>'disabled' FOR UPDATE", [accountId])
  if (!account.rowCount) throw new AdminAuthError(422, 'invalid')
  await client.query('UPDATE vendor_invitations SET consumed_at=$2 WHERE account_id=$1 AND consumed_at IS NULL', [accountId, now])
  const token = newToken(); const expiresAt = new Date(now.getTime() + DAY)
  await client.query("INSERT INTO vendor_invitations(token_hash,account_id,purpose,created_by,expires_at,created_at) VALUES($1,$2,'reset',$3,$4,$5)", [hashToken(token), accountId, actorName(actor), expiresAt, now])
  await audit(client, actorName(actor), 'account.reset_issued', `account:${accountId}`, reason)
  return { token, expiresAt }
}

export async function openInvitation(client: PoolClient, token: string, now: Date) {
  const row = await client.query('SELECT i.account_id, i.purpose, i.expires_at, i.consumed_at, a.email, a.status FROM vendor_invitations i JOIN vendor_accounts a ON a.id=i.account_id WHERE i.token_hash=$1 FOR UPDATE OF i', [hashToken(String(token ?? ''))])
  const inv = row.rows[0]
  if (!inv || inv.consumed_at || inv.status === 'disabled' || new Date(inv.expires_at) <= now) throw new AdminAuthError(401, 'auth_failed')
  return { accountId: Number(inv.account_id), purpose: inv.purpose as 'enroll' | 'reset', email: inv.email as string }
}

export async function completeEnrollment(client: PoolClient, issuer: string, token: string, input: { password: string; totpCode: string; totpSecretBox: Buffer; passkeyRegistered: boolean }, secretKey: Buffer, now: Date) {
  const inv = await openInvitation(client, token, now)
  if (!input.passkeyRegistered || !passwordAcceptable(input.password)) throw new AdminAuthError(422, 'invalid')
  const step = checkTotp(open(secretKey, input.totpSecretBox), String(input.totpCode ?? ''), now.getTime(), 0)
  if (step === null) throw new AdminAuthError(422, 'invalid')
  const activated = await client.query("UPDATE vendor_accounts SET status='active', password_hash=$2 WHERE id=$1 AND status IN ('enrolling','active') RETURNING id", [inv.accountId, await hashPassword(input.password)])
  if (!activated.rowCount) throw new AdminAuthError(401, 'auth_failed')
  await client.query('INSERT INTO vendor_totp(account_id,secret_box,last_step,confirmed_at) VALUES($1,$2,$3,$4) ON CONFLICT (account_id) DO UPDATE SET secret_box=EXCLUDED.secret_box,last_step=EXCLUDED.last_step,confirmed_at=EXCLUDED.confirmed_at', [inv.accountId, input.totpSecretBox, step, now])
  await client.query('DELETE FROM vendor_recovery_codes WHERE account_id=$1', [inv.accountId])
  const recoveryCodes = newRecoveryCodes()
  for (const code of recoveryCodes) await client.query('INSERT INTO vendor_recovery_codes(account_id,code_hash) VALUES($1,$2)', [inv.accountId, hashToken(code)])
  await client.query('UPDATE vendor_invitations SET consumed_at=$2 WHERE token_hash=$1', [hashToken(token), now])
  await syncMembership(client, issuer, inv.accountId)
  await audit(client, `account:${inv.accountId}`, inv.purpose === 'reset' ? 'account.reset_completed' : 'account.enrolled', `account:${inv.accountId}`, inv.purpose)
  return { accountId: inv.accountId, recoveryCodes }
}
