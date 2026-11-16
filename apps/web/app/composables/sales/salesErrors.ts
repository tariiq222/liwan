interface Refusal { status?: number; code?: string; field?: string; details?: unknown }

/** The header fields of the order form a 422 can name. */
export type SalesOrderField = 'customer_id' | 'template_id' | 'validity_date' | 'terms' | 'salesperson_id' | 'payment_to_confirm' | 'prepayment_percent'
/** The fields of one line a refusal can name, as `lines.<index>.<field>`. */
export type SalesLineField = 'kind' | 'product_id' | 'name' | 'quantity' | 'discount_percent'

export type SalesFieldRef = { kind: 'order'; field: SalesOrderField } | { kind: 'line'; index: number; field: SalesLineField }

const ORDER_FIELDS: readonly string[] = ['customer_id', 'template_id', 'validity_date', 'terms', 'salesperson_id', 'payment_to_confirm', 'prepayment_percent'] satisfies readonly SalesOrderField[]
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

/** The header fields of the template form a 422 can name. */
export type SalesTemplateField = 'name' | 'validity_days' | 'terms'
const TEMPLATE_FIELDS: readonly string[] = ['name', 'validity_days', 'terms'] satisfies readonly SalesTemplateField[]

/** The field of the template form a 422 names, as a header field or as `lines.<index>.<field>`; null for any other refusal. */
export function salesTemplateFormField(error: unknown): { kind: 'template'; field: SalesTemplateField } | Extract<SalesFieldRef, { kind: 'line' }> | null {
  const failure = error as Refusal | null
  if (failure?.status !== 422 || !failure.field) return null
  if (TEMPLATE_FIELDS.includes(failure.field)) return { kind: 'template', field: failure.field as SalesTemplateField }
  const ref = salesFieldRef(failure.field)
  return ref?.kind === 'line' ? ref : null
}

/** The 403 of a discount above the tenant's limit by a user who may not approve it. */
export function isSalesDiscountAboveLimit(error: unknown): boolean {
  const failure = error as Refusal | null
  return failure?.status === 403 && failure.code === 'forbidden' && (failure.details as { reason?: unknown } | undefined)?.reason === 'discount_above_limit'
}

/** The field of the refund form a 422 names; null for any other refusal. */
export function salesRefundField(error: unknown): 'amount' | 'reference' | null {
  const failure = error as Refusal | null
  return failure?.status === 422 && (failure.field === 'amount' || failure.field === 'reference') ? failure.field : null
}

/** The locale key of a refused refund in its own words (the amount, the reference, a payment not recorded yet or a repeat); null for any other refusal. */
export function salesRefundErrorKey(error: unknown): string | null {
  const failure = error as Refusal | null
  const field = salesRefundField(error)
  if (field) return `sales.refund.errors.${field}`
  return failure?.status === 409 && failure.code === 'conflict' ? 'sales.refund.errors.conflict' : null
}

const unusableProduct = (failure: Refusal): string => {
  const product = (failure.details as { product?: unknown } | undefined)?.product
  return typeof product === 'string' ? product.trim() : ''
}

/** The values the message of `salesRefusalKey` needs: the product a template refuses a quotation for. */
export function salesRefusalParams(error: unknown): { product: string } {
  return { product: unusableProduct(error as Refusal) }
}

/** The locale key of a refusal the sales screens explain in their own words; null for one the generic message covers. */
export function salesRefusalKey(error: unknown): string | null {
  const failure = error as Refusal | null
  if (isSalesDiscountAboveLimit(error)) return 'sales.errors.discountAboveLimit'
  if (failure?.status === 403 && failure.code === 'transition_forbidden') return 'sales.errors.transitionForbidden'
  if (failure?.status === 503 && failure.code === 'mail_unavailable') return 'sales.errors.mailUnavailable'
  if (failure?.status === 422 && failure.code === 'customer_email_missing') return 'sales.errors.customerEmailMissing'
  if (failure?.status === 422 && failure.code === 'template_unusable') return unusableProduct(failure) ? 'sales.errors.templateUnusableProduct' : 'sales.errors.templateUnusable'
  if (failure?.status === 409 && failure.code === 'quotation_answered') return 'sales.errors.quotationAnswered'
  if (failure?.status === 422 && failure.code === 'quotation_expired') return 'sales.errors.quotationExpired'
  // The send queues the mail with the quotation PDF, so a missing PDF engine refuses the send (the staff PDF link is a plain download).
  if (failure?.status === 503 && failure.code === 'pdf_unavailable') return 'sales.errors.pdfUnavailable'
  // The server raises 422 on exactly `lines` only for a quotation with no product line (send, confirm); a malformed line
  // names `lines.<index>.<field>` and the web client always sends a list.
  if (failure?.status === 422 && failure.field === 'lines') return 'sales.errors.linesRequired'
  if (failure?.status === 403 && failure.code === 'feature_not_included') return 'sales.errors.featureNotIncluded'
  if (failure?.status === 403) return 'sales.errors.forbidden'
  if (failure?.status === 404) return 'sales.errors.notFound'
  if (failure?.status === 409) return 'sales.errors.conflict'
  return null
}

/** The field of the invoice form a 422 names; null for any other refusal. */
export function salesInvoiceField(error: unknown): 'percent' | 'amount' | 'method' | null {
  const failure = error as Refusal | null
  return failure?.status === 422 && (failure.field === 'percent' || failure.field === 'amount' || failure.field === 'method') ? failure.field : null
}

const INVOICE_REFUSALS: Record<string, string> = {
  order_not_confirmed: 'notConfirmed',
  nothing_to_invoice: 'nothingToInvoice',
  down_payment_refused: 'downPaymentRefused',
  no_journal: 'noJournal',
}

/** The locale key of a refused invoice in its own words (a figure beyond what is left, a state, a policy); null for any other refusal. */
export function salesInvoiceErrorKey(error: unknown): string | null {
  const failure = error as Refusal | null
  if (failure?.status === 403 && failure.code === 'forbidden' && (failure.details as { reason?: unknown } | undefined)?.reason === 'online_order') return 'sales.invoicing.errors.online'
  if (failure?.status === 403 && failure.code === 'forbidden' && (failure.details as { reason?: unknown } | undefined)?.reason === 'not_the_salesperson') return 'sales.invoicing.errors.notSalesperson'
  if (failure?.status === 403 && failure.code === 'feature_not_included') return 'sales.invoicing.errors.financeNotIncluded'
  if (failure?.status === 422 && failure.code && failure.code in INVOICE_REFUSALS) return `sales.invoicing.errors.${INVOICE_REFUSALS[failure.code]}`
  const field = salesInvoiceField(error)
  return field === 'percent' || field === 'amount' ? `sales.invoicing.errors.${field}` : null
}
