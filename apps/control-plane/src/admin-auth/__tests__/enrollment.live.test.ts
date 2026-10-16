import { afterAll, beforeEach, describe, expect, it } from 'vitest'
import { Pool } from 'pg'
import { migrate, transaction } from '../../db.js'
import { totpAt, totpStep, newTotpSecret } from '../totp.js'
import { seal, totpBoxAad } from '../crypto.js'
import { disableAccount } from '../accounts.js'
import { accountCapabilities } from '../grants.js'
import { completeEnrollment, inviteAccount, issueReset, openInvitation } from '../enrollment.js'

const url = process.env.CONTROL_TEST_DATABASE_URL
const secretKey = Buffer.alloc(32, 3)
const now = new Date('2026-11-01T10:00:00Z')
if (!url) describe.skip('enrollment (requires CONTROL_TEST_DATABASE_URL)', () => {})
else describe('enrollment', () => {
  const pool = new Pool({ connectionString: url })
  beforeEach(async () => {
    await migrate(pool)
    await pool.query('TRUNCATE vendor_accounts, audit_events CASCADE')
  })
  afterAll(async () => { await pool.end() })

  it('enrolls once from a normalized email invitation', async () => {
    const { token, accountId } = await transaction(pool, (c) => inviteAccount(c, 'operator', { email: ' Owner@WebVue.SA ', displayName: 'Owner', roles: ['owner'], reason: 'first owner' }, now))
    const opened = await transaction(pool, (c) => openInvitation(c, token, now))
    expect(opened.email).toBe('owner@webvue.sa')
    await pool.query("INSERT INTO vendor_passkeys(credential_id,account_id,public_key) VALUES('cred-1',$1,'\\x00')", [opened.accountId])
    const secret = newTotpSecret()
    const input = { password: 'a long enough password', totpCode: totpAt(secret, totpStep(now.getTime())), totpSecretBox: seal(secretKey, secret, totpBoxAad(accountId)), passkeyRegistered: true }
    const [first, second] = await Promise.allSettled([
      transaction(pool, (c) => completeEnrollment(c, token, input, secretKey, now)),
      transaction(pool, (c) => completeEnrollment(c, token, input, secretKey, now)),
    ])
    expect([first.status, second.status].sort()).toEqual(['fulfilled', 'rejected'])
    const lost = (first.status === 'rejected' ? first : second) as PromiseRejectedResult
    expect(lost.reason).toMatchObject({ code: 'auth_failed' })
    const done = (first.status === 'fulfilled' ? first : second) as PromiseFulfilledResult<{ recoveryCodes: string[] }>
    expect(done.value.recoveryCodes).toHaveLength(10)
    const account = await pool.query('SELECT status FROM vendor_accounts WHERE email=$1', ['owner@webvue.sa'])
    expect(account.rows[0].status).toBe('active')
  })
  it('never deadlocks when a reset races a completion and ends with one consistent outcome', async () => {
    for (let round = 0; round < 8; round++) {
      const { token, accountId } = await transaction(pool, (c) => inviteAccount(c, 'operator', { email: `race${round}@webvue.sa`, displayName: 'R', roles: ['support'], reason: 'support' }, now))
      await pool.query("INSERT INTO vendor_passkeys(credential_id,account_id,public_key) VALUES($1,$2,'\\x00')", [`race-${round}`, accountId])
      const secret = newTotpSecret()
      const input = { password: 'a long enough password', totpCode: totpAt(secret, totpStep(now.getTime())), totpSecretBox: seal(secretKey, secret, totpBoxAad(accountId)), passkeyRegistered: true }
      const results = await Promise.allSettled([
        transaction(pool, (c) => completeEnrollment(c, token, input, secretKey, now)),
        transaction(pool, (c) => issueReset(c, 'operator', accountId, 'race', now)),
        transaction(pool, (c) => disableAccount(c, 'operator', accountId, 'race')),
      ])
      for (const r of results) if (r.status === 'rejected') expect((r.reason as { code?: string }).code).not.toBe('40P01')
      const status = (await pool.query('SELECT status FROM vendor_accounts WHERE id=$1', [accountId])).rows[0].status
      expect(['enrolling', 'active', 'disabled']).toContain(status)
      if (status !== 'active') expect((await pool.query("SELECT 1 FROM vendor_invitations WHERE account_id=$1 AND consumed_at IS NULL AND purpose='enroll'", [accountId])).rowCount).toBe(0)
    }
  })
  it('refuses a duplicate email in another case', async () => {
    await transaction(pool, (c) => inviteAccount(c, 'operator', { email: 'x@webvue.sa', displayName: 'X', roles: ['support'], reason: 'support' }, now))
    await expect(transaction(pool, (c) => inviteAccount(c, 'operator', { email: 'X@WEBVUE.SA', displayName: 'X2', roles: ['support'], reason: 'support' }, now))).rejects.toMatchObject({ code: 'conflict' })
  })
  it('rejects an expired invitation and enrollment without passkey', async () => {
    const { token, accountId } = await transaction(pool, (c) => inviteAccount(c, 'operator', { email: 'late@webvue.sa', displayName: 'L', roles: ['support'], reason: 'support' }, now))
    await expect(transaction(pool, (c) => openInvitation(c, token, new Date(now.getTime() + 24 * 3600_000 + 1)))).rejects.toMatchObject({ code: 'auth_failed' })
    const secret = newTotpSecret()
    await expect(transaction(pool, (c) => completeEnrollment(c, token, { password: 'a long enough password', totpCode: totpAt(secret, totpStep(now.getTime())), totpSecretBox: seal(secretKey, secret, totpBoxAad(accountId)), passkeyRegistered: false }, secretKey, now))).rejects.toMatchObject({ code: 'invalid' })
  })
  it('refuses a TOTP box sealed for another account', async () => {
    const { token, accountId } = await transaction(pool, (c) => inviteAccount(c, 'operator', { email: 'box@webvue.sa', displayName: 'B', roles: ['support'], reason: 'support' }, now))
    const secret = newTotpSecret()
    const foreign = seal(secretKey, secret, totpBoxAad(accountId + 1))
    await expect(transaction(pool, (c) => completeEnrollment(c, token, { password: 'a long enough password', totpCode: totpAt(secret, totpStep(now.getTime())), totpSecretBox: foreign, passkeyRegistered: true }, secretKey, now))).rejects.toMatchObject({ code: 'invalid' })
    expect((await pool.query('SELECT status FROM vendor_accounts WHERE id=$1', [accountId])).rows[0].status).toBe('enrolling')
  })
  it('rejects a consumed token on reuse', async () => {
    const { token, accountId } = await transaction(pool, (c) => inviteAccount(c, 'operator', { email: 'once@webvue.sa', displayName: 'O', roles: ['support'], reason: 'support' }, now))
    const secret = newTotpSecret()
    const input = { password: 'a long enough password', totpCode: totpAt(secret, totpStep(now.getTime())), totpSecretBox: seal(secretKey, secret, totpBoxAad(accountId)), passkeyRegistered: true }
    await transaction(pool, (c) => completeEnrollment(c, token, input, secretKey, now))
    await expect(transaction(pool, (c) => openInvitation(c, token, now))).rejects.toMatchObject({ code: 'auth_failed' })
    await expect(transaction(pool, (c) => completeEnrollment(c, token, input, secretKey, now))).rejects.toMatchObject({ code: 'auth_failed' })
  })
  it('does not let an outstanding invitation reactivate a disabled account', async () => {
    const { token } = await transaction(pool, (c) => inviteAccount(c, 'operator', { email: 'gone@webvue.sa', displayName: 'G', roles: ['support'], reason: 'support' }, now))
    const id = (await pool.query("SELECT id FROM vendor_accounts WHERE email='gone@webvue.sa'")).rows[0].id
    await transaction(pool, (c) => disableAccount(c, 'operator', Number(id), 'left before joining'))
    await expect(transaction(pool, (c) => openInvitation(c, token, now))).rejects.toMatchObject({ code: 'auth_failed' })
    // defence in depth: even an unconsumed invitation must not reactivate (bypass the consume in disableAccount)
    await pool.query('UPDATE vendor_invitations SET consumed_at=NULL WHERE account_id=$1', [id])
    const secret = newTotpSecret()
    await expect(transaction(pool, (c) => completeEnrollment(c, token, { password: 'a long enough password', totpCode: totpAt(secret, totpStep(now.getTime())), totpSecretBox: seal(secretKey, secret, totpBoxAad(Number(id))), passkeyRegistered: true }, secretKey, now))).rejects.toMatchObject({ code: 'auth_failed' })
    expect((await pool.query('SELECT status FROM vendor_accounts WHERE id=$1', [id])).rows[0].status).toBe('disabled')
    expect(await accountCapabilities(pool, Number(id))).toBeNull()
  })
})
