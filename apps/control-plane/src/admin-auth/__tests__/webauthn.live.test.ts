import { afterAll, beforeEach, describe, expect, it } from 'vitest'
import { Pool } from 'pg'
import { migrate, transaction } from '../../db.js'
import { authenticationOptions, finishAuthentication, finishRegistration, registrationOptions, type WebAuthnLib } from '../webauthn.js'

const url = process.env.CONTROL_TEST_DATABASE_URL
const admin = { secretKey: Buffer.alloc(32), rpId: 'localhost', origin: 'http://localhost:3100', rpName: 'Nasq' as const }
const now = new Date('2026-11-01T10:00:00Z')
// Same shapes as @simplewebauthn/server v14.0.3 returns.
function lib(overrides: Partial<WebAuthnLib> = {}): WebAuthnLib {
  return {
    generateRegistrationOptions: async () => ({ challenge: 'reg-challenge' }),
    verifyRegistrationResponse: async () => ({ verified: true, registrationInfo: { credential: { id: 'cred-1', publicKey: new Uint8Array([1, 2]), counter: 0, transports: ['internal'] } } }),
    generateAuthenticationOptions: async () => ({ challenge: 'auth-challenge' }),
    verifyAuthenticationResponse: async () => ({ verified: true, authenticationInfo: { newCounter: 1 } }),
    ...overrides,
  } as unknown as WebAuthnLib
}

if (!url) describe.skip('webauthn (requires CONTROL_TEST_DATABASE_URL)', () => {})
else describe('webauthn', () => {
  const pool = new Pool({ connectionString: url })
  let accountId = 0, otherAccountId = 0
  const insertCred = () => pool.query("INSERT INTO vendor_passkeys(credential_id,account_id,public_key,counter,transports,label,created_at) VALUES('cred-1',$1,'\\x0102',0,'{internal}','Laptop',$2)", [accountId, now])
  const finish = (kind: 'login' | 'step_up', id: string, l = lib(), at = now) => transaction(pool, (c) => finishAuthentication(c, l, admin, kind, id, { id: 'cred-1' }, at))
  beforeEach(async () => {
    await migrate(pool)
    await pool.query('TRUNCATE vendor_accounts CASCADE')
    accountId = Number((await pool.query("INSERT INTO vendor_accounts(email,display_name,status) VALUES('a@nasq.sa','A','active') RETURNING id")).rows[0].id)
    otherAccountId = Number((await pool.query("INSERT INTO vendor_accounts(email,display_name,status) VALUES('b@nasq.sa','B','active') RETURNING id")).rows[0].id)
  })
  afterAll(async () => { await pool.end() })

  it('registers and then signs in with a discoverable passkey, once per challenge', async () => {
    const reg = await transaction(pool, (c) => registrationOptions(c, lib(), admin, { id: accountId, email: 'a@nasq.sa', displayName: 'A' }, now))
    await transaction(pool, (c) => finishRegistration(c, lib(), admin, accountId, reg.challengeId, { id: 'cred-1' }, 'Laptop', now))
    const stored = await pool.query('SELECT account_id, public_key, counter, transports, label FROM vendor_passkeys WHERE credential_id=$1', ['cred-1'])
    expect(stored.rows).toHaveLength(1)
    expect(Number(stored.rows[0].account_id)).toBe(accountId)
    expect([...stored.rows[0].public_key]).toEqual([1, 2])
    expect(stored.rows[0].transports).toEqual(['internal'])
    expect(stored.rows[0].label).toBe('Laptop')
    const auth = await transaction(pool, (c) => authenticationOptions(c, lib(), admin, 'login', null, now))
    expect(await finish('login', auth.challengeId)).toEqual({ accountId })
    await expect(finish('login', auth.challengeId)).rejects.toMatchObject({ code: 'auth_failed' })
  })
  it('updates the counter and last use of the credential', async () => {
    await insertCred()
    const auth = await transaction(pool, (c) => authenticationOptions(c, lib(), admin, 'login', null, now))
    await finish('login', auth.challengeId)
    const row = await pool.query('SELECT counter, last_used_at FROM vendor_passkeys WHERE credential_id=$1', ['cred-1'])
    expect(Number(row.rows[0].counter)).toBe(1)
    expect(new Date(row.rows[0].last_used_at)).toEqual(now)
  })
  it('requires user verification and uses discoverable login without allowCredentials', async () => {
    await insertCred()
    let seen: Record<string, unknown> = {}
    const spy = lib({ generateAuthenticationOptions: (async (o: Record<string, unknown>) => { seen = o; return { challenge: 'x' } }) as never })
    await transaction(pool, (c) => authenticationOptions(c, spy, admin, 'login', null, now))
    expect(seen).toMatchObject({ rpID: 'localhost', userVerification: 'required' })
    expect(seen).not.toHaveProperty('allowCredentials')
    await transaction(pool, (c) => authenticationOptions(c, spy, admin, 'step_up', accountId, now))
    expect(seen.allowCredentials).toEqual([{ id: 'cred-1', transports: ['internal'] }])
  })
  it('fails closed on verification failure, expiry and foreign step-up credentials', async () => {
    await insertCred()
    const auth = await transaction(pool, (c) => authenticationOptions(c, lib(), admin, 'login', null, now))
    await expect(finish('login', auth.challengeId, lib({ verifyAuthenticationResponse: async () => ({ verified: false }) } as never))).rejects.toMatchObject({ code: 'auth_failed' })
    const late = await transaction(pool, (c) => authenticationOptions(c, lib(), admin, 'login', null, now))
    await expect(finish('login', late.challengeId, lib(), new Date(now.getTime() + 5 * 60_000 + 1))).rejects.toMatchObject({ code: 'auth_failed' })
    const step = await transaction(pool, (c) => authenticationOptions(c, lib(), admin, 'step_up', otherAccountId, now))
    await expect(finish('step_up', step.challengeId)).rejects.toMatchObject({ code: 'auth_failed' })
  })
  it('does not let a login challenge finish as step-up', async () => {
    await insertCred()
    const auth = await transaction(pool, (c) => authenticationOptions(c, lib(), admin, 'login', null, now))
    await expect(finish('step_up', auth.challengeId)).rejects.toMatchObject({ code: 'auth_failed' })
  })
  it('rejects a disabled account at sign-in', async () => {
    await insertCred()
    await pool.query("UPDATE vendor_accounts SET status='disabled' WHERE id=$1", [accountId])
    const auth = await transaction(pool, (c) => authenticationOptions(c, lib(), admin, 'login', null, now))
    await expect(finish('login', auth.challengeId)).rejects.toMatchObject({ code: 'auth_failed' })
  })
})
