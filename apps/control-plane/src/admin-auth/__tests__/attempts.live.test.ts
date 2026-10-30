import { afterAll, beforeEach, describe, expect, it } from 'vitest'
import { Pool } from 'pg'
import { migrate, transaction } from '../../db.js'
import { AdminAuthError } from '../accounts.js'
import { recordSuccess, reserveAttempt } from '../attempts.js'

const url = process.env.CONTROL_TEST_DATABASE_URL
if (!url) describe.skip('attempts (requires CONTROL_TEST_DATABASE_URL)', () => {})
else describe('attempts', () => {
  const pool = new Pool({ connectionString: url })
  const t0 = new Date('2026-11-01T10:00:00Z')
  const later = (ms: number) => new Date(t0.getTime() + ms)
  beforeEach(async () => {
    await migrate(pool)
    await pool.query('TRUNCATE vendor_auth_attempts, audit_events')
  })
  afterAll(async () => { await pool.end() })

  it('lets five account attempts through and refuses the sixth for fifteen minutes', async () => {
    for (let i = 0; i < 5; i++) await reserveAttempt(pool, ['account:a@liwanos.com', 'ip:1.1.1.1'], t0)
    await expect(reserveAttempt(pool, ['account:a@liwanos.com'], t0)).rejects.toMatchObject({ code: 'rate_limited' })
    await expect(reserveAttempt(pool, ['account:a@liwanos.com'], later(14 * 60_000))).rejects.toMatchObject({ code: 'rate_limited' })
    await reserveAttempt(pool, ['account:a@liwanos.com'], later(15 * 60_000 + 1))
    const locks = await pool.query("SELECT subject FROM audit_events WHERE action='auth.locked'")
    expect(locks.rows).toEqual([{ subject: 'account:a@liwanos.com' }])
  })

  it('never lets parallel reservations exceed the limit and audits the lock once', async () => {
    const results = await Promise.allSettled(Array.from({ length: 30 }, () => reserveAttempt(pool, ['account:p@liwanos.com'], t0)))
    expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(5)
    expect((await pool.query("SELECT count(*)::int AS n FROM audit_events WHERE action='auth.locked'")).rows[0].n).toBe(1)
  })

  it('uses a limit of twenty per ip', async () => {
    for (let i = 0; i < 20; i++) await reserveAttempt(pool, ['ip:3.3.3.3'], t0)
    await expect(reserveAttempt(pool, ['ip:3.3.3.3'], t0)).rejects.toMatchObject({ code: 'rate_limited' })
  })

  it('does not count against the account when the ip scope is already locked', async () => {
    for (let i = 0; i < 20; i++) await reserveAttempt(pool, ['ip:9.9.9.9'], t0)
    await expect(reserveAttempt(pool, ['ip:9.9.9.9'], t0)).rejects.toMatchObject({ code: 'rate_limited' })
    for (let i = 0; i < 10; i++) await expect(reserveAttempt(pool, ['account:victim@liwanos.com', 'ip:9.9.9.9'], t0)).rejects.toMatchObject({ code: 'rate_limited' })
    expect((await pool.query("SELECT 1 FROM vendor_auth_attempts WHERE scope='account:victim@liwanos.com'")).rowCount).toBe(0)
    // The victim can still sign in from another address.
    await reserveAttempt(pool, ['account:victim@liwanos.com', 'ip:8.8.8.8'], t0)
  })

  it('stops at the request that locks the ip without touching the account', async () => {
    for (let i = 0; i < 20; i++) await reserveAttempt(pool, ['ip:7.7.7.7'], t0)
    await expect(reserveAttempt(pool, ['account:other@liwanos.com', 'ip:7.7.7.7'], t0)).rejects.toMatchObject({ code: 'rate_limited' })
    expect((await pool.query("SELECT 1 FROM vendor_auth_attempts WHERE scope='account:other@liwanos.com'")).rowCount).toBe(0)
  })

  it('refunds: success deletes the account row and gives back one ip reservation', async () => {
    for (let i = 0; i < 4; i++) await reserveAttempt(pool, ['account:b@liwanos.com', 'ip:2.2.2.2'], t0)
    await transaction(pool, (c) => recordSuccess(c, ['account:b@liwanos.com', 'ip:2.2.2.2']))
    expect((await pool.query("SELECT 1 FROM vendor_auth_attempts WHERE scope='account:b@liwanos.com'")).rowCount).toBe(0)
    expect((await pool.query("SELECT failures FROM vendor_auth_attempts WHERE scope='ip:2.2.2.2'")).rows[0].failures).toBe(3)
  })

  it('restarts the count at one after the fifteen-minute window', async () => {
    for (let i = 0; i < 4; i++) await reserveAttempt(pool, ['account:c@liwanos.com'], t0)
    await reserveAttempt(pool, ['account:c@liwanos.com'], later(15 * 60_000 + 1))
    const row = await pool.query("SELECT failures, window_start FROM vendor_auth_attempts WHERE scope='account:c@liwanos.com'")
    expect(row.rows[0].failures).toBe(1)
    expect(new Date(row.rows[0].window_start).getTime()).toBe(later(15 * 60_000 + 1).getTime())
  })

  it('prunes stale unlocked rows and keeps live and locked ones', async () => {
    await pool.query("INSERT INTO vendor_auth_attempts(scope,window_start,failures,locked_until) VALUES ('account:old@liwanos.com',$1,2,NULL),('account:oldlocked@liwanos.com',$1,6,$2),('account:fresh@liwanos.com',$3,1,NULL)", [later(-20 * 60_000), later(5 * 60_000), later(-60_000)])
    await reserveAttempt(pool, ['account:new@liwanos.com'], t0)
    const scopes = (await pool.query('SELECT scope FROM vendor_auth_attempts ORDER BY scope')).rows.map((r) => r.scope)
    expect(scopes).toEqual(['account:fresh@liwanos.com', 'account:new@liwanos.com', 'account:oldlocked@liwanos.com'])
  })

  it('fails closed when the database errors: no reservation, no verification', async () => {
    const broken = new Pool({ connectionString: url })
    await broken.end()
    const error = await reserveAttempt(broken, ['account:x@liwanos.com'], t0).catch((e: unknown) => e)
    expect(error).toBeInstanceOf(Error)
    expect(error).not.toBeInstanceOf(AdminAuthError)
  })
})
