import type { Pool } from 'pg'
import { CommercialHttpError } from './lifecycle.js'
import { assertReturnOrigin } from './payments.js'
import { originAllowed } from './payment-adapter.js'

/** The origin one customer's payment returns come back to; throws 422 `return_url_forbidden` when none is usable. */
export type ReturnOrigin = (customerId: string) => Promise<string>

const forbidden = () => new CommercialHttpError('return_url_forbidden', 422)
/** Used when nothing is configured: the job or request fails visibly instead of guessing an origin. */
export const unusableReturnOrigin: ReturnOrigin = async () => { throw forbidden() }

/** Dedicated mode: one web per control plane, so every customer returns to the same origin. */
export function fixedReturnOrigin(origin: string): ReturnOrigin {
  return async () => assertReturnOrigin(origin)
}

/**
 * Shared mode: a customer returns to its own tenant host, read from the enabled registry binding (never from
 * a request). The host must also fall under the configured allowlist (exact origins or `scheme://*.suffix`);
 * a customer with no enabled binding or an unlisted host is refused, never given another tenant's origin.
 */
export function tenantReturnOrigin(pool: Pool, allowed: readonly string[]): ReturnOrigin {
  const schemes = [...new Set(allowed.map(entry => /^https?:\/\//.exec(entry)?.[0]).filter((s): s is string => !!s))]
  return async customerId => {
    const host = (await pool.query(`SELECT b.host FROM customers c JOIN shared_registry_bindings b ON b.control_tenant_id=c.tenant_id
      WHERE c.id=$1 AND b.enabled`, [customerId])).rows[0]?.host as string | undefined
    if (!host) throw forbidden()
    for (const scheme of schemes) {
      let origin: string
      try { origin = assertReturnOrigin(`${scheme}${host}`) } catch { continue }
      if (originAllowed(origin, allowed)) return origin
    }
    throw forbidden()
  }
}

/** The resolver for `WEBVUE_PAYMENT_RETURN_ORIGINS` and the tenancy mode; null when no origin is configured. */
export function returnOriginFromEnv(pool: Pool, env: Record<string, string | undefined>): ReturnOrigin | null {
  const entries = (env.WEBVUE_PAYMENT_RETURN_ORIGINS ?? '').split(',').map(s => s.trim()).filter(Boolean)
  if (!entries.length) return null
  return env.WEBVUE_TENANCY_MODE === 'shared' ? tenantReturnOrigin(pool, entries) : fixedReturnOrigin(entries[0]!)
}
