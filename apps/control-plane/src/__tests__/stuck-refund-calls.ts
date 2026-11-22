import type { Pool, PoolClient } from 'pg'
import { routesB } from '../commercial/routes-b.js'
import type { PaymentAdapter } from '../commercial/payment-adapter.js'

/** Calls one of the three stuck-refund routes the way the vendor console does, through the commercial router. */
export function callStuckAction(pool: Pool) {
  return (note: string, action: 'check' | 'release' | 'record', body?: unknown, options: { adapter?: PaymentAdapter; caps?: string[]; stepUp?: boolean; actor?: number } = {}) => {
    const pathname = `/v1/commercial/invoice-adjustments/${note}/automatic-refund/${action}`
    return routesB(pool, { method: 'POST', pathname, raw: body === undefined ? '' : JSON.stringify(body), issuer: 'vendor-test', actor: options.actor ?? 7,
      capabilities: (options.caps ?? ['vendor.read', 'vendor.billing.manage']) as any, stepUpFresh: options.stepUp ?? true },
    new URL(pathname, 'https://liwan.test'), { adapter: options.adapter ?? null, returnOrigin: null })
  }
}

/** Holds the order's refund lock on a connection of its own, the way the worker does while it works on the row. */
export async function holdOrderLock(pool: Pool, order: string): Promise<{ release: () => Promise<void> }> {
  const client: PoolClient = await pool.connect()
  const { held } = (await client.query('SELECT pg_try_advisory_lock(hashtextextended($1,0)) AS held', [`commercial-refund:${order}`])).rows[0]
  if (!held) { client.release(); throw Error('the refund lock was already held') }
  return { release: async () => { await client.query('SELECT pg_advisory_unlock(hashtextextended($1,0))', [`commercial-refund:${order}`]); client.release() } }
}
