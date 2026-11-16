import type { ProductPick, SalesLineKind, SalesOrder, SalesOrderCreate, SalesOrderLineInput, SalesOrderPatch, SalesPaymentToConfirm } from '@liwan/contracts'
import { SALES_LIMITS, SALES_PREPAYMENT_PERCENT } from '@liwan/contracts'

/**
 * One line of the editor. Numbers stay strings until they are validated. `unitPrice` is only a preview: the saved price
 * of an existing line, or the pick price of a product just chosen; the server prices the line on save.
 */
export interface SalesLineDraft {
  key: number
  id: number | null
  kind: SalesLineKind
  productId: number | null
  productName: string
  unit: string | null
  unitPrice: number | null
  /** The currency of the preview price; null until a product is known. */
  currency: string | null
  name: string
  quantity: string
  discount: string
}

/** How the quotation asks to be paid, as the form holds it; `percent` stays a number or null while the field is empty. */
export interface SalesPaymentDraft { mode: SalesPaymentToConfirm; percent: number | null }

export interface SalesOrderDraft {
  customerId: number | null
  customerName: string
  salespersonId: number | null
  validityDate: string | null
  terms: string
  lines: SalesLineDraft[]
  /** Null until the user chooses (or the saved quotation says): a new quotation then takes the tenant's default on the server. */
  payment: SalesPaymentDraft | null
}

export type SalesLineProblem = 'product' | 'quantity' | 'discount' | 'name'
export interface SalesDraftErrors { customer: boolean; noLines: boolean; payment: boolean; lines: Array<Partial<Record<SalesLineProblem, true>>> }

let nextKey = 1

export function newSalesLine(kind: SalesLineKind = 'product'): SalesLineDraft {
  return { key: nextKey++, id: null, kind, productId: null, productName: '', unit: null, unitPrice: null, currency: null, name: '', quantity: '1', discount: '0' }
}

export function emptySalesDraft(): SalesOrderDraft {
  return { customerId: null, customerName: '', salespersonId: null, validityDate: null, terms: '', lines: [newSalesLine()], payment: null }
}

/** The editor state of a saved document. A quotation that does not ask for a percentage holds none: the tenant's default is applied when the user chooses one. */
export function salesDraftFromOrder(order: SalesOrder): SalesOrderDraft {
  return {
    payment: order.payment ? { mode: order.payment.mode, percent: order.payment.mode === 'percent' ? order.payment.percent : null } : null,
    customerId: order.customer.id,
    customerName: order.customer.name,
    salespersonId: order.salesperson?.id ?? null,
    validityDate: order.validity_date,
    terms: order.terms,
    lines: order.lines.map(line => ({
      key: nextKey++,
      id: line.id,
      kind: line.kind,
      productId: line.product?.id ?? null,
      productName: line.product?.name ?? '',
      unit: line.unit,
      unitPrice: line.kind === 'product' ? line.unit_price : null,
      currency: order.currency.name,
      name: line.name,
      quantity: String(line.quantity),
      discount: String(line.discount_percent),
    })),
  }
}

/** The line after the user picked a product (or dropped it): the pick price stands in until the server prices it. */
export function withPickedProduct(line: SalesLineDraft, product: ProductPick | null): SalesLineDraft {
  return { ...line, productId: product?.id ?? null, productName: product?.name ?? '', unitPrice: product?.unit_price ?? null, currency: product?.currency.name ?? null, unit: null }
}

/** The lines with one moved by `delta` places; a move past either end changes nothing. */
export function moveSalesLine(lines: SalesLineDraft[], index: number, delta: number): SalesLineDraft[] {
  const target = index + delta
  if (index < 0 || index >= lines.length || target < 0 || target >= lines.length) return lines
  const moved = [...lines]
  const [line] = moved.splice(index, 1)
  moved.splice(target, 0, line!)
  return moved
}

const decimal = (value: string) => value.trim() === '' ? Number.NaN : Number(value)

function lineProblems(line: SalesLineDraft): Partial<Record<SalesLineProblem, true>> {
  if (line.kind !== 'product') return line.name.trim() ? {} : { name: true }
  const quantity = decimal(line.quantity)
  const discount = decimal(line.discount)
  return {
    ...(line.productId ? {} : { product: true as const }),
    ...(Number.isFinite(quantity) && quantity > 0 && quantity <= SALES_LIMITS.quantity ? {} : { quantity: true as const }),
    ...(Number.isFinite(discount) && discount >= 0 && discount <= 100 ? {} : { discount: true as const }),
  }
}

/** The payment the user just chose: moving to a percentage with none of its own takes `defaultPercent`; an emptied field stays empty. */
export function salesPaymentWithDefaultPercent(next: SalesPaymentDraft, previous: SalesPaymentDraft | null, defaultPercent: number): SalesPaymentDraft {
  return next.mode === 'percent' && previous?.mode !== 'percent' && next.percent === null ? { ...next, percent: defaultPercent } : next
}

const validPercent = (percent: number | null) => percent !== null && Number.isInteger(percent) && percent >= SALES_PREPAYMENT_PERCENT.min && percent <= SALES_PREPAYMENT_PERCENT.max

export function validateSalesDraft(draft: SalesOrderDraft): SalesDraftErrors {
  return { customer: !draft.customerId, noLines: !draft.lines.length, payment: draft.payment?.mode === 'percent' && !validPercent(draft.payment.percent), lines: draft.lines.map(lineProblems) }
}

export function hasSalesDraftErrors(errors: SalesDraftErrors): boolean {
  return errors.customer || errors.noLines || errors.payment || errors.lines.some(line => Object.keys(line).length > 0)
}

/** The payment choice of a write while the tenant can take payments: the mode, and the percentage only under `percent`. Empty when nothing was chosen. */
function paymentBody(draft: SalesOrderDraft, offered: boolean): Pick<SalesOrderCreate, 'payment_to_confirm' | 'prepayment_percent'> {
  if (!offered || !draft.payment) return {}
  const { mode, percent } = draft.payment
  return { payment_to_confirm: mode, ...(mode === 'percent' && percent !== null ? { prepayment_percent: percent } : {}) }
}

/** The body of one line: a product line sends its product, quantity and discount; a section or note its text. No price. */
export function salesLinePayload(line: SalesLineDraft): SalesOrderLineInput {
  const id = line.id ? { id: line.id } : {}
  if (line.kind !== 'product') return { ...id, kind: line.kind, name: line.name.trim() }
  return { ...id, kind: 'product', product_id: line.productId!, quantity: decimal(line.quantity), discount_percent: decimal(line.discount) }
}

/**
 * The create body. An empty validity date, empty terms and an unchosen payment are left out, so the server applies the
 * tenant's defaults; the salesperson is sent only by a holder of the assign right who chose one.
 */
export function salesCreateBody(draft: SalesOrderDraft, canAssign: boolean, paymentOffered = false): SalesOrderCreate {
  return {
    ...paymentBody(draft, paymentOffered),
    customer_id: draft.customerId!,
    ...(canAssign && draft.salespersonId ? { salesperson_id: draft.salespersonId } : {}),
    ...(draft.validityDate ? { validity_date: draft.validityDate } : {}),
    ...(draft.terms.trim() ? { terms: draft.terms.trim() } : {}),
    lines: draft.lines.map(salesLinePayload),
  }
}

/** The edit body: the header and the whole list of lines, which replaces the saved one; the salesperson only when it changed. */
export function salesPatchBody(order: SalesOrder, draft: SalesOrderDraft, canAssign: boolean, paymentOffered = false): SalesOrderPatch {
  return {
    ...paymentBody(draft, paymentOffered),
    customer_id: draft.customerId!,
    ...(canAssign && draft.salespersonId && draft.salespersonId !== order.salesperson?.id ? { salesperson_id: draft.salespersonId } : {}),
    validity_date: draft.validityDate,
    terms: draft.terms.trim(),
    lines: draft.lines.map(salesLinePayload),
  }
}

/** The amount of a product line at the product's price, as the user types; zero until the price and the numbers are known. The tax is the server's, on save. */
export function salesLineAmount(line: Pick<SalesLineDraft, 'kind' | 'unitPrice' | 'quantity' | 'discount'>): number {
  if (line.kind !== 'product' || line.unitPrice === null) return 0
  const quantity = decimal(line.quantity)
  const discount = decimal(line.discount)
  if (!Number.isFinite(quantity) || !Number.isFinite(discount)) return 0
  return Math.round(quantity * line.unitPrice * (1 - discount / 100) * 100) / 100
}

/** The draft without the editor's own keys, to tell an edit from the saved state. */
export function salesDraftSnapshot(draft: SalesOrderDraft): string {
  return JSON.stringify({ ...draft, lines: draft.lines.map(({ key: _key, ...line }) => line) })
}
