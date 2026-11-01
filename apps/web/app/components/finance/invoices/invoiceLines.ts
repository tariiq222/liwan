import type { FinanceInvoiceCreate, FinanceInvoiceDetail, FinanceInvoiceLine, FinanceInvoiceLineInput, FinanceInvoicePatch } from '@liwan/contracts'
import type { FinanceMoveType } from './invoiceKinds'

/** One line of the editor as typed: numbers stay strings until they are validated. */
export interface InvoiceLineDraft {
  key: number
  name: string
  quantity: string
  priceUnit: string
  discount: string
  /** The taxes the line already has when it was loaded; null for a new line (the account's default taxes apply). */
  taxIds: number[] | null
  accountId: number | null
  /** The asset profile a vendor-bill line capitalises into; kept as loaded so an edit never drops it. */
  assetProfileId: number | null
  noTax: boolean
}

export interface InvoiceFormDraft {
  partnerId: number | null
  invoiceDate: string | null
  invoiceDateDue: string | null
  paymentTermId: number | null
  ref: string
  lines: InvoiceLineDraft[]
}

export type InvoiceLineField = 'name' | 'quantity' | 'priceUnit' | 'discount'
export type InvoiceFormErrors = { partner: boolean; dueBeforeDate: boolean; lines: Array<Partial<Record<InvoiceLineField, true>>> }

let nextKey = 1
export function newLine(): InvoiceLineDraft {
  return { key: nextKey++, name: '', quantity: '1', priceUnit: '', discount: '0', taxIds: null, accountId: null, assetProfileId: null, noTax: false }
}

export function emptyInvoiceDraft(): InvoiceFormDraft {
  return { partnerId: null, invoiceDate: null, invoiceDateDue: null, paymentTermId: null, ref: '', lines: [newLine()] }
}

function lineFromRecord(line: FinanceInvoiceLine): InvoiceLineDraft {
  return {
    key: nextKey++,
    name: line.name,
    quantity: String(line.quantity),
    priceUnit: String(line.price_unit),
    discount: String(line.discount),
    taxIds: line.taxes.map(tax => tax.id),
    accountId: line.account?.id ?? null,
    assetProfileId: line.asset_profile?.id ?? null,
    noTax: line.taxes.length === 0,
  }
}

/** The editor state of a draft document: the lines keep their taxes and account when saved back. */
export function invoiceDraftFromRecord(invoice: FinanceInvoiceDetail): InvoiceFormDraft {
  return {
    partnerId: invoice.partner?.id ?? null,
    invoiceDate: invoice.invoice_date,
    invoiceDateDue: invoice.invoice_date_due,
    paymentTermId: invoice.payment_term?.id ?? null,
    ref: invoice.ref,
    lines: invoice.lines.length ? invoice.lines.map(lineFromRecord) : [newLine()],
  }
}

const decimal = (value: string) => value.trim() === '' ? Number.NaN : Number(value)

function lineProblems(line: InvoiceLineDraft): Partial<Record<InvoiceLineField, true>> {
  const quantity = decimal(line.quantity)
  const price = decimal(line.priceUnit)
  const discount = decimal(line.discount)
  return {
    ...(line.name.trim() ? {} : { name: true as const }),
    ...(Number.isFinite(quantity) && quantity >= 0 ? {} : { quantity: true as const }),
    ...(Number.isFinite(price) ? {} : { priceUnit: true as const }),
    ...(Number.isFinite(discount) && discount >= 0 && discount <= 100 ? {} : { discount: true as const }),
  }
}

export function validateInvoiceDraft(draft: InvoiceFormDraft): InvoiceFormErrors {
  return {
    partner: !draft.partnerId,
    // With a payment term the server derives the due date, so a stale typed one is neither sent nor validated.
    dueBeforeDate: !draft.paymentTermId && !!draft.invoiceDate && !!draft.invoiceDateDue && draft.invoiceDateDue < draft.invoiceDate,
    lines: draft.lines.map(lineProblems),
  }
}

export function hasInvoiceErrors(errors: InvoiceFormErrors): boolean {
  return errors.partner || errors.dueBeforeDate || errors.lines.some(line => Object.keys(line).length > 0)
}

/** The body of one line: an explicit empty tax list means "no tax", an absent one means the account's default. */
export function buildLinePayload(line: InvoiceLineDraft): FinanceInvoiceLineInput {
  const taxIds = line.noTax ? [] : line.taxIds
  return {
    name: line.name.trim(),
    quantity: decimal(line.quantity),
    price_unit: decimal(line.priceUnit),
    discount: decimal(line.discount),
    ...(taxIds ? { tax_ids: taxIds } : {}),
    ...(line.accountId ? { account_id: line.accountId } : {}),
    ...(line.assetProfileId ? { asset_profile_id: line.assetProfileId } : {}),
  }
}

function headerPayload(draft: InvoiceFormDraft) {
  return {
    partner_id: draft.partnerId!,
    invoice_date: draft.invoiceDate,
    // With a payment term the server derives the due date from the invoice date; a typed date is sent only without one.
    ...(draft.paymentTermId ? {} : { invoice_date_due: draft.invoiceDateDue }),
    payment_term_id: draft.paymentTermId,
    ref: draft.ref.trim(),
    lines: draft.lines.map(buildLinePayload),
  }
}

export function buildInvoiceCreate(moveType: FinanceMoveType, draft: InvoiceFormDraft): FinanceInvoiceCreate {
  return { move_type: moveType, ...headerPayload(draft) }
}

/** A patch always carries the whole editor: the lines in it replace the draft's lines. */
export function buildInvoicePatch(draft: InvoiceFormDraft): FinanceInvoicePatch {
  return headerPayload(draft)
}

/** The line's amount before tax, as the user sees it while typing. */
export function lineSubtotal(line: Pick<InvoiceLineDraft, 'quantity' | 'priceUnit' | 'discount'>): number {
  const quantity = decimal(line.quantity)
  const price = decimal(line.priceUnit)
  const discount = decimal(line.discount)
  if (![quantity, price, discount].every(Number.isFinite)) return 0
  return quantity * price * (1 - discount / 100)
}

export function invoiceDraftDirty(draft: InvoiceFormDraft, initial: InvoiceFormDraft): boolean {
  const flat = (value: InvoiceFormDraft) => JSON.stringify({ ...value, lines: value.lines.map(({ key: _key, ...line }) => line) })
  return flat(draft) !== flat(initial)
}
