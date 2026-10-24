export type HeavyKind = 'read' | 'write'

const METHODS: Record<HeavyKind, readonly string[]> = { read: ['GET', 'HEAD'], write: ['POST'] }
const ID = '[0-9]+'

// Explicit, anchored allowlist of Odoo routes known to be slow at production volume.
// Every entry mirrors a controller route; there are no prefix matches.
const HEAVY_ROUTES: ReadonlyArray<{ kind: HeavyKind; pattern: RegExp }> = [
  // Finance reports (webvue_finance)
  { kind: 'read', pattern: /^\/api\/v1\/finance\/reports\/(?:aged-partner-balance|analytic(?:\/lines)?|balance-sheet|budget-vs-actual|cash-flow|general-ledger|partner-statement|profit-loss|trial-balance|vat|vat-return(?:\/items)?|withholding|zakat-base)$/ },
  // Finance bulk posting and depreciation (webvue_finance)
  { kind: 'write', pattern: /^\/api\/v1\/finance\/assets\/compute-depreciation$/ },
  { kind: 'write', pattern: new RegExp(`^/api/v1/finance/(?:entries|invoices|payments)/${ID}/post$`) },
  // Payroll compute/post (webvue_hr, webvue_hr_finance) and its files and statements (webvue_hr)
  { kind: 'write', pattern: new RegExp(`^/api/v1/hr/payroll/runs/${ID}/(?:compute|post)$`) },
  { kind: 'read', pattern: new RegExp(`^/api/v1/hr/payroll/runs/${ID}/(?:bank-file|wps-file|gosi-statement)$`) },
  // Project portfolio reports (webvue_pmo)
  { kind: 'read', pattern: /^\/api\/v1\/reports\/projects\/(?:summary|analytics)$/ },
  // PDF documents (webvue_meetings, webvue_finance)
  { kind: 'read', pattern: new RegExp(`^/api/v1/(?:meetings/${ID}/minutes\\.pdf|finance/invoices/${ID}/pdf)$`) },
]

/** Classify a request: `read` (report, file, PDF) or `write` (bulk posting, compute), `null` when it is not an
 * allowlisted heavy route. @param path canonical request pathname without the query string (see `canonicalApiPath`) */
export function heavyRouteKind(method: string, path: string): HeavyKind | null {
  return HEAVY_ROUTES.find(route => METHODS[route.kind].includes(method) && route.pattern.test(path))?.kind ?? null
}
