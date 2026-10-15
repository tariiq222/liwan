// The only file that imports @simplewebauthn/server (v14.0.3). Shapes read from its type definitions:
// - generateRegistrationOptions({ rpName, rpID, userName, userID?: Uint8Array, userDisplayName?, attestationType?,
//   authenticatorSelection?, excludeCredentials?: { id: string; transports?: string[] }[] }) -> { challenge, ... }
// - verifyRegistrationResponse({ response, expectedChallenge, expectedOrigin, expectedRPID?, requireUserVerification? })
//   -> { verified: true, registrationInfo: { credential: { id: string; publicKey: Uint8Array; counter; transports? } } }
//      | { verified: false }
// - generateAuthenticationOptions({ rpID, allowCredentials?, userVerification? }) -> { challenge, ... }
// - verifyAuthenticationResponse({ response, expectedChallenge, expectedOrigin, expectedRPID, requireUserVerification?,
//   credential: { id, publicKey, counter, transports? } }) -> { verified, authenticationInfo: { newCounter, ... } }
import { randomUUID } from 'node:crypto'
import type { Pool, PoolClient } from 'pg'
import * as simple from '@simplewebauthn/server'
import type { AdminConfig } from '../config.js'
import { AdminAuthError } from './accounts.js'

export type WebAuthnLib = Pick<typeof simple, 'generateRegistrationOptions' | 'verifyRegistrationResponse' | 'generateAuthenticationOptions' | 'verifyAuthenticationResponse'>
export const defaultWebAuthn: WebAuthnLib = simple
const CHALLENGE_MS = 5 * 60_000
const fail = (): never => { throw new AdminAuthError(401, 'auth_failed') }

async function saveChallenge(client: PoolClient, kind: 'register' | 'login' | 'step_up', accountId: number | null, challenge: string, now: Date) {
  const id = randomUUID()
  await client.query('DELETE FROM vendor_auth_challenges WHERE expires_at < $1', [now])
  await client.query('INSERT INTO vendor_auth_challenges(id,account_id,kind,challenge,expires_at) VALUES($1,$2,$3,$4,$5)', [id, accountId, kind, challenge, new Date(now.getTime() + CHALLENGE_MS)])
  return id
}

export type ConsumedChallenge = { accountId: number | null; challenge: string }
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/

// Runs on the pool (autocommit) so the challenge is burned even when the caller's transaction later rolls back.
export async function consumeChallenge(pool: Pool, challengeId: string, kind: 'register' | 'login' | 'step_up', now: Date): Promise<ConsumedChallenge> {
  if (typeof challengeId !== 'string' || !UUID.test(challengeId)) fail()
  await pool.query('DELETE FROM vendor_auth_challenges WHERE expires_at < $1', [now])
  const row = await pool.query('DELETE FROM vendor_auth_challenges WHERE id=$1 AND kind=$2 RETURNING account_id, challenge, expires_at', [challengeId, kind])
  const c = row.rows[0]
  if (!c || new Date(c.expires_at) <= now) fail()
  return { accountId: c.account_id === null ? null : Number(c.account_id), challenge: c.challenge as string }
}

export async function registrationOptions(client: PoolClient, lib: WebAuthnLib, admin: AdminConfig, account: { id: number; email: string; displayName: string }, now: Date) {
  const existing = await client.query('SELECT credential_id, transports FROM vendor_passkeys WHERE account_id=$1', [account.id])
  const options = await lib.generateRegistrationOptions({
    rpName: admin.rpName, rpID: admin.rpId, userName: account.email, userDisplayName: account.displayName,
    userID: new TextEncoder().encode(String(account.id)), attestationType: 'none',
    authenticatorSelection: { residentKey: 'required', userVerification: 'required' },
    excludeCredentials: existing.rows.map((r) => ({ id: r.credential_id as string, transports: r.transports as string[] })),
  })
  return { challengeId: await saveChallenge(client, 'register', account.id, options.challenge, now), options }
}

export async function finishRegistration(client: PoolClient, lib: WebAuthnLib, admin: AdminConfig, accountId: number, consumed: ConsumedChallenge, response: unknown, label: string, now: Date) {
  const c = consumed
  if (c.accountId !== accountId) fail()
  let result: Awaited<ReturnType<WebAuthnLib['verifyRegistrationResponse']>> | undefined
  try {
    result = await lib.verifyRegistrationResponse({ response: response as never, expectedChallenge: c.challenge, expectedOrigin: admin.origin, expectedRPID: admin.rpId, requireUserVerification: true })
  } catch { fail() }
  if (!result?.verified) return fail()
  const cred = result.registrationInfo.credential
  const ins = await client.query(
    'INSERT INTO vendor_passkeys(credential_id,account_id,public_key,counter,transports,label,created_at) VALUES($1,$2,$3,$4,$5,$6,$7) ON CONFLICT (credential_id) DO NOTHING',
    [cred.id, accountId, Buffer.from(cred.publicKey), cred.counter, cred.transports ?? [], String(label ?? '').slice(0, 60), now],
  )
  if (ins.rowCount === 0) fail()
}

export async function authenticationOptions(client: PoolClient, lib: WebAuthnLib, admin: AdminConfig, kind: 'login' | 'step_up', accountId: number | null, now: Date) {
  const allow = kind === 'step_up'
    ? (await client.query('SELECT credential_id, transports FROM vendor_passkeys WHERE account_id=$1', [accountId])).rows.map((r) => ({ id: r.credential_id as string, transports: r.transports as string[] }))
    : undefined
  const options = await lib.generateAuthenticationOptions({ rpID: admin.rpId, userVerification: 'required', ...(allow ? { allowCredentials: allow } : {}) })
  return { challengeId: await saveChallenge(client, kind, kind === 'step_up' ? accountId : null, options.challenge, now), options }
}

export async function finishAuthentication(client: PoolClient, lib: WebAuthnLib, admin: AdminConfig, kind: 'login' | 'step_up', consumed: ConsumedChallenge, response: unknown, now: Date) {
  const c = consumed
  const id = (response as { id?: unknown })?.id
  if (typeof id !== 'string' || id.length > 1024) fail()
  const row = await client.query(
    "SELECT p.credential_id, p.account_id, p.public_key, p.counter, p.transports FROM vendor_passkeys p JOIN vendor_accounts a ON a.id=p.account_id WHERE p.credential_id=$1 AND a.status='active' FOR UPDATE OF p",
    [id],
  )
  const key = row.rows[0]
  if (!key || (kind === 'step_up' && Number(key.account_id) !== c.accountId)) fail()
  let result: Awaited<ReturnType<WebAuthnLib['verifyAuthenticationResponse']>> | undefined
  try {
    result = await lib.verifyAuthenticationResponse({
      response: response as never, expectedChallenge: c.challenge, expectedOrigin: admin.origin, expectedRPID: admin.rpId, requireUserVerification: true,
      credential: { id: key.credential_id, publicKey: new Uint8Array(key.public_key), counter: Number(key.counter), transports: key.transports },
    })
  } catch { fail() }
  if (!result?.verified) fail()
  await client.query('UPDATE vendor_passkeys SET counter=$2, last_used_at=$3 WHERE credential_id=$1', [id, result!.authenticationInfo.newCounter, now])
  return { accountId: Number(key.account_id) }
}
