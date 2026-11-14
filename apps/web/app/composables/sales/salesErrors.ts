interface Refusal { status?: number; code?: string; field?: string; details?: unknown }

/** The header fields of the order form a 422 can name. */
export type SalesOrderField = 'customer_id' | 'validity_date' | 'terms' | 'salesperson_id'
/** The fields of one line a refusal can name, as `lines.<index>.<field>`. */
export type SalesLineField = 'kind' | 'product_id' | 'name' | 'quantity' | 'discount_percent'

export type SalesFieldRef = { kind: 'order'; field: SalesOrderField } | { kind: 'line'; index: number; field: SalesLineField }

const ORDER_FIELDS: readonly string[] = ['customer_id', 'validity_date', 'terms', 'salesperson_id'] satisfies readonly SalesOrderField[]
const LINE_FIELDS: readonly string[] = ['kind', 'product_id', 'name', 'quantity', 'discount_percent'] satisfies readonly SalesLineField[]
const LINE_PATH = /^lines\.(\d+)\.(\w+)$/

/** A refusal's `field` read as a header field or a line field; null for any other field. */
export function salesFieldRef(field: string | undefined): SalesFieldRef | null {
  if (!field) return null
  if (ORDER_FIELDS.includes(field)) return { kind: 'order', field: field as SalesOrderField }
  const line = LINE_PATH.exec(field)
  if (line && LINE_FIELDS.includes(line[2]!)) return { kind: 'line', index: Number(line[1]), field: line[2] as SalesLineField }
  return null
}

/** The form field a 422, or the 403 of a discount above the limit, belongs to; null for any other refusal. */
export function salesFormField(error: unknown): SalesFieldRef | null {
  const failure = error as Refusal | null
  if (failure?.status === 422 || isSalesDiscountAboveLimit(error)) return salesFieldRef(failure?.field)
  return null
}

/** The 403 of a discount above the tenant's limit by a user who may not approve it. */
export function isSalesDiscountAboveLimit(error: unknown): boolean {
  const failure = error as Refusal | null
  return failure?.status === 403 && failure.code === 'forbidden' && (failure.details as { reason?: unknown } | undefined)?.reason === 'discount_above_limit'
}

/** The locale key of a refusal the sales screens explain in their own words; null for one the generic message covers. */
export function salesRefusalKey(error: unknown): string | null {
  const failure = error as Refusal | null
  if (isSalesDiscountAboveLimit(error)) return 'sales.errors.discountAboveLimit'
  if (failure?.status === 403 && failure.code === 'transition_forbidden') return 'sales.errors.transitionForbidden'
  if (failure?.status === 403 && failure.code === 'feature_not_included') return 'sales.errors.featureNotIncluded'
  if (failure?.status === 403) return 'sales.errors.forbidden'
  if (failure?.status === 404) return 'sales.errors.notFound'
  if (failure?.status === 409) return 'sales.errors.conflict'
  return null
}
