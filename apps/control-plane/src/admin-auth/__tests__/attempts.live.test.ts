import { afterAll, beforeEach, describe, expect, it } from 'vitest'
import { Pool } from 'pg'
import { migrate, transaction } from '../../db.js'
import { checkAllowed, recordFailure, recordSuccess } from '../attempts.js'

const url = process.env.CONTROL_TEST_DATABASE_URL
if (!url) describe.skip('attempts (requires CONTROL_TEST_DATABASE_URL)', () => {})
else describe('attempts', () => {
  const pool = new Pool({ connectionString: url })
  const t0 = new Date('2026-11-01T10:00:00Z')
  beforeEach(async () => {
    await migrate(pool)
    await pool.query('TRUNCATE vendor_auth_attempts')
  })
  afterAll(async () => { await pool.end() })

  it('locks an account after five failures for fifteen minutes', async () => {
    for (let i = 0; i < 5; i++) await transaction(pool, (c) => recordFailure(c, ['account:a@nasq.sa', 'ip:1.1.1.1'], t0))
    await expect(transaction(pool, (c) => checkAllowed(c, ['account:a@nasq.sa'], t0))).rejects.toMatchObject({ code: 'rate_limited' })
    await transaction(pool, (c) => checkAllowed(c, ['ip:1.1.1.1'], t0))
    await transaction(pool, (c) => checkAllowed(c, ['account:a@nasq.sa'], new Date(t0.getTime() + 15 * 60_000 + 1)))
  })

  it('resets the account count on success but keeps the ip count', async () => {
    for (let i = 0; i < 4; i++) await transaction(pool, (c) => recordFailure(c, ['account:b@nasq.sa', 'ip:2.2.2.2'], t0))
    await transaction(pool, (c) => recordSuccess(c, ['account:b@nasq.sa', 'ip:2.2.2.2']))
    await transaction(pool, (c) => recordFailure(c, ['account:b@nasq.sa'], t0))
    await transaction(pool, (c) => checkAllowed(c, ['account:b@nasq.sa'], t0))
    const ip = await pool.query("SELECT failures FROM vendor_auth_attempts WHERE scope='ip:2.2.2.2'")
    expect(ip.rows[0].failures).toBe(4)
  })

  it('restarts the count at one when the failure is after the fifteen-minute window', async () => {
    for (let i = 0; i < 4; i++) await transaction(pool, (c) => recordFailure(c, ['account:c@nasq.sa'], t0))
    await transaction(pool, (c) => recordFailure(c, ['account:c@nasq.sa'], new Date(t0.getTime() + 15 * 60_000 + 1)))
    const row = await pool.query("SELECT failures, window_start FROM vendor_auth_attempts WHERE scope='account:c@nasq.sa'")
    expect(row.rows[0].failures).toBe(1)
    expect(new Date(row.rows[0].window_start).getTime()).toBe(t0.getTime() + 15 * 60_000 + 1)
    await transaction(pool, (c) => checkAllowed(c, ['account:c@nasq.sa'], t0))
  })
})
