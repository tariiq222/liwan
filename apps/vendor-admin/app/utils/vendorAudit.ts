import type { RouteLocationRaw } from 'vue-router'
import { AUDIT_PAGE_SIZE, auditListQuerySchema, type AuditEvent, type AuditListQuery } from '@webvue/commercial-contracts'

/** The action families offered by the audit filter; `action` also accepts any exact action from a link. */
export const AUDIT_CATEGORIES = ['auth', 'account', 'tenant', 'operation', 'catalog', 'catalog_release', 'plan', 'bundle', 'order', 'invoice', 'payment', 'customer_terms'] as const
export { AUDIT_PAGE_SIZE }

export type AuditFilters = Omit<AuditListQuery, 'page'>

const FILTER_KEYS = ['q', 'action', 'actor', 'customer_id', 'from', 'to'] as const

/** The URL filters this page understands; a value the control plane would reject reads as no filter. */
export function auditFilters(query: Record<string, unknown>): AuditFilters {
  const result: AuditFilters = {}
  for (const key of FILTER_KEYS) {
    const raw = Array.isArray(query[key]) ? query[key][0] : query[key]
    const parsed = auditListQuerySchema.shape[key].safeParse(typeof raw === 'string' ? raw : undefined)
    if (parsed.success && parsed.data !== undefined) Object.assign(result, { [key]: parsed.data })
  }
  if (result.from && result.to && result.from > result.to) delete result.to
  return result
}

/** The control plane query for the filters and page (the first page carries no `page`). */
export const auditListQuery = (filters: AuditFilters, page: number): Record<string, string | undefined> => ({ ...filters, page: page > 1 ? String(page) : undefined })

export const auditFilterCount = (filters: AuditFilters): number => FILTER_KEYS.filter(key => filters[key]).length

const OPERATION_ACTION = /^operation\.(tenant\.(?:create|inspect|entitle)|health|backup|upgrade|restore)\.(queued|succeeded|failed|needs_intervention)$/

/** The locale key of an action and, for operation events, of its status; any other action reads from `vendor.audit.actions.<action>` and falls back to the raw action. */
export function auditActionParts(action: string): { type: string; status: string } | null {
  const match = OPERATION_ACTION.exec(action)
  return match ? { type: match[1]!, status: match[2]! } : null
}

const KNOWN_ACTORS = new Set(['operator', 'anonymous', 'system', 'shared-worker'])

/** How an actor is shown: an account name when known, a named system actor, or the raw id of a former account. */
export function auditActor(event: Pick<AuditEvent, 'actor' | 'actor_name'>): { kind: 'name'; name: string } | { kind: 'system'; key: string } | { kind: 'legacy'; id: string } | { kind: 'raw'; id: string } {
  if (event.actor_name) return { kind: 'name', name: event.actor_name }
  if (KNOWN_ACTORS.has(event.actor)) return { kind: 'system', key: event.actor }
  if (event.actor.startsWith('legacy-uid:')) return { kind: 'legacy', id: event.actor.slice('legacy-uid:'.length) }
  return { kind: 'raw', id: event.actor }
}

/** Where a subject opens, when the console has a page for it. */
export function auditSubjectTo(event: Pick<AuditEvent, 'subject' | 'subject_ref'>): RouteLocationRaw | null {
  const { kind, customer_id: customer, tenant_id: tenant } = event.subject_ref
  const id = encodeURIComponent(event.subject)
  if (kind === 'customer' || kind === 'order') return customer ? { path: `/customers/${encodeURIComponent(customer)}` } : null
  if (kind === 'tenant') return customer ? { path: `/customers/${encodeURIComponent(customer)}`, query: { tab: 'workspace' } } : tenant ? { path: `/tenants/${encodeURIComponent(tenant)}` } : null
  if (kind === 'plan') return { path: `/plans/${id}` }
  if (kind === 'bundle') return { path: `/bundles/${id}` }
  if (kind === 'catalog') return { path: `/catalog/${id}` }
  return null
}
