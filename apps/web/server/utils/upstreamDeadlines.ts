/** Admitted deadline of an ordinary upstream request, and how long ordinary traffic waits for capacity. */
export const UPSTREAM_TIMEOUT = 15_000

const DEFAULT_HEAVY_TIMEOUT = 60_000
// Upper bound keeps one stuck report from pinning an Odoo worker for minutes.
const MAX_HEAVY_TIMEOUT = 120_000

function resolveHeavyTimeout(raw: string | undefined): number {
  const configured = Number(raw)
  if (!raw || !Number.isFinite(configured)) return DEFAULT_HEAVY_TIMEOUT
  return Math.min(MAX_HEAVY_TIMEOUT, Math.max(UPSTREAM_TIMEOUT, Math.floor(configured)))
}

/** Single owner of the heavy budget: the admitted deadline of an allowlisted heavy route and also how
 * long heavy work waits for a heavy credit or the write gate (a waiter never outlives the work it waits
 * behind). Never below the ordinary deadline. Read once at module load, like NUXT_ODOO_MAX_CONCURRENCY. */
export const HEAVY_TIMEOUT = resolveHeavyTimeout(process.env.NUXT_ODOO_HEAVY_TIMEOUT_MS)
