import { UPSTREAM_TIMEOUT } from './tenantTransport'

const DEFAULT_HEAVY_TIMEOUT = 60_000
// Upper bound keeps one stuck report from pinning an Odoo worker for minutes.
const MAX_HEAVY_TIMEOUT = 120_000

function resolveHeavyTimeout(raw: string | undefined): number {
  const configured = Number(raw)
  if (!raw || !Number.isFinite(configured)) return DEFAULT_HEAVY_TIMEOUT
  return Math.min(MAX_HEAVY_TIMEOUT, Math.max(UPSTREAM_TIMEOUT, Math.floor(configured)))
}

/** Admitted deadline for allowlisted heavy routes; never below the ordinary deadline. Read once at
 * module load, like NUXT_ODOO_MAX_CONCURRENCY. */
export const HEAVY_TIMEOUT = resolveHeavyTimeout(process.env.NUXT_ODOO_HEAVY_TIMEOUT_MS)

const READ = ['GET', 'HEAD'] as const
const WRITE = ['POST'] as const
const ID = '[0-9]+'

// Explicit, anchored allowlist of Odoo routes known to be slow at production volume.
// Every entry mirrors a controller route; there are no prefix matches.
const HEAVY_ROUTES: ReadonlyArray<{ methods: readonly string[]; pattern: RegExp }> = [
  // Finance reports (webvue_finance)
  { methods: READ, pattern: /^\/api\/v1\/finance\/reports\/(?:aged-partner-balance|analytic(?:\/lines)?|balance-sheet|budget-vs-actual|cash-flow|general-ledger|partner-statement|profit-loss|trial-balance|vat|vat-return(?:\/items)?|withholding|zakat-base)$/ },
  // Finance bulk posting and depreciation (webvue_finance)
  { methods: WRITE, pattern: /^\/api\/v1\/finance\/assets\/compute-depreciation$/ },
  { methods: WRITE, pattern: new RegExp(`^/api/v1/finance/(?:entries|invoices|payments)/${ID}/post$`) },
  // Payroll compute/post (webvue_hr, webvue_hr_finance) and its files and statements (webvue_hr)
  { methods: WRITE, pattern: new RegExp(`^/api/v1/hr/payroll/runs/${ID}/(?:compute|post)$`) },
  { methods: READ, pattern: new RegExp(`^/api/v1/hr/payroll/runs/${ID}/(?:bank-file|wps-file|gosi-statement)$`) },
  // Project portfolio reports (webvue_pmo)
  { methods: READ, pattern: /^\/api\/v1\/reports\/projects\/(?:summary|analytics)$/ },
  // PDF documents (webvue_meetings, webvue_finance)
  { methods: READ, pattern: new RegExp(`^/api/v1/(?:meetings/${ID}/minutes\\.pdf|finance/invoices/${ID}/pdf)$`) },
]

/** @param path request pathname without the query string */
export function isHeavyRoute(method: string, path: string): boolean {
  return HEAVY_ROUTES.some(route => route.methods.includes(method) && route.pattern.test(path))
}
