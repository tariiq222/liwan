import { afterAll, beforeEach, describe, expect, it } from 'vitest'
import { Pool } from 'pg'
import { migrate, transaction } from '../../db.js'
import { createSession, parseSession, resolveSession, markStepUp, revokeSession, IDLE_MS, ABSOLUTE_MS, STEP_UP_MS } from '../sessions.js'

const url = process.env.CONTROL_TEST_DATABASE_URL
if (!url) describe.skip('sessions (requires CONTROL_TEST_DATABASE_URL)', () => {})
else describe('sessions', () => {
  const pool = new Pool({ connectionString: url })
  let accountId = 0
  beforeEach(async () => {
    await migrate(pool)
    await pool.query('TRUNCATE vendor_accounts CASCADE')
    accountId = Number((await pool.query("INSERT INTO vendor_accounts(email,display_name,status) VALUES('s@nasq.sa','S','active') RETURNING id")).rows[0].id)
  })
  afterAll(async () => { await pool.end() })

  it('parses only well-formed values', () => {
    expect(parseSession('12.' + 'a'.repeat(43))).toEqual({ accountId: 12, token: 'a'.repeat(43) })
    for (const bad of [undefined, '', '0.' + 'a'.repeat(43), '12', '12.short', 'x.' + 'a'.repeat(43), ['12.' + 'a'.repeat(43)]]) expect(parseSession(bad)).toBeNull()
  })
  it('expires on idle and on absolute lifetime', async () => {
    const t0 = new Date('2026-11-01T10:00:00Z')
    const { session } = await transaction(pool, (c) => createSession(c, accountId, t0, false))
    await transaction(pool, (c) => resolveSession(c, session, new Date(t0.getTime() + IDLE_MS - 1000)))
    await expect(transaction(pool, (c) => resolveSession(c, session, new Date(t0.getTime() + 2 * IDLE_MS)))).rejects.toMatchObject({ code: 'auth_failed' })
    const s2 = (await transaction(pool, (c) => createSession(c, accountId, t0, false))).session
    for (let t = t0.getTime() + IDLE_MS / 2; t < t0.getTime() + ABSOLUTE_MS; t += IDLE_MS / 2) await transaction(pool, (c) => resolveSession(c, s2, new Date(t)))
    await expect(transaction(pool, (c) => resolveSession(c, s2, new Date(t0.getTime() + ABSOLUTE_MS)))).rejects.toMatchObject({ code: 'auth_failed' })
  })
  it('rejects another account id with a valid token', async () => {
    const { session } = await transaction(pool, (c) => createSession(c, accountId, new Date(), false))
    const forged = `${accountId + 1}.${session.split('.')[1]}`
    await expect(transaction(pool, (c) => resolveSession(c, forged, new Date()))).rejects.toMatchObject({ code: 'auth_failed' })
  })
  it('tracks step-up freshness', async () => {
    const t0 = new Date('2026-11-01T10:00:00Z')
    const { session } = await transaction(pool, (c) => createSession(c, accountId, t0, true))
    expect((await transaction(pool, (c) => resolveSession(c, session, new Date(t0.getTime() + STEP_UP_MS - 1000)))).stepUpFresh).toBe(true)
    const late = await transaction(pool, (c) => resolveSession(c, session, new Date(t0.getTime() + STEP_UP_MS + 1000)))
    expect(late.stepUpFresh).toBe(false)
    await transaction(pool, (c) => markStepUp(c, late.tokenHash, new Date(t0.getTime() + STEP_UP_MS + 2000)))
    expect((await transaction(pool, (c) => resolveSession(c, session, new Date(t0.getTime() + STEP_UP_MS + 3000)))).stepUpFresh).toBe(true)
  })
  it('rejects a revoked session', async () => {
    const now = new Date()
    const { session } = await transaction(pool, (c) => createSession(c, accountId, now, false))
    const { tokenHash } = await transaction(pool, (c) => resolveSession(c, session, now))
    await transaction(pool, (c) => revokeSession(c, tokenHash))
    await expect(transaction(pool, (c) => resolveSession(c, session, now))).rejects.toMatchObject({ code: 'auth_failed' })
  })
  it('rejects the session of a disabled account', async () => {
    const now = new Date()
    const { session } = await transaction(pool, (c) => createSession(c, accountId, now, false))
    await pool.query("UPDATE vendor_accounts SET status='disabled' WHERE id=$1", [accountId])
    await expect(transaction(pool, (c) => resolveSession(c, session, now))).rejects.toMatchObject({ code: 'auth_failed' })
  })
})
